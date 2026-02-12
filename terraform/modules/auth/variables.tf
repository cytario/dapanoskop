variable "cognito_user_pool_id" {
  description = "ID of an existing Cognito User Pool. Leave empty to create a managed pool."
  type        = string
  default     = ""
}

variable "callback_urls" {
  description = "Allowed callback URLs for the Cognito app client"
  type        = list(string)
}

variable "cognito_domain_prefix" {
  description = "Domain prefix for Cognito hosted UI (e.g. 'dapanoskop-myorg'). Required when creating a managed pool without a custom domain."
  type        = string
  default     = ""
}

variable "cognito_mfa_configuration" {
  description = "MFA configuration for the managed pool: OFF, OPTIONAL, or ON"
  type        = string
  default     = "OPTIONAL"

  validation {
    condition     = contains(["OFF", "OPTIONAL", "ON"], var.cognito_mfa_configuration)
    error_message = "Must be OFF, OPTIONAL, or ON."
  }
}

variable "enable_advanced_security" {
  description = "Enable Cognito advanced security features (compromised credentials detection, adaptive auth)"
  type        = bool
  default     = true
}

variable "saml_provider_name" {
  description = "Display name for the SAML identity provider (e.g. 'AzureAD')"
  type        = string
  default     = ""
}

variable "saml_metadata_url" {
  description = "SAML federation metadata URL from your IdP"
  type        = string
  default     = ""

  validation {
    condition     = var.saml_metadata_url == "" || startswith(var.saml_metadata_url, "https://")
    error_message = "saml_metadata_url must use HTTPS."
  }
}

variable "saml_attribute_mapping" {
  description = "Attribute mapping from SAML IdP claims to Cognito attributes"
  type        = map(string)
  default = {
    email = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
  }
}

variable "oidc_provider_name" {
  description = "Display name for the OIDC identity provider (e.g. 'AzureAD')"
  type        = string
  default     = ""
}

variable "oidc_issuer" {
  description = "OIDC issuer URL (e.g. 'https://login.microsoftonline.com/{tenant-id}/v2.0')"
  type        = string
  default     = ""

  validation {
    condition     = var.oidc_issuer == "" || startswith(var.oidc_issuer, "https://")
    error_message = "oidc_issuer must use HTTPS."
  }
}

variable "oidc_client_id" {
  description = "OIDC client ID from your IdP"
  type        = string
  default     = ""
}

variable "oidc_client_secret" {
  description = "OIDC client secret from your IdP"
  type        = string
  default     = ""
  sensitive   = true
}

variable "oidc_scopes" {
  description = "OIDC scopes to request from the IdP"
  type        = string
  default     = "openid email profile"
}

variable "oidc_attribute_mapping" {
  description = "Attribute mapping from OIDC IdP claims to Cognito attributes"
  type        = map(string)
  default = {
    email    = "email"
    username = "sub"
  }
}
