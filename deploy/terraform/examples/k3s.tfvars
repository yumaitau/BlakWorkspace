# Local box: k3s-in-docker via k3d, then Helm addons.
# Full openDesk suite is a second step (32 GiB RAM, amd64; ARM images unsupported upstream).
target           = "k3s"
profile          = "eval"
cluster_name     = "blak-eval"
namespace        = "blak-eval"
domain           = "eval.blak.local"
cluster_create   = true
install_addons   = true
apply_suite      = false
apply_sidecars   = false
allow_paid_cloud = false
allow_prod       = false
# opendesk_checkout = "/absolute/path/to/opendesk"
# Then: export TF_VAR_master_password=... and apply_suite = true
