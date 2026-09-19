resource "helm_release" "blak_sites" {
  count     = data.external.plan.result.sites_install == "true" ? 1 : 0
  name      = "blak-sites"
  chart     = "${path.module}/../sites/chart"
  namespace = var.namespace
  wait      = false
  timeout   = 300

  values = [
    file("${path.module}/../sites/chart/values.yaml"),
  ]

  depends_on = [
    terraform_data.plan_gate,
    kubernetes_namespace_v1.blak,
    helm_release.ingress_nginx,
  ]
}
