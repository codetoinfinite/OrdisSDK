# Deploying AlpheSDK on AWS

AlpheSDK runs as a private ECS Fargate service (`alphesdk`, ARM64) in the existing `alphe` cluster
in ap-south-1, next to the alphe chatbot. The chatbot is its only client. There is no load
balancer and no public route.

```
app.alpheai.com ─▶ ALB ─▶ alphe (chatbot) ──3003──▶ alphesdk ──▶ Sandock (MCP servers run here)
                                  http://alphesdk.alphe.local:3003  (Cloud Map DNS)
```

`cloudformation.yml` creates: the task definition and service, a security group that admits port
3003 only from the chatbot's security group, an execution role that can read only
`/alphesdk/*` in SSM, a task role with no permissions, the Cloud Map namespace `alphe.local` with
the `alphesdk` service, and the log group `/ecs/alphesdk` (14 days).

Design notes:
- **One task.** MCP gateway and OAuth sessions live in memory, so a second replica wouldn't
  share them. Deployments start the new task before stopping the old one, and roll back on their
  own if the new one never turns healthy (`/healthz`).
- **Search** is in-memory (`ENABLE_SEARCH=false`), so there is no Meilisearch to run.
- **MCP servers run in Sandock**, never in the task. In production the server refuses local
  execution and refuses to start without `ALPHE_SDK_API_KEYS` (32+ characters each).
- **Public IP on the task.** The `alphe` subnets are public and the VPC has no NAT gateway, so
  the task gets a public IP for outbound traffic (ECR, SSM, CloudWatch, Sandock). Nothing can
  connect in: the security group admits only the chatbot. A NAT gateway (≈ $1.40/day) would
  allow private subnets instead.
- **Secrets** are SSM Parameter Store SecureStrings (free tier), not Secrets Manager.

## Prerequisites

- AWS CLI v2 with credentials for the account that runs the `alphe` cluster
  (`export AWS_PROFILE=<profile> AWS_REGION=ap-south-1`). It needs CloudFormation, ECS, ECR,
  IAM role creation and `iam:PassRole`, Cloud Map/Route 53, EC2 security groups, SSM and
  CloudWatch Logs rights.
- Docker with buildx (Docker Desktop on Apple Silicon builds arm64 natively).

## First deploy

```bash
cp deploy/aws/env.production.example .env.production   # fill in; git-ignored
deploy/aws/deploy.sh secrets                             # → SSM /alphesdk/*
deploy/aws/deploy.sh push                                # → ECR alphesdk:<git sha>
# the alphe service's VPC, subnets and security group:
#   aws ecs describe-services --cluster alphe --services alphe \
#     --query 'services[0].networkConfiguration.awsvpcConfiguration'
VPC_ID=vpc-... SUBNET_IDS=subnet-...,subnet-... CLIENT_SG=sg-... deploy/aws/deploy.sh up
deploy/aws/deploy.sh status
```

Then connect the chatbot (a separate change to the `alphe` service): add to its task definition
`ALPHESDK_URL=http://alphesdk.alphe.local:3003` and `ALPHESDK_API_KEY` (one of the
`ALPHE_SDK_API_KEYS`, as a secret from `/alphesdk/ALPHE_SDK_API_KEYS` or its own parameter) and
deploy it. The `alphe` execution role needs `ssm:GetParameters` on that parameter.

## Day-2

| Task | Command |
|------|---------|
| Ship new code | `deploy.sh push`, then `deploy.sh up` with the same variables |
| Change a secret | edit `.env.production`, `deploy.sh secrets`, then `aws ecs update-service --cluster alphe --service alphesdk --force-new-deployment` |
| Logs | `aws logs tail /ecs/alphesdk --follow` |
| Bigger task | `CPU=1024 MEMORY=4096 deploy.sh up` |
| Tear down | `deploy.sh down` (keeps ECR images and SSM secrets) |

## Cost (ap-south-1, on-demand list prices, October 2026)

Fargate ARM in Mumbai: $0.02383 per vCPU-hour, $0.00261 per GB-hour.

| Item | Rate | Per day |
|------|------|---------|
| Fargate task, 0.5 vCPU / 2 GB, ARM64, 24 h | $0.01714/h | $0.41 |
| Public IPv4 on the task | $0.005/h | $0.12 |
| Cloud Map namespace (Route 53 private zone) + 1 instance | $0.50 + $0.10/month | $0.02 |
| ECR storage (3.45 GB image, ~0.8 GB compressed; layers shared between kept images) | $0.10/GB-month | ~$0.01 |
| CloudWatch Logs, SSM Parameter Store (standard) | light use | ~$0.01 |
| **Total** | | **≈ $0.57/day (≈ $17/month)** |

Measured locally: the container is healthy 18 s after start, its memory peaks at ~1.1 GB while
the catalog (8,755 servers, 77k search docs) is indexed and settles at ~0.7 GB, and it stops
cleanly on SIGTERM in about a second. `CPU=1024` (1 vCPU / 2 GB) would be ≈ $0.86/day.

Not included: data transfer out after the first 100 GB/month free, and usage billed outside AWS by Sandock (and OpenRouter/PostHog if enabled).
