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
the `alphesdk` service, and the log group `/ecs/alphesdk` (7 days). Everything is tagged `app=alphesdk`.

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
  EC2 security groups, SSM and CloudWatch Logs rights, plus what a restricted deploy user
  usually lacks. An admin grants that once:
  ```bash
  aws iam attach-user-policy --user-name <user> \
    --policy-arn arn:aws:iam::aws:policy/AWSCloudMapFullAccess   # Cloud Map + its Route 53 zone
  aws iam put-user-policy --user-name <user> --policy-name alphesdk-deploy \
    --policy-document file://deploy/aws/deployer-policy.json     # alphesdk-* roles, PassRole, budget
  ```
- Activate the `app` cost allocation tag (Billing → Cost allocation tags) so the budget can
  filter on it. Tags show up there within 24 h of the first tagged resource.
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
BUDGET_EMAIL=you@example.com deploy/aws/deploy.sh budget  # alerts at 50/80/100% + forecast
```

Then connect the chatbot (a separate change to the `alphe` service): add to its task definition
`ALPHESDK_URL=http://alphesdk.alphe.local:3003` and `ALPHESDK_API_KEY` (one of the
`ALPHE_SDK_API_KEYS`, as a secret from `/alphesdk/ALPHE_SDK_API_KEYS` or its own parameter) and
deploy it. The `alphe` execution role needs `ssm:GetParameters` on that parameter.

## Public URL (optional)

To share AlpheSDK (web catalog, REST API, MCP gateway) at its own HTTPS address, serve it
through the load balancer that already fronts the chatbot. That adds one host-header rule and a
certificate to its HTTPS listener; existing rules are untouched, and there is no new load balancer.

1. `aws acm request-certificate --domain-name sdk.example.com --validation-method DNS`, then add
   the validation CNAME it shows (`aws acm describe-certificate`) at your DNS provider.
2. Point `sdk.example.com` (CNAME) at the load balancer's DNS name.
3. Once the certificate is ISSUED:
   ```bash
   PUBLIC_HOSTNAME=sdk.example.com HTTPS_LISTENER_ARN=arn:...:listener/app/... \
   ALB_SG=sg-... CERT_ARN=arn:aws:acm:... VPC_ID=... SUBNET_IDS=... CLIENT_SG=... deploy.sh up
   ```

Browsing and search are open to anyone. Running tools (`/api/v1/packages/run`, `/mcp/*`) needs
an API key, sent as `Authorization: Bearer <key>`. Give each person their own:
`deploy.sh key alice` prints a new key once; `deploy.sh revoke alice` cuts it off. Both restart
the task (~2 minutes). Extra cost: load balancer capacity units ($0.008/LCU-hour, ≈ $0 at light
use) and data out beyond 100 GB/month.

## Day-2

| Task | Command |
|------|---------|
| Ship new code | `deploy.sh push`, then `deploy.sh up` with the same variables |
| Change a secret | edit `.env.production`, `deploy.sh secrets`, then `aws ecs update-service --cluster alphe --service alphesdk --force-new-deployment` |
| Logs | `aws logs tail /ecs/alphesdk --follow` |
| Bigger task | `CPU=1024 MEMORY=4096 deploy.sh up` |
| Tear down | `deploy.sh down` (keeps ECR images and SSM secrets) |

## Cost (ap-south-1, on-demand list prices, October 2026)

Fargate ARM in Mumbai: $0.02383 per vCPU-hour, $0.00261 per GB-hour. The service runs exactly
one task with no autoscaling, so the bill is flat.

| Item | Rate | Per month |
|------|------|-----------|
| Fargate task, 0.25 vCPU / 2 GB, ARM64, 24/7 | $0.01118/h | $8.16 |
| Public IPv4 on the task | $0.005/h | $3.65 |
| Cloud Map private zone + 1 instance + DNS queries | $0.50 + $0.10 + ≤ $0.40 | ≤ $1.00 |
| ECR storage (~0.8 GB compressed, newest 3 images kept) | $0.10/GB-month | ≤ $0.25 |
| CloudWatch Logs (7 days), SSM Parameter Store (standard) | light use | ~$0.20 |
| **Total** | | **≈ $13/month (≈ $0.44/day)** |

`deploy.sh budget` adds a $13 budget on `app=alphesdk` costs (the public IPv4 is billed
untagged, so the two together stay under $17). AWS Budgets only alerts; to stop spending, run
`deploy.sh down`.

Measured locally at 0.25 vCPU / 2 GB: healthy 45 s after start, search answers in ~0.5 s, memory
peaks at ~1.1 GB while the catalog (8,755 servers, 77k search docs) is indexed, and it stops
cleanly on SIGTERM in about a second. 1 GB is too small. `CPU=512` cuts startup to ~18 s for +$4.35/month.

Not included: data transfer out after the first 100 GB/month free, and usage billed outside AWS
by Sandock (and OpenRouter/PostHog if enabled).
