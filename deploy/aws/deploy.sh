#!/usr/bin/env bash
# AlpheSDK on AWS ECS Fargate. See deploy/aws/README.md.
#   deploy/aws/deploy.sh secrets   # push .env.production to SSM Parameter Store (/alphesdk/*)
#   deploy/aws/deploy.sh push      # build the arm64 image and push it to ECR (creates the repo)
#   deploy/aws/deploy.sh up        # create or update the CloudFormation stack with that image
#   deploy/aws/deploy.sh status    # stack outputs, service state and recent logs
#   deploy/aws/deploy.sh down      # delete the stack (ECR images and SSM secrets are kept)
set -euo pipefail

STACK="${STACK:-alphesdk}"
REGION="${AWS_REGION:-$(aws configure get region)}"
ENV_FILE="${ENV_FILE:-.env.production}"
CLUSTER="${CLUSTER:-alphe}"
DIR="$(cd "$(dirname "$0")" && pwd)"
REQUIRED=(ALPHE_SDK_API_KEYS SANDOCK_API_KEY)
aws() { command aws --region "$REGION" "$@"; }

registry() { echo "$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$REGION.amazonaws.com"; }
tag() { echo "${TAG:-$(git -C "$DIR" rev-parse --short HEAD)}"; }

case "${1:-}" in
  secrets)
    [[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE (copy deploy/aws/env.production.example)"; exit 1; }
    stored=()
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
      key="${line%%=*}"; value="${line#*=}"
      value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
      [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || { echo "Bad key: $key"; exit 1; }
      [[ -n "$value" ]] || continue
      aws ssm put-parameter --name "/alphesdk/$key" --type SecureString --value "$value" \
        --overwrite >/dev/null
      echo "stored /alphesdk/$key"; stored+=("$key")
    done < "$ENV_FILE"
    for key in "${REQUIRED[@]}"; do
      [[ " ${stored[*]-} " == *" $key "* ]] || echo "warning: $key is empty; the task won't start without it"
    done
    ;;
  push)
    repo="$(registry)/alphesdk"
    aws ecr describe-repositories --repository-names alphesdk >/dev/null 2>&1 || {
      aws ecr create-repository --repository-name alphesdk \
        --image-scanning-configuration scanOnPush=true >/dev/null
      aws ecr put-lifecycle-policy --repository-name alphesdk --lifecycle-policy-text \
        '{"rules":[{"rulePriority":1,"description":"Keep the 10 newest images","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":10},"action":{"type":"expire"}}]}' \
        >/dev/null
      echo "created ECR repository $repo"
    }
    aws ecr get-login-password | docker login --username AWS --password-stdin "$(registry)"
    docker buildx build --platform linux/arm64 -t "$repo:$(tag)" --push "$DIR/../.."
    echo "pushed $repo:$(tag)"
    ;;
  up)
    : "${VPC_ID:?set VPC_ID}" "${SUBNET_IDS:?set SUBNET_IDS (comma-separated)}"
    : "${CLIENT_SG:?set CLIENT_SG (security group of the alphe service)}"
    aws cloudformation deploy --stack-name "$STACK" \
      --template-file "$DIR/cloudformation.yml" --capabilities CAPABILITY_IAM \
      --parameter-overrides ClusterName="$CLUSTER" VpcId="$VPC_ID" SubnetIds="$SUBNET_IDS" \
        ClientSecurityGroupId="$CLIENT_SG" ImageUri="$(registry)/alphesdk:$(tag)" \
        Cpu="${CPU:-512}" Memory="${MEMORY:-2048}"
    aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].Outputs' --output table
    ;;
  status)
    aws cloudformation describe-stacks --stack-name "$STACK" \
      --query 'Stacks[0].[StackStatus,Outputs]' --output table
    aws ecs describe-services --cluster "$CLUSTER" --services alphesdk --query \
      'services[0].{status:status,running:runningCount,desired:desiredCount,rollout:deployments[0].rolloutState}' \
      --output table
    aws logs tail /ecs/alphesdk --since 15m | tail -20
    ;;
  down)
    read -r -p "Delete stack '$STACK' in $REGION (ECS service alphesdk, its roles, Cloud Map namespace)? [y/N] " ok
    [[ "$ok" == y ]] || exit 1
    aws cloudformation delete-stack --stack-name "$STACK"
    aws cloudformation wait stack-delete-complete --stack-name "$STACK"
    echo "Deleted. ECR repository alphesdk and SSM /alphesdk/* are kept."
    ;;
  *)
    sed -n '2,7p' "$0"; exit 1
    ;;
esac
