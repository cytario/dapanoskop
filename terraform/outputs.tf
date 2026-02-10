output "cloudfront_url" {
  description = "URL of the CloudFront distribution"
  value       = module.hosting.cloudfront_url
}

output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution"
  value       = module.hosting.cloudfront_distribution_id
}

output "data_bucket_name" {
  description = "Name of the S3 data bucket"
  value       = module.data_store.bucket_name
}

output "app_bucket_name" {
  description = "Name of the S3 app bucket"
  value       = module.hosting.app_bucket_name
}

output "cognito_client_id" {
  description = "ID of the Cognito app client"
  value       = module.auth.client_id
}

output "lambda_function_name" {
  description = "Name of the Lambda function"
  value       = module.pipeline.function_name
}
