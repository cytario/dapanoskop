terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

resource "aws_s3_bucket" "data" {
  bucket_prefix = "dapanoskop-data-"
}

resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket = aws_s3_bucket.data.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "data" {
  count  = length(var.allowed_origins) > 0 ? 1 : 0
  bucket = aws_s3_bucket.data.id

  cors_rule {
    allowed_headers = ["Authorization", "Range", "x-amz-*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = var.allowed_origins
    expose_headers  = ["Content-Length", "Content-Range", "ETag"]
    max_age_seconds = 300
  }
}
