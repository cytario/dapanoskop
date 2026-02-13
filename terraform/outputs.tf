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

output "cognito_user_pool_id" {
  description = "ID of the Cognito User Pool"
  value       = module.auth.user_pool_id
}

output "cognito_domain_url" {
  description = "Cognito hosted UI domain URL"
  value       = module.auth.cognito_domain
}

output "saml_entity_id" {
  description = "SAML Entity ID for IdP configuration"
  value       = module.auth.saml_entity_id
}

output "saml_acs_url" {
  description = "SAML ACS URL for IdP configuration"
  value       = module.auth.saml_acs_url
}

output "identity_pool_id" {
  description = "Cognito Identity Pool ID"
  value       = module.auth.identity_pool_id
}
