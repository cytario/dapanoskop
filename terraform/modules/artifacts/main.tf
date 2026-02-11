locals {
  use_release  = var.release_version != ""
  download_dir = "${path.module}/.downloads/${var.release_version}"
  base_url     = "https://github.com/${var.github_repo}/releases/download/${var.release_version}"
}

resource "terraform_data" "download" {
  count = local.use_release ? 1 : 0

  input = var.release_version

  provisioner "local-exec" {
    command = <<-EOT
      mkdir -p "${local.download_dir}"
      curl -fsSL -o "${local.download_dir}/lambda.zip" "${local.base_url}/lambda.zip"
      curl -fsSL -o "${local.download_dir}/spa.tar.gz" "${local.base_url}/spa.tar.gz"
    EOT
  }
}
