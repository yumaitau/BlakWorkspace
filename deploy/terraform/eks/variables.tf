variable "allow_paid_cloud" {
  type        = bool
  description = "Must be true. This root creates paid AWS resources."
  default     = false
}

variable "region" {
  type        = string
  description = "AU hosting intent default. Change only with an owner decision."
  default     = "ap-southeast-2"
}

variable "cluster_name" {
  type    = string
  default = "blak-eval"
}

variable "kubernetes_version" {
  type    = string
  default = "1.31"
}
