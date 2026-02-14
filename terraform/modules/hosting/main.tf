terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

resource "aws_s3_bucket" "app" {
  #checkov:skip=CKV2_AWS_62:Event notifications not needed for static SPA asset bucket
  #checkov:skip=CKV_AWS_144:Cross-region replication not justified for internal tool
  #checkov:skip=CKV_AWS_145:SSE-S3 (AES256) sufficient; no compliance requirement for KMS
  bucket_prefix = "dapanoskop-app-"
}

resource "aws_s3_bucket_versioning" "app" {
  bucket = aws_s3_bucket.app.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app" {
  bucket = aws_s3_bucket.app.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "app" {
  bucket = aws_s3_bucket.app.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "app" {
  bucket = aws_s3_bucket.app.id

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  rule {
    id     = "expire-delete-markers"
    status = "Enabled"

    expiration {
      expired_object_delete_marker = true
    }
  }
}

resource "aws_s3_bucket" "logs" {
  #checkov:skip=CKV2_AWS_62:Event notifications not needed for access log bucket
  #checkov:skip=CKV_AWS_144:Cross-region replication not justified for access logs
  #checkov:skip=CKV_AWS_145:SSE-S3 (AES256) sufficient; no compliance requirement for KMS
  #checkov:skip=CKV_AWS_21:Versioning unnecessary for ephemeral access logs with 90-day expiry
  count         = var.enable_access_logging ? 1 : 0
  bucket_prefix = "dapanoskop-logs-"
}

resource "aws_s3_bucket_public_access_block" "logs" {
  count  = var.enable_access_logging ? 1 : 0
  bucket = aws_s3_bucket.logs[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  count  = var.enable_access_logging ? 1 : 0
  bucket = aws_s3_bucket.logs[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  count  = var.enable_access_logging ? 1 : 0
  bucket = aws_s3_bucket.logs[0].id

  rule {
    id     = "expire-logs"
    status = "Enabled"

    expiration {
      days = 90
    }
  }

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_ownership_controls" "logs" {
  #checkov:skip=CKV2_AWS_65:BucketOwnerPreferred + log-delivery-write ACL required for S3/CloudFront log delivery
  count  = var.enable_access_logging ? 1 : 0
  bucket = aws_s3_bucket.logs[0].id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_acl" "logs" {
  count  = var.enable_access_logging ? 1 : 0
  bucket = aws_s3_bucket.logs[0].id
  acl    = "log-delivery-write"

  depends_on = [aws_s3_bucket_ownership_controls.logs]
}

resource "aws_s3_bucket_logging" "app" {
  count         = var.enable_access_logging ? 1 : 0
  bucket        = aws_s3_bucket.app.id
  target_bucket = aws_s3_bucket.logs[0].id
  target_prefix = "s3-app/"
}

resource "aws_cloudfront_origin_access_control" "app" {
  name                              = "dapanoskop-app"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_response_headers_policy" "security" {
  name = "dapanoskop-security-headers"

  security_headers_config {
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_security_policy {
      content_security_policy = join(" ", [
        "default-src 'self';",
        "script-src 'self' 'unsafe-inline';",
        "style-src 'self' 'unsafe-inline';",
        "worker-src 'self' blob:;",
        "connect-src 'self'${var.cognito_domain != "" ? " ${var.cognito_domain}" : ""}${var.data_bucket_s3_endpoint != "" ? " ${var.data_bucket_s3_endpoint}" : ""}${var.cognito_identity_endpoint != "" ? " ${var.cognito_identity_endpoint}" : ""};",
        "img-src 'self' data:;",
        "font-src 'self';",
        "object-src 'none';",
        "frame-ancestors 'none';",
        "base-uri 'self';",
        "form-action 'self'",
      ])
      override = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=()"
      override = true
    }
  }
}

resource "aws_cloudfront_distribution" "main" {
  #checkov:skip=CKV_AWS_68:WAF not justified for internal Cognito-gated static site
  #checkov:skip=CKV_AWS_310:Single S3 origin; no failover target exists
  #checkov:skip=CKV_AWS_374:No geo-restriction requirement; access controlled by Cognito auth
  #checkov:skip=CKV2_AWS_42:Custom SSL certificate is optional; default *.cloudfront.net cert used when acm_certificate_arn not set
  #checkov:skip=CKV2_AWS_47:WAF not justified for internal Cognito-gated static site (see CKV_AWS_68)
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  aliases = var.domain_name != "" ? [var.domain_name] : []

  origin {
    domain_name              = aws_s3_bucket.app.bucket_regional_domain_name
    origin_id                = "app"
    origin_access_control_id = aws_cloudfront_origin_access_control.app.id
  }

  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "app"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  dynamic "logging_config" {
    for_each = var.enable_access_logging ? [1] : []
    content {
      bucket          = aws_s3_bucket.logs[0].bucket_domain_name
      prefix          = "cloudfront/"
      include_cookies = false
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  dynamic "viewer_certificate" {
    for_each = var.acm_certificate_arn != "" ? [1] : []
    content {
      acm_certificate_arn      = var.acm_certificate_arn
      ssl_support_method       = "sni-only"
      minimum_protocol_version = "TLSv1.2_2021"
    }
  }

  # Dev-only fallback: uses the default *.cloudfront.net certificate.
  # Production deployments should always set acm_certificate_arn.
  dynamic "viewer_certificate" {
    for_each = var.acm_certificate_arn != "" ? [] : [1]
    content {
      cloudfront_default_certificate = true
    }
  }
}

resource "aws_s3_bucket_policy" "app" {
  bucket = aws_s3_bucket.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontServicePrincipal"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.app.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.main.arn
          }
        }
      }
    ]
  })
}

resource "terraform_data" "deploy_spa" {
  count = var.spa_s3_key != "" ? 1 : 0

  input = var.spa_s3_object_version

  provisioner "local-exec" {
    command = <<-EOT
      TMPDIR=$(mktemp -d)
      aws s3 cp "s3://${var.spa_s3_bucket}/${var.spa_s3_key}" "$TMPDIR/spa.tar.gz"
      tar -xzf "$TMPDIR/spa.tar.gz" -C "$TMPDIR"
      rm -f "$TMPDIR/spa.tar.gz"
      aws s3 sync "$TMPDIR" "s3://${aws_s3_bucket.app.id}" --delete --exclude "config.json"
      rm -rf "$TMPDIR"
    EOT
  }
}

resource "aws_s3_object" "config_json" {
  count = var.cognito_client_id != "" ? 1 : 0

  bucket       = aws_s3_bucket.app.id
  key          = "config.json"
  content_type = "application/json"

  content = jsonencode({
    cognitoDomain   = var.cognito_domain
    cognitoClientId = var.cognito_client_id
    userPoolId      = var.user_pool_id
    identityPoolId  = var.identity_pool_id
    awsRegion       = var.aws_region
    dataBucketName  = var.data_bucket_name
  })

  depends_on = [terraform_data.deploy_spa]
}

resource "terraform_data" "invalidate_cloudfront" {
  count = var.spa_s3_key != "" ? 1 : 0

  input = terraform_data.deploy_spa[0].output

  provisioner "local-exec" {
    command = "aws cloudfront create-invalidation --distribution-id ${aws_cloudfront_distribution.main.id} --paths '/*'"
  }

  depends_on = [aws_s3_object.config_json]
}
