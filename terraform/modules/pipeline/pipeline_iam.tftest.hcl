mock_provider "aws" {
  mock_data "aws_region" {
    defaults = {
      id   = "eu-north-1"
      name = "eu-north-1"
    }
  }

  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::123456789012:role/test-lambda-role"
    }
  }

  mock_resource "aws_lambda_function" {
    defaults = {
      arn = "arn:aws:lambda:eu-north-1:123456789012:function:test-pipeline"
    }
  }

  mock_resource "aws_cloudwatch_event_rule" {
    defaults = {
      arn = "arn:aws:events:eu-north-1:123456789012:rule/test-daily"
    }
  }

  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:eu-north-1:123456789012:log-group:/aws/lambda/dapanoskop-pipeline"
    }
  }
}

mock_provider "archive" {}

variables {
  data_bucket_arn  = "arn:aws:s3:::test-data-bucket"
  data_bucket_name = "test-data-bucket"
  lambda_s3_bucket = "test-artifacts"
  lambda_s3_key    = "lambda/test.zip"
}

run "ce_actions_are_exact" {
  command = plan

  assert {
    condition     = output.iam_policy_json != ""
    error_message = "IAM policy output must not be empty"
  }

  assert {
    condition = contains(
      jsondecode(output.iam_policy_json).Statement[0].Action,
      "ce:GetCostAndUsage"
    )
    error_message = "Policy must include ce:GetCostAndUsage"
  }

  assert {
    condition = contains(
      jsondecode(output.iam_policy_json).Statement[0].Action,
      "ce:GetCostCategories"
    )
    error_message = "Policy must include ce:GetCostCategories"
  }

  assert {
    condition = contains(
      jsondecode(output.iam_policy_json).Statement[0].Action,
      "ce:ListCostCategoryDefinitions"
    )
    error_message = "Policy must include ce:ListCostCategoryDefinitions"
  }

  assert {
    condition = contains(
      jsondecode(output.iam_policy_json).Statement[0].Action,
      "ce:DescribeCostCategoryDefinition"
    )
    error_message = "Policy must include ce:DescribeCostCategoryDefinition"
  }

  assert {
    condition     = length(jsondecode(output.iam_policy_json).Statement[0].Action) == 4
    error_message = "CE statement must contain exactly 4 actions (GetCostAndUsage, GetCostCategories, ListCostCategoryDefinitions, DescribeCostCategoryDefinition)"
  }
}

run "no_wildcard_actions" {
  command = plan

  assert {
    condition = !contains(
      jsondecode(output.iam_policy_json).Statement[0].Action,
      "ce:*"
    )
    error_message = "CE statement must not contain ce:* wildcard"
  }

  assert {
    condition = !contains(
      [jsondecode(output.iam_policy_json).Statement[1].Action],
      "s3:*"
    )
    error_message = "S3 PutObject statement must not contain s3:* wildcard"
  }

  assert {
    condition = alltrue([
      for stmt in jsondecode(output.iam_policy_json).Statement :
      !anytrue([
        for action in(
          try(tolist(stmt.Action), [stmt.Action])
        ) : endswith(action, ":*")
      ])
    ])
    error_message = "No IAM statement may contain a service-level wildcard action (e.g. s3:*, iam:*, ce:*)"
  }
}

run "s3_put_scoped_to_bucket" {
  command = plan

  assert {
    condition     = jsondecode(output.iam_policy_json).Statement[1].Resource == "arn:aws:s3:::test-data-bucket/*"
    error_message = "S3 PutObject must be scoped to the specific data bucket ARN with /* suffix"
  }

  assert {
    condition     = jsondecode(output.iam_policy_json).Statement[1].Resource != "*"
    error_message = "S3 PutObject resource must not be a wildcard"
  }
}

run "s3_list_scoped_to_bucket" {
  command = plan

  assert {
    condition     = jsondecode(output.iam_policy_json).Statement[2].Resource == "arn:aws:s3:::test-data-bucket"
    error_message = "S3 ListBucket must be scoped to the exact data bucket ARN"
  }

  assert {
    condition     = jsondecode(output.iam_policy_json).Statement[2].Resource != "*"
    error_message = "S3 ListBucket resource must not be a wildcard"
  }
}

run "logs_scoped_to_log_group" {
  command = plan

  assert {
    condition     = !strcontains(jsondecode(output.iam_policy_json).Statement[3].Resource, "*:*:*:*:*:*")
    error_message = "CloudWatch Logs resource must not use broad wildcard ARN"
  }

  assert {
    condition     = strcontains(jsondecode(output.iam_policy_json).Statement[3].Resource, "/aws/lambda/dapanoskop-pipeline")
    error_message = "CloudWatch Logs resource must reference the specific log group"
  }
}

run "storage_lens_permissions" {
  command = plan

  assert {
    condition = contains(
      jsondecode(output.iam_policy_json).Statement[4].Action,
      "s3:ListStorageLensConfigurations"
    )
    error_message = "Policy must include s3:ListStorageLensConfigurations"
  }

  assert {
    condition = contains(
      jsondecode(output.iam_policy_json).Statement[4].Action,
      "s3:GetStorageLensConfiguration"
    )
    error_message = "Policy must include s3:GetStorageLensConfiguration"
  }

  assert {
    condition     = length(jsondecode(output.iam_policy_json).Statement[4].Action) == 2
    error_message = "S3 Control statement must contain exactly 2 actions"
  }

  assert {
    condition     = jsondecode(output.iam_policy_json).Statement[4].Resource == "*"
    error_message = "S3 Control actions require wildcard resource (no resource-level permissions)"
  }
}

run "cloudwatch_metrics_permissions" {
  command = plan

  assert {
    condition = contains(
      jsondecode(output.iam_policy_json).Statement[5].Action,
      "cloudwatch:ListMetrics"
    )
    error_message = "Policy must include cloudwatch:ListMetrics"
  }

  assert {
    condition = contains(
      jsondecode(output.iam_policy_json).Statement[5].Action,
      "cloudwatch:GetMetricData"
    )
    error_message = "Policy must include cloudwatch:GetMetricData"
  }

  assert {
    condition     = length(jsondecode(output.iam_policy_json).Statement[5].Action) == 2
    error_message = "CloudWatch statement must contain exactly 2 actions"
  }

  assert {
    condition     = jsondecode(output.iam_policy_json).Statement[5].Resource == "*"
    error_message = "CloudWatch actions require wildcard resource (no resource-level permissions)"
  }
}

run "total_statement_count" {
  command = plan

  assert {
    condition     = length(jsondecode(output.iam_policy_json).Statement) == 6
    error_message = "Policy must contain exactly 6 statements (CE, S3 PutObject, S3 ListBucket, Logs, S3 Control, CloudWatch)"
  }
}
