data "aws_region" "current" {}

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../../../lambda/src"
  output_path = "${path.module}/lambda.zip"
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

resource "aws_iam_role_policy" "lambda" {
  name_prefix = "dapanoskop-pipeline-"
  role        = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
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
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
    ]
  })
}

resource "aws_lambda_function" "pipeline" {
  function_name    = "dapanoskop-pipeline"
  role             = aws_iam_role.lambda.arn
  handler          = "dapanoskop.handler.handler"
  runtime          = "python3.12"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  memory_size      = 256
  timeout          = 300

  reserved_concurrent_executions = 1

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
