output "function_name" {
  description = "Name of the Lambda function"
  value       = aws_lambda_function.pipeline.function_name
}

output "iam_policy_json" {
  description = "The IAM policy JSON attached to the Lambda role (for testing)"
  value       = aws_iam_role_policy.lambda.policy
}
