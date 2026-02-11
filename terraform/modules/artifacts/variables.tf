variable "release_version" {
  description = "GitHub release tag to download artifacts from (e.g. v1.2.0). Leave empty for local dev."
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "GitHub repository in owner/repo format"
  type        = string
  default     = "cytario/dapanoskop"
}
