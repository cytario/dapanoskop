variable "cognito_user_pool_id" {
  description = "ID of the existing Cognito User Pool"
  type        = string
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
