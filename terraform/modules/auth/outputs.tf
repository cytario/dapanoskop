output "client_id" {
  description = "ID of the Cognito app client"
  value       = aws_cognito_user_pool_client.app.id
}

output "user_pool_id" {
  description = "ID of the Cognito User Pool (managed or existing)"
  value       = local.user_pool_id
}

output "cognito_domain" {
  description = "Cognito hosted UI domain URL (empty if using an existing pool)"
  value       = local.cognito_domain
}

output "saml_entity_id" {
  description = "SAML Entity ID for IdP configuration"
  value       = local.create_user_pool ? "urn:amazon:cognito:sp:${aws_cognito_user_pool.managed[0].id}" : ""
}

output "saml_acs_url" {
  description = "SAML ACS URL for IdP configuration"
  value       = local.create_user_pool && var.cognito_domain_prefix != "" ? "https://${var.cognito_domain_prefix}.auth.${data.aws_region.current.id}.amazoncognito.com/saml2/idpresponse" : ""
}

output "identity_pool_id" {
  description = "Cognito Identity Pool ID for frontend AWS SDK"
  value       = aws_cognito_identity_pool.main.id
}
