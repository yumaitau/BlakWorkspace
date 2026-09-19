output "plan_ok" {
  value = data.external.plan.result.ok
}

output "plan_steps" {
  value = data.external.plan.result.steps
}

output "kubeconfig_path" {
  value = local.kubeconfig_path
}

output "namespace" {
  value = var.namespace
}

output "domain" {
  value = var.domain
}

output "opendesk_pin" {
  value = data.external.plan.result.pin_tag
}

output "sites_install" {
  value = data.external.plan.result.sites_install
}
