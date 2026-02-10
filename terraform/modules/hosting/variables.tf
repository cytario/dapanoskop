variable "data_bucket_arn" {
  description = "ARN of the data S3 bucket"
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
