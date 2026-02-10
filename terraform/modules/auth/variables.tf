variable "cognito_user_pool_id" {
  description = "ID of the existing Cognito User Pool"
  type        = string
}

variable "callback_urls" {
  description = "Allowed callback URLs for the Cognito app client"
  type        = list(string)
}
