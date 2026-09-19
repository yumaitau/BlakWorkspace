output "cluster_name" {
  value = var.cluster_name
}

output "region" {
  value = var.region
}

output "configure_kubectl" {
  value = "aws eks update-kubeconfig --region ${var.region} --name ${var.cluster_name}"
}

output "next_step" {
  value = "cd .. && terraform apply -var-file=examples/external.tfvars -var target=eks -var allow_paid_cloud=true -var cluster_create=false"
}
