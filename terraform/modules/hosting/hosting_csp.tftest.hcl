mock_provider "aws" {}

variables {
  cognito_domain            = ""
  data_bucket_s3_endpoint   = ""
  cognito_identity_endpoint = ""
  domain_name               = ""
  acm_certificate_arn       = ""
  enable_access_logging     = false
  spa_s3_bucket             = ""
  spa_s3_key                = ""
  spa_s3_object_version     = ""
  cognito_client_id         = ""
  user_pool_id              = ""
  identity_pool_id          = ""
  aws_region                = ""
  data_bucket_name          = ""
  cognito_domain_prefix     = ""
}

run "csp_all_connect_src_populated" {
  command = plan

  variables {
    cognito_domain            = "https://auth.example.com"
    data_bucket_s3_endpoint   = "https://bucket.s3.eu-north-1.amazonaws.com"
    cognito_identity_endpoint = "https://cognito-identity.eu-north-1.amazonaws.com"
  }

  assert {
    condition     = strcontains(output.content_security_policy, "https://auth.example.com")
    error_message = "CSP must include cognito_domain in connect-src"
  }

  assert {
    condition     = strcontains(output.content_security_policy, "https://bucket.s3.eu-north-1.amazonaws.com")
    error_message = "CSP must include data_bucket_s3_endpoint in connect-src"
  }

  assert {
    condition     = strcontains(output.content_security_policy, "https://cognito-identity.eu-north-1.amazonaws.com")
    error_message = "CSP must include cognito_identity_endpoint in connect-src"
  }
}

run "csp_empty_connect_src_self_only" {
  command = plan

  variables {
    cognito_domain            = ""
    data_bucket_s3_endpoint   = ""
    cognito_identity_endpoint = ""
  }

  assert {
    condition     = strcontains(output.content_security_policy, "connect-src 'self';")
    error_message = "CSP connect-src must be 'self' only when all endpoints are empty"
  }
}

run "csp_frame_ancestors_none" {
  command = plan

  assert {
    condition     = strcontains(output.content_security_policy, "frame-ancestors 'none';")
    error_message = "CSP must always include frame-ancestors 'none' for clickjacking protection"
  }
}

run "csp_no_double_spaces" {
  command = plan

  assert {
    condition     = !strcontains(output.content_security_policy, "  ")
    error_message = "CSP must not contain double spaces"
  }
}

run "csp_no_double_spaces_with_all_origins" {
  command = plan

  variables {
    cognito_domain            = "https://auth.example.com"
    data_bucket_s3_endpoint   = "https://bucket.s3.eu-north-1.amazonaws.com"
    cognito_identity_endpoint = "https://cognito-identity.eu-north-1.amazonaws.com"
  }

  assert {
    condition     = !strcontains(output.content_security_policy, "  ")
    error_message = "CSP must not contain double spaces even with all origins populated"
  }
}

run "csp_semicolons_separate_directives" {
  command = plan

  variables {
    cognito_domain            = "https://auth.example.com"
    data_bucket_s3_endpoint   = "https://bucket.s3.eu-north-1.amazonaws.com"
    cognito_identity_endpoint = "https://cognito-identity.eu-north-1.amazonaws.com"
  }

  assert {
    condition     = strcontains(output.content_security_policy, "default-src 'self';")
    error_message = "default-src directive must end with semicolon"
  }

  assert {
    condition     = strcontains(output.content_security_policy, "object-src 'none';")
    error_message = "object-src directive must end with semicolon"
  }
}
