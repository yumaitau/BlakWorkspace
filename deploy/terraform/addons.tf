# Chart versions from openDesk requirements (ingress-nginx 4.11.5) and a public
# cert-manager chart tag. Do not invent image digests.

resource "helm_release" "ingress_nginx" {
  count            = var.install_addons ? 1 : 0
  name             = "ingress-nginx"
  repository       = "https://kubernetes.github.io/ingress-nginx"
  chart            = "ingress-nginx"
  version          = "4.11.5"
  namespace        = "ingress-nginx"
  create_namespace = true
  wait             = true
  timeout          = 600

  values = [<<-YAML
    controller:
      allowSnippetAnnotations: true
      ingressClassResource:
        name: nginx
        default: true
      config:
        allow-snippet-annotations: "true"
        annotations-risk-level: Critical
        strict-validate-path-type: "false"
    YAML
  ]

  depends_on = [null_resource.k3d, terraform_data.plan_gate]
}

resource "helm_release" "cert_manager" {
  count            = var.install_addons ? 1 : 0
  name             = "cert-manager"
  repository       = "https://charts.jetstack.io"
  chart            = "cert-manager"
  version          = "v1.16.2"
  namespace        = "cert-manager"
  create_namespace = true
  wait             = true
  timeout          = 600

  set {
    name  = "crds.enabled"
    value = "true"
  }

  depends_on = [null_resource.k3d, terraform_data.plan_gate]
}

resource "kubernetes_namespace_v1" "blak" {
  count = (var.install_addons || var.apply_suite || var.apply_sidecars) ? 1 : 0
  metadata {
    name = var.namespace
  }
  depends_on = [null_resource.k3d, terraform_data.plan_gate]
}
