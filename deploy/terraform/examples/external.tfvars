# Existing cluster (kind, k3s, EKS kubeconfig already merged).
target           = "external"
profile          = "eval"
cluster_create   = false
install_addons   = true
apply_suite      = false
apply_sidecars   = false
allow_paid_cloud = false
kubeconfig_path  = ""
namespace        = "blak-eval"
domain           = "eval.blak.local"
