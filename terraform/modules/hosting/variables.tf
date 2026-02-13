variable "domain_name" {
  description = "Custom domain name (optional)"
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN (required if domain_name is set)"
  type        = string
  default     = ""
}

variable "cognito_domain" {
  description = "Cognito domain for CSP connect-src (e.g. https://auth.example.com)"
  type        = string
  default     = ""
}

variable "enable_access_logging" {
  description = "Enable S3 and CloudFront access logging"
  type        = bool
  default     = false
}

variable "spa_archive_path" {
  description = "Path to the SPA tarball. If empty, SPA is deployed manually."
  type        = string
  default     = ""
}

variable "cognito_client_id" {
  description = "Cognito app client ID for runtime config"
  type        = string
  default     = ""
}

variable "user_pool_id" {
  description = "Cognito User Pool ID for runtime config"
  type        = string
  default     = ""
}

variable "identity_pool_id" {
  description = "Cognito Identity Pool ID for runtime config"
  type        = string
  default     = ""
}

variable "aws_region" {
  description = "AWS region for runtime config"
  type        = string
  default     = ""
}

variable "data_bucket_name" {
  description = "Data S3 bucket name for runtime config"
  type        = string
  default     = ""
}

variable "data_bucket_s3_endpoint" {
  description = "S3 endpoint for data bucket CSP (e.g. https://bucket.s3.region.amazonaws.com)"
  type        = string
  default     = ""
}

variable "cognito_identity_endpoint" {
  description = "Cognito Identity endpoint for CSP (e.g. https://cognito-identity.region.amazonaws.com)"
  type        = string
  default     = ""
}
