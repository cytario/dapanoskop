config {
  call_module_type = "local"
}

plugin "aws" {
  enabled = true
  version = "0.38.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"

  deep_check = false
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}
