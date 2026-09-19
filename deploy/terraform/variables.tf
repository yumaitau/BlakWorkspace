variable "target" {
  type        = string
  description = "Cluster target: k3s (local box), eks (paid), or external kubeconfig."
  default     = "k3s"
}

variable "profile" {
  type        = string
  description = "Blak profile: eval, staging, or prod. Prod apply is refused unless allow_prod."
  default     = "eval"
}

variable "cluster_name" {
  type    = string
  default = "blak-eval"
}

variable "namespace" {
  type    = string
  default = "blak-eval"
}

variable "domain" {
  type    = string
  default = "eval.blak.local"
}

variable "cluster_create" {
  type        = bool
  description = "Create the k3d/k3s cluster. EKS create lives in ./eks and needs allow_paid_cloud."
  default     = true
}

variable "install_addons" {
  type        = bool
  description = "Install ingress-nginx 4.11.5 and cert-manager v1.16.2 via Helm."
  default     = true
}

variable "apply_suite" {
  type        = bool
  description = "helmfile-apply pinned openDesk. Requires checkout + MASTER_PASSWORD. Default false."
  default     = false
}

variable "apply_sidecars" {
  type        = bool
  description = "Install Blak Sites chart. Refused while imageTag is TBD."
  default     = false
}

variable "allow_paid_cloud" {
  type        = bool
  description = "Required for EKS create or EKS suite apply. Default false."
  default     = false
}

variable "allow_prod" {
  type        = bool
  description = "Required to apply the prod profile. Default false. Do not set in CI."
  default     = false
}

variable "opendesk_checkout" {
  type        = string
  description = "Path to openDesk v1.18.2 checkout (helmfile.yaml.gotmpl at repo root)."
  default     = ""
}

variable "kubeconfig_path" {
  type        = string
  description = "Kubeconfig for helm/kubernetes providers. Empty uses ~/.kube/config after k3d merge."
  default     = ""
}

variable "master_password" {
  type        = string
  description = "openDesk MASTER_PASSWORD. Set via TF_VAR_master_password. Never commit."
  default     = ""
  sensitive   = true
}
