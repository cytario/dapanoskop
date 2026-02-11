variable "data_bucket_arn" {
  description = "ARN of the data S3 bucket"
  type        = string
}

variable "data_bucket_id" {
  description = "ID (name) of the data S3 bucket"
  type        = string
}

variable "data_bucket_regional_domain" {
  description = "Regional domain name of the data S3 bucket"
  type        = string
}

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
