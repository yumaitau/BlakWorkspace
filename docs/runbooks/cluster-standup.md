# Cluster standup (K3s / EKS)

Operator-local. **Do not apply production.** CI does not run Terraform or Helmfile apply.

See [deploy/terraform/README.md](../../deploy/terraform/README.md) and [ADR-013](../adr/ADR-013.md).

## Local box (K3s)

1. Docker or OrbStack, k3d, Helm ≥ 3.17.3 (not 3.18.0 or 3.20.1), Helmfile ≥ 1.0.0, helm-diff, yq, Terraform ≥ 1.6.
2. `cd deploy/terraform && terraform init && terraform apply -var-file=examples/k3s.tfvars`
3. Optional suite: `deploy/terraform/scripts/fetch-opendesk.sh .cache/opendesk`, set `TF_VAR_master_password`, re-apply with `apply_suite=true` and `opendesk_checkout`.
4. openDesk eval size: 12 cores, 32 GiB RAM, **amd64**. ARM is not supported by upstream yet.
5. Default storage class `local-path` may fail OpenProject seeder (sticky bit). Treat that as a known eval gap.

## EKS

Paid. `allow_paid_cloud=true` in `deploy/terraform/eks`. Default region `ap-southeast-2`. Then point the stack at the kubeconfig (`target=eks`, `cluster_create=false`).

## Sidecars

Sites and Hermes stay off until real image tags replace `TBD`. Do not invent digests.

## Destroy

`terraform destroy -var-file=examples/k3s.tfvars` deletes the k3d cluster.
