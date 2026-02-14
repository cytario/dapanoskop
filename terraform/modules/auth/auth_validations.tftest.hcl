mock_provider "aws" {}

run "mfa_invalid_value" {
  command = plan

  variables {
    cognito_mfa_configuration = "INVALID"
    callback_urls             = ["https://example.com"]
    data_bucket_arn           = "arn:aws:s3:::test-bucket"
  }

  expect_failures = [var.cognito_mfa_configuration]
}

run "saml_url_not_https" {
  command = plan

  variables {
    saml_metadata_url = "http://insecure.example.com/metadata"
    callback_urls     = ["https://example.com"]
    data_bucket_arn   = "arn:aws:s3:::test-bucket"
  }

  expect_failures = [var.saml_metadata_url]
}

run "oidc_issuer_not_https" {
  command = plan

  variables {
    oidc_issuer     = "http://insecure.example.com"
    callback_urls   = ["https://example.com"]
    data_bucket_arn = "arn:aws:s3:::test-bucket"
  }

  expect_failures = [var.oidc_issuer]
}
