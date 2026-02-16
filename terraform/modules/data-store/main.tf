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
  #checkov:skip=CKV2_AWS_62:Event notifications not needed for cost data bucket
  #checkov:skip=CKV_AWS_144:Cross-region replication not justified for regenerable cost data
  #checkov:skip=CKV_AWS_18:Access logging available via enable_access_logging variable at root module level
  #checkov:skip=CKV_AWS_145:SSE-S3 (AES256) sufficient; no compliance requirement for KMS
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

resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"
    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  rule {
    id     = "expire-delete-markers"
    status = "Enabled"
    filter {}

    expiration {
      expired_object_delete_marker = true
    }
  }

  rule {
    id     = "transition-to-intelligent-tiering"
    status = "Enabled"
    filter {}

    transition {
      days          = 5
      storage_class = "INTELLIGENT_TIERING"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  cors_rule {
    # x-host-override: DuckDB-wasm renames the forbidden browser "Host" header
    # to "X-Host-Override" in its HTTP adapter (http_wasm.cc). S3 ignores it,
    # but the CORS preflight must allow it or the browser blocks the request.
    allowed_headers = ["Authorization", "Range", "x-amz-*", "amz-sdk-*", "x-host-override"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = var.allowed_origins
    expose_headers  = ["Content-Length", "Content-Range", "ETag"]
    max_age_seconds = 300
  }
}
