output "use_release" {
  description = "Whether release artifacts are being used"
  value       = local.use_release
}

output "lambda_s3_bucket" {
  description = "S3 bucket containing the Lambda zip"
  value       = local.use_release ? aws_s3_bucket.artifacts[0].id : ""
}

output "lambda_s3_key" {
  description = "S3 key of the Lambda zip"
  value       = local.use_release ? data.aws_s3_object.lambda_zip[0].key : ""
}

output "lambda_s3_object_version" {
  description = "S3 version ID of the Lambda zip"
  value       = local.use_release ? data.aws_s3_object.lambda_zip[0].version_id : ""
}

output "spa_s3_bucket" {
  description = "S3 bucket containing the SPA tarball"
  value       = local.use_release ? aws_s3_bucket.artifacts[0].id : ""
}

output "spa_s3_key" {
  description = "S3 key of the SPA tarball"
  value       = local.use_release ? data.aws_s3_object.spa_archive[0].key : ""
}

output "spa_s3_object_version" {
  description = "S3 version ID of the SPA tarball"
  value       = local.use_release ? data.aws_s3_object.spa_archive[0].version_id : ""
}
