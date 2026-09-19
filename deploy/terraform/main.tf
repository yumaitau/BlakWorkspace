locals {
  kubeconfig_path = var.kubeconfig_path != "" ? var.kubeconfig_path : pathexpand("~/.kube/config")
  create_k3s      = var.target == "k3s" && var.cluster_create
}

data "external" "plan" {
  program = ["python3", "${path.module}/../../scripts/blak_deploy.py", "json"]
  query = {
    target            = var.target
    profile           = var.profile
    apply_suite       = var.apply_suite ? "true" : "false"
    apply_sidecars    = var.apply_sidecars ? "true" : "false"
    allow_paid_cloud  = var.allow_paid_cloud ? "true" : "false"
    allow_prod        = var.allow_prod ? "true" : "false"
    cluster_create    = var.cluster_create ? "true" : "false"
    install_addons    = var.install_addons ? "true" : "false"
    opendesk_checkout = var.opendesk_checkout
    domain            = var.domain
    namespace         = var.namespace
    master_password   = var.master_password
  }
}

resource "terraform_data" "plan_gate" {
  input = data.external.plan.result.ok
  lifecycle {
    precondition {
      condition     = data.external.plan.result.ok == "true"
      error_message = data.external.plan.result.errors
    }
  }
}

resource "local_file" "helmfile_values" {
  filename        = "${path.module}/generated/opendesk-blak.yaml"
  content         = "${data.external.plan.result.helmfile_values}\n"
  file_permission = "0644"
}
