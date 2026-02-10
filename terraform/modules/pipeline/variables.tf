variable "data_bucket_arn" {
  description = "ARN of the data S3 bucket"
  type        = string
}

variable "data_bucket_name" {
  description = "Name of the data S3 bucket"
  type        = string
}

variable "cost_category_name" {
  description = "AWS Cost Category name"
  type        = string
  default     = ""
}

variable "schedule_expression" {
  description = "EventBridge schedule expression"
  type        = string
  default     = "cron(0 6 * * ? *)"
}

variable "include_efs" {
  description = "Include EFS in storage calculations"
  type        = bool
  default     = false
}

variable "include_ebs" {
  description = "Include EBS in storage calculations"
  type        = bool
  default     = false
}
