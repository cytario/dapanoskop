terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.0"
    }
  }
}

data "aws_region" "current" {}

locals {
  use_s3_source = var.lambda_s3_key != ""
}

data "archive_file" "lambda" {
  count       = local.use_s3_source ? 0 : 1
  type        = "zip"
  source_dir  = "${path.module}/../../../lambda/src"
  output_path = "${path.module}/lambda.zip"
}

resource "aws_iam_role" "lambda" {
  name_prefix          = "dapanoskop-pipeline-"
  permissions_boundary = var.permissions_boundary != "" ? var.permissions_boundary : null

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "lambda" {
  #checkov:skip=CKV_AWS_158:Logs contain no secrets or PII; AWS managed encryption sufficient
  name              = "/aws/lambda/dapanoskop-pipeline"
  retention_in_days = 365
}

resource "aws_iam_role_policy" "lambda" {
  name_prefix = "dapanoskop-pipeline-"
  role        = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        # Cost Explorer API actions do not support resource-level permissions
        Effect = "Allow"
        Action = [
          "ce:GetCostAndUsage",
          "ce:GetCostCategories",
          "ce:ListCostCategoryDefinitions",
          "ce:DescribeCostCategoryDefinition",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
        ]
        Resource = "${var.data_bucket_arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = var.data_bucket_arn
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "${aws_cloudwatch_log_group.lambda.arn}:*"
      },
      ],
      # Read access for S3 Inventory bucket (when configured)
      var.inventory_bucket != "" ? [
        {
          Effect = "Allow"
          Action = [
            "s3:GetObject",
            "s3:ListBucket",
          ]
          Resource = [
            "arn:aws:s3:::${var.inventory_bucket}",
            "arn:aws:s3:::${var.inventory_bucket}/${var.inventory_prefix}/*",
          ]
        },
      ] : [],
    )
  })
}

resource "aws_lambda_function" "pipeline" {
  #checkov:skip=CKV_AWS_50:Once-daily cron; CloudWatch provides sufficient observability
  #checkov:skip=CKV_AWS_117:Lambda accesses only AWS APIs (Cost Explorer, S3); VPC adds cost with no benefit
  #checkov:skip=CKV_AWS_116:Synchronous EventBridge invocation with built-in retry; failures visible in CloudWatch
  #checkov:skip=CKV_AWS_173:Env vars contain only bucket name and feature flags, no secrets
  #checkov:skip=CKV_AWS_272:Deployment integrity ensured by Terraform state and CI pipeline
  function_name     = "dapanoskop-pipeline"
  role              = aws_iam_role.lambda.arn
  handler           = "dapanoskop.handler.handler"
  runtime           = "python3.12"
  s3_bucket         = local.use_s3_source ? var.lambda_s3_bucket : null
  s3_key            = local.use_s3_source ? var.lambda_s3_key : null
  s3_object_version = local.use_s3_source ? var.lambda_s3_object_version : null
  filename          = local.use_s3_source ? null : data.archive_file.lambda[0].output_path
  source_code_hash  = local.use_s3_source ? null : data.archive_file.lambda[0].output_base64sha256
  memory_size       = 256
  timeout           = 300

  reserved_concurrent_executions = 1

  depends_on = [aws_cloudwatch_log_group.lambda]

  layers = [
    "arn:aws:lambda:${data.aws_region.current.id}:336392948345:layer:AWSSDKPandas-Python312:17"
  ]

  environment {
    variables = merge(
      {
        DATA_BUCKET        = var.data_bucket_name
        COST_CATEGORY_NAME = var.cost_category_name
        INCLUDE_EFS        = tostring(var.include_efs)
        INCLUDE_EBS        = tostring(var.include_ebs)
      },
      var.inventory_bucket != "" ? {
        INVENTORY_BUCKET = var.inventory_bucket
        INVENTORY_PREFIX = var.inventory_prefix
      } : {},
    )
  }
}

resource "aws_cloudwatch_event_rule" "daily" {
  name_prefix         = "dapanoskop-pipeline-"
  schedule_expression = var.schedule_expression
}

resource "aws_cloudwatch_event_target" "lambda" {
  rule = aws_cloudwatch_event_rule.daily.name
  arn  = aws_lambda_function.pipeline.arn
}

resource "aws_lambda_permission" "eventbridge" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pipeline.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily.arn
}
