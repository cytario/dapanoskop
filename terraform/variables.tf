variable "cognito_user_pool_id" {
  description = "ID of an existing Cognito User Pool. Leave empty to create a managed pool."
  type        = string
  default     = ""
}

variable "cost_category_name" {
  description = "Name of the AWS Cost Category to use for cost center mapping"
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Custom domain name for the CloudFront distribution (optional)"
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ARN of the ACM certificate for the custom domain (required if domain_name is set)"
  type        = string
  default     = ""
}

variable "schedule_expression" {
  description = "EventBridge schedule expression for the data pipeline"
  type        = string
  default     = "cron(0 6 * * ? *)"
}

variable "include_efs" {
  description = "Include EFS storage in hot tier calculations"
  type        = bool
  default     = false
}

variable "include_ebs" {
  description = "Include EBS storage in hot tier calculations"
  type        = bool
  default     = false
}

variable "cognito_domain" {
  description = "Cognito domain for CSP connect-src (e.g. https://auth.example.com)"
  type        = string
  default     = ""
}

variable "release_version" {
  description = "GitHub release tag to download pre-built artifacts from (e.g. v1.2.0). Leave empty for local dev."
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "GitHub repository in owner/repo format for downloading release artifacts"
  type        = string
  default     = "cytario/dapanoskop"
}

variable "cognito_domain_prefix" {
  description = "Domain prefix for Cognito hosted UI (required when creating a managed pool)"
  type        = string
  default     = ""
}

variable "cognito_mfa_configuration" {
  description = "MFA configuration for the managed pool: OFF, OPTIONAL, or ON"
  type        = string
  default     = "OPTIONAL"
}

variable "saml_provider_name" {
  description = "Display name for the SAML identity provider (e.g. 'AzureAD')"
  type        = string
  default     = ""
}

variable "saml_metadata_url" {
  description = "SAML federation metadata URL from your IdP"
  type        = string
  default     = ""
}

variable "saml_attribute_mapping" {
  description = "Attribute mapping from SAML IdP claims to Cognito attributes"
  type        = map(string)
  default = {
    email = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
  }
}

variable "oidc_provider_name" {
  description = "Display name for the OIDC identity provider"
  type        = string
  default     = ""
}

variable "oidc_issuer" {
  description = "OIDC issuer URL from your IdP"
  type        = string
  default     = ""
}

variable "oidc_client_id" {
  description = "OIDC client ID from your IdP"
  type        = string
  default     = ""
}

variable "oidc_client_secret" {
  description = "OIDC client secret from your IdP"
  type        = string
  default     = ""
  sensitive   = true
}

variable "oidc_scopes" {
  description = "OIDC scopes to request from the IdP"
  type        = string
  default     = "openid email profile"
}

variable "oidc_attribute_mapping" {
  description = "Attribute mapping from OIDC IdP claims to Cognito attributes"
  type        = map(string)
  default = {
    email    = "email"
    username = "sub"
  }
}

variable "enable_advanced_security" {
  description = "Enable Cognito advanced security features (has per-MAU pricing)"
  type        = bool
  default     = true
}

variable "storage_lens_config_id" {
  description = "Storage Lens configuration ID to use. Leave empty to auto-discover the first org-wide config with CloudWatch metrics enabled."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Map of tags to apply to all taggable resources"
  type        = map(string)
  default     = {}
}

variable "permissions_boundary" {
  description = "ARN of an IAM permissions boundary to attach to all IAM roles. Leave empty to skip."
  type        = string
  default     = ""
}
