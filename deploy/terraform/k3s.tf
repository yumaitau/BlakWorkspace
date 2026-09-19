resource "null_resource" "k3d" {
  count = local.create_k3s ? 1 : 0

  triggers = {
    cluster_name = var.cluster_name
  }

  provisioner "local-exec" {
    command     = "${path.module}/scripts/k3d-up.sh"
    interpreter = ["/bin/bash", "-c"]
    environment = {
      CLUSTER_NAME = var.cluster_name
    }
  }

  provisioner "local-exec" {
    when        = destroy
    command     = "${path.module}/scripts/k3d-down.sh"
    interpreter = ["/bin/bash", "-c"]
    environment = {
      CLUSTER_NAME = self.triggers.cluster_name
    }
  }

  depends_on = [terraform_data.plan_gate]
}
