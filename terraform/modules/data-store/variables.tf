variable "allowed_origins" {
  description = "CORS allowed origins for direct S3 access from the browser (e.g. CloudFront domain)"
  type        = list(string)
  default     = []
}
