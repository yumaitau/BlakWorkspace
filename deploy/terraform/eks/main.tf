locals {
  create = var.allow_paid_cloud
}

resource "terraform_data" "paid_gate" {
  input = var.allow_paid_cloud
  lifecycle {
    precondition {
      condition     = var.allow_paid_cloud
      error_message = "EKS create requires allow_paid_cloud=true. This spends money. Do not run from CI."
    }
  }
}

module "vpc" {
  count   = local.create ? 1 : 0
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.21.0"

  name = "${var.cluster_name}-vpc"
  cidr = "10.42.0.0/16"

  azs             = ["${var.region}a", "${var.region}b"]
  private_subnets = ["10.42.1.0/24", "10.42.2.0/24"]
  public_subnets  = ["10.42.11.0/24", "10.42.12.0/24"]

  enable_nat_gateway = true
  single_nat_gateway = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
  }

  tags = {
    Project = "blak-workspace"
    Profile = "eval"
  }
}

module "eks" {
  count   = local.create ? 1 : 0
  source  = "terraform-aws-modules/eks/aws"
  version = "20.33.1"

  cluster_name    = var.cluster_name
  cluster_version = var.kubernetes_version

  vpc_id     = module.vpc[0].vpc_id
  subnet_ids = module.vpc[0].private_subnets

  cluster_endpoint_public_access = true

  eks_managed_node_groups = {
    default = {
      instance_types = ["m6i.2xlarge"]
      min_size       = 2
      max_size       = 4
      desired_size   = 2
    }
  }

  tags = {
    Project = "blak-workspace"
  }

  depends_on = [terraform_data.paid_gate]
}
