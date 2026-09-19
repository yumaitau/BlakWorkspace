resource "null_resource" "opendesk_helmfile" {
  count = var.apply_suite ? 1 : 0

  triggers = {
    pin       = data.external.plan.result.pin_tag
    namespace = var.namespace
    values    = local_file.helmfile_values.content
  }

  provisioner "local-exec" {
    command     = "${path.module}/scripts/helmfile-apply.sh"
    interpreter = ["/bin/bash", "-c"]
    environment = {
      OPENDESK_ROOT    = var.opendesk_checkout
      KUBECONFIG       = local.kubeconfig_path
      NAMESPACE        = var.namespace
      DOMAIN           = var.domain
      MASTER_PASSWORD  = var.master_password
      BLAK_VALUES_FILE = local_file.helmfile_values.filename
    }
  }

  depends_on = [
    terraform_data.plan_gate,
    helm_release.ingress_nginx,
    helm_release.cert_manager,
    kubernetes_namespace_v1.blak,
    local_file.helmfile_values,
  ]
}
