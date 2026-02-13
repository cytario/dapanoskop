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

data "archive_file" "lambda" {
  count       = var.lambda_zip_path != "" ? 0 : 1
  type        = "zip"
  source_dir  = "${path.module}/../../../lambda/src"
  output_path = "${path.module}/lambda.zip"
}

locals {
  lambda_filename = var.lambda_zip_path != "" ? var.lambda_zip_path : data.archive_file.lambda[0].output_path
  lambda_hash     = var.lambda_zip_path != "" ? var.lambda_zip_hash : data.archive_file.lambda[0].output_base64sha256
}

resource "aws_iam_role" "lambda" {
  name_prefix = "dapanoskop-pipeline-"

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
  name              = "/aws/lambda/dapanoskop-pipeline"
  retention_in_days = 30
}

resource "aws_iam_role_policy" "lambda" {
  name_prefix = "dapanoskop-pipeline-"
  role        = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Cost Explorer API actions do not support resource-level permissions
        Effect = "Allow"
        Action = [
          "ce:GetCostAndUsage",
          "ce:GetCostCategories",
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
    ]
  })
}

resource "aws_lambda_function" "pipeline" {
  function_name    = "dapanoskop-pipeline"
  role             = aws_iam_role.lambda.arn
  handler          = "dapanoskop.handler.handler"
  runtime          = "python3.12"
  filename         = local.lambda_filename
  source_code_hash = local.lambda_hash
  memory_size      = 256
  timeout          = 300

  reserved_concurrent_executions = 1

  depends_on = [aws_cloudwatch_log_group.lambda]

  layers = [
    "arn:aws:lambda:${data.aws_region.current.id}:336392948345:layer:AWSSDKPandas-Python312:17"
  ]

  environment {
    variables = {
      DATA_BUCKET        = var.data_bucket_name
      COST_CATEGORY_NAME = var.cost_category_name
      INCLUDE_EFS        = tostring(var.include_efs)
      INCLUDE_EBS        = tostring(var.include_ebs)
    }
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
