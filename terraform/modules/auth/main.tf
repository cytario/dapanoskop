terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

data "aws_region" "current" {}

locals {
  create_user_pool = var.cognito_user_pool_id == ""
  user_pool_id     = local.create_user_pool ? aws_cognito_user_pool.managed[0].id : var.cognito_user_pool_id
  has_saml         = var.saml_metadata_url != ""
  has_oidc         = var.oidc_issuer != ""
  has_federation   = local.has_saml || local.has_oidc

  identity_providers = concat(
    local.has_federation ? [] : ["COGNITO"],
    local.has_saml ? [var.saml_provider_name] : [],
    local.has_oidc ? [var.oidc_provider_name] : [],
  )

  cognito_domain = local.create_user_pool ? "https://${var.cognito_domain_prefix}.auth.${data.aws_region.current.id}.amazoncognito.com" : ""
}

resource "aws_cognito_user_pool" "managed" {
  count = local.create_user_pool ? 1 : 0

  name                     = "dapanoskop"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = "ACTIVE"
  mfa_configuration        = var.cognito_mfa_configuration

  dynamic "software_token_mfa_configuration" {
    for_each = var.cognito_mfa_configuration != "OFF" ? [1] : []
    content {
      enabled = true
    }
  }

  password_policy {
    minimum_length                   = 14
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 3
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  dynamic "user_pool_add_ons" {
    for_each = var.enable_advanced_security ? [1] : []
    content {
      advanced_security_mode = "ENFORCED"
    }
  }
}

resource "aws_cognito_user_pool_domain" "managed" {
  count = local.create_user_pool ? 1 : 0

  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.managed[0].id

  lifecycle {
    precondition {
      condition     = var.cognito_domain_prefix != ""
      error_message = "cognito_domain_prefix is required when creating a managed Cognito User Pool."
    }
  }
}

resource "aws_cognito_identity_provider" "saml" {
  count = local.create_user_pool && local.has_saml ? 1 : 0

  user_pool_id  = aws_cognito_user_pool.managed[0].id
  provider_name = var.saml_provider_name
  provider_type = "SAML"

  provider_details = {
    MetadataURL = var.saml_metadata_url
  }

  attribute_mapping = var.saml_attribute_mapping

  lifecycle {
    precondition {
      condition     = var.saml_provider_name != ""
      error_message = "saml_provider_name is required when saml_metadata_url is set."
    }
  }
}

resource "aws_cognito_identity_provider" "oidc" {
  count = local.create_user_pool && local.has_oidc ? 1 : 0

  user_pool_id  = aws_cognito_user_pool.managed[0].id
  provider_name = var.oidc_provider_name
  provider_type = "OIDC"

  provider_details = {
    client_id                     = var.oidc_client_id
    client_secret                 = var.oidc_client_secret
    oidc_issuer                   = var.oidc_issuer
    authorize_scopes              = var.oidc_scopes
    attributes_url_add_attributes = "true"
  }

  attribute_mapping = var.oidc_attribute_mapping

  lifecycle {
    precondition {
      condition     = var.oidc_provider_name != ""
      error_message = "oidc_provider_name is required when oidc_issuer is set."
    }
    precondition {
      condition     = var.oidc_client_id != ""
      error_message = "oidc_client_id is required when oidc_issuer is set."
    }
    precondition {
      condition     = var.oidc_client_secret != ""
      error_message = "oidc_client_secret is required when oidc_issuer is set."
    }
  }
}

resource "aws_cognito_user_pool_client" "app" {
  name         = "dapanoskop"
  user_pool_id = local.user_pool_id

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = local.identity_providers

  callback_urls = var.callback_urls
  logout_urls   = var.callback_urls

  generate_secret               = false
  enable_token_revocation       = true
  prevent_user_existence_errors = "ENABLED"
  access_token_validity         = 1
  id_token_validity             = 1
  refresh_token_validity        = 12

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "hours"
  }

  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  depends_on = [
    aws_cognito_identity_provider.saml,
    aws_cognito_identity_provider.oidc,
  ]
}
