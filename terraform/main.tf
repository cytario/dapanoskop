module "artifacts" {
  source = "./modules/artifacts"

  release_version = var.release_version
  github_repo     = var.github_repo
}

module "data_store" {
  source = "./modules/data-store"
}

module "hosting" {
  source = "./modules/hosting"

  data_bucket_arn             = module.data_store.bucket_arn
  data_bucket_id              = module.data_store.bucket_name
  data_bucket_regional_domain = module.data_store.bucket_regional_domain_name
  domain_name                 = var.domain_name
  acm_certificate_arn         = var.acm_certificate_arn
  cognito_domain              = var.cognito_domain
  spa_archive_path            = module.artifacts.spa_archive_path
  cognito_client_id           = module.auth.client_id
}

module "auth" {
  source = "./modules/auth"

  cognito_user_pool_id = var.cognito_user_pool_id
  callback_urls        = [module.hosting.cloudfront_url]
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
