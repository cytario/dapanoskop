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

variable "inventory_bucket" {
  description = "S3 bucket containing S3 Inventory delivery. Leave empty to disable inventory integration."
  type        = string
  default     = ""
}

variable "inventory_prefix" {
  description = "S3 prefix to the inventory config (e.g., inventory/source-bucket/AllObjects)"
  type        = string
  default     = ""
}

variable "lambda_s3_bucket" {
  description = "S3 bucket containing a pre-built Lambda zip. If empty, archive_file builds from source."
  type        = string
  default     = ""
}

variable "lambda_s3_key" {
  description = "S3 key of the pre-built Lambda zip"
  type        = string
  default     = ""
}

variable "lambda_s3_object_version" {
  description = "S3 version ID of the pre-built Lambda zip"
  type        = string
  default     = ""
}

variable "permissions_boundary" {
  description = "ARN of an IAM permissions boundary to attach to IAM roles. Leave empty to skip."
  type        = string
  default     = ""
}
