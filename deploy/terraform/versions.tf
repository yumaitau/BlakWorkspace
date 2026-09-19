terraform {
  required_version = ">= 1.6.0"
  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.35"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
    external = {
      source  = "hashicorp/external"
      version = "~> 2.3"
    }
  }
}

provider "kubernetes" {
  config_path = local.kubeconfig_path
}

provider "helm" {
  kubernetes {
    config_path = local.kubeconfig_path
  }
}
