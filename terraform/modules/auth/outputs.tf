output "client_id" {
  description = "ID of the Cognito app client"
  value       = aws_cognito_user_pool_client.app.id
}
