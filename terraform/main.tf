data "aws_region" "current" {}

module "artifacts" {
  source = "./modules/artifacts"

  release_version = var.release_version
  github_repo     = var.github_repo
}

module "data_store" {
  source = "./modules/data-store"

  allowed_origins = compact([
    "https://${module.hosting.cloudfront_domain_name}",
    var.domain_name != "" ? "https://${var.domain_name}" : "",
  ])
}

module "hosting" {
  source = "./modules/hosting"

  domain_name               = var.domain_name
  acm_certificate_arn       = var.acm_certificate_arn
  cognito_domain            = coalesce(var.cognito_domain, module.auth.cognito_domain)
  spa_archive_path          = module.artifacts.spa_archive_path
  cognito_client_id         = module.auth.client_id
  user_pool_id              = module.auth.user_pool_id
  identity_pool_id          = module.auth.identity_pool_id
  aws_region                = data.aws_region.current.id
  data_bucket_name          = module.data_store.bucket_name
  data_bucket_s3_endpoint   = "https://${module.data_store.bucket_regional_domain_name}"
  cognito_identity_endpoint = "https://cognito-identity.${data.aws_region.current.id}.amazonaws.com"
}

module "auth" {
  source = "./modules/auth"

  cognito_user_pool_id      = var.cognito_user_pool_id
  callback_urls             = [module.hosting.cloudfront_url]
  cognito_domain_prefix     = var.cognito_domain_prefix
  cognito_mfa_configuration = var.cognito_mfa_configuration
  saml_provider_name        = var.saml_provider_name
  saml_metadata_url         = var.saml_metadata_url
  saml_attribute_mapping    = var.saml_attribute_mapping
  oidc_provider_name        = var.oidc_provider_name
  oidc_issuer               = var.oidc_issuer
  oidc_client_id            = var.oidc_client_id
  oidc_client_secret        = var.oidc_client_secret
  oidc_scopes               = var.oidc_scopes
  oidc_attribute_mapping    = var.oidc_attribute_mapping
  enable_advanced_security  = var.enable_advanced_security
  data_bucket_arn           = module.data_store.bucket_arn
}

module "pipeline" {
  source = "./modules/pipeline"

  data_bucket_arn     = module.data_store.bucket_arn
  data_bucket_name    = module.data_store.bucket_name
  cost_category_name  = var.cost_category_name
  schedule_expression = var.schedule_expression
  include_efs         = var.include_efs
  include_ebs         = var.include_ebs
  lambda_zip_path     = module.artifacts.lambda_zip_path
  lambda_zip_hash     = module.artifacts.lambda_zip_hash
}
