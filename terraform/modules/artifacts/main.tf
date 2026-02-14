terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  use_release = var.release_version != ""
  base_url    = "https://github.com/${var.github_repo}/releases/download/${var.release_version}"
}

# -----------------------------------------------------------------------------
# Artifacts S3 bucket — stores release assets (Lambda zip, SPA tarball)
# Separate from the app bucket to avoid CloudFront exposure and s3 sync --delete
# Always created (empty bucket costs nothing) so checkov can trace companion
# resources without count-index ambiguity.
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "artifacts" {
  #checkov:skip=CKV2_AWS_62:Event notifications not needed for deployment artifact bucket
  #checkov:skip=CKV_AWS_144:Cross-region replication not justified for deployment artifacts
  #checkov:skip=CKV_AWS_18:Access logging not needed for deployment artifact bucket with restricted access
  #checkov:skip=CKV_AWS_145:SSE-S3 (AES256) sufficient; no compliance requirement for KMS
  bucket_prefix = "dapanoskop-artifacts-"
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"
    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

resource "aws_s3_bucket_policy" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowLambdaServiceGetObject"
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.artifacts.arn}/*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Upload release artifacts to S3
# -----------------------------------------------------------------------------

resource "terraform_data" "upload_lambda" {
  count = local.use_release ? 1 : 0

  input = var.release_version

  provisioner "local-exec" {
    command = <<-EOT
      TMPFILE=$(mktemp)
      curl -fsSL -o "$TMPFILE" "${local.base_url}/lambda.zip"
      aws s3 cp "$TMPFILE" "s3://${aws_s3_bucket.artifacts.id}/${var.release_version}/lambda.zip"
      rm -f "$TMPFILE"
    EOT
  }
}

resource "terraform_data" "upload_spa" {
  count = local.use_release ? 1 : 0

  input = var.release_version

  provisioner "local-exec" {
    command = <<-EOT
      TMPFILE=$(mktemp)
      curl -fsSL -o "$TMPFILE" "${local.base_url}/spa.tar.gz"
      aws s3 cp "$TMPFILE" "s3://${aws_s3_bucket.artifacts.id}/${var.release_version}/spa.tar.gz"
      rm -f "$TMPFILE"
    EOT
  }
}

# -----------------------------------------------------------------------------
# Data sources to read uploaded S3 objects (for version-based change detection)
# -----------------------------------------------------------------------------

data "aws_s3_object" "lambda_zip" {
  count  = local.use_release ? 1 : 0
  bucket = aws_s3_bucket.artifacts.id
  key    = "${var.release_version}/lambda.zip"

  depends_on = [terraform_data.upload_lambda]
}

data "aws_s3_object" "spa_archive" {
  count  = local.use_release ? 1 : 0
  bucket = aws_s3_bucket.artifacts.id
  key    = "${var.release_version}/spa.tar.gz"

  depends_on = [terraform_data.upload_spa]
}
