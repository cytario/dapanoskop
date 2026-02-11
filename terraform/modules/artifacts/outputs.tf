output "use_release" {
  description = "Whether release artifacts are being used"
  value       = local.use_release
}

output "lambda_zip_path" {
  description = "Path to the downloaded Lambda zip, or empty if not using release"
  value       = local.use_release ? "${local.download_dir}/lambda.zip" : ""
}

output "lambda_zip_hash" {
  description = "Base64-encoded SHA256 hash of the Lambda zip, or empty if not using release"
  value       = local.use_release ? filebase64sha256("${local.download_dir}/lambda.zip") : ""
  depends_on  = [terraform_data.download]
}

output "spa_archive_path" {
  description = "Path to the downloaded SPA tarball, or empty if not using release"
  value       = local.use_release ? "${local.download_dir}/spa.tar.gz" : ""
}
