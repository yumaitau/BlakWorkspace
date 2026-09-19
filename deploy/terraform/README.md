# Terraform + Helm (eval standup)

Stand up a Kubernetes cluster and install Blak/openDesk with Helm and Helmfile.

**CI never runs `terraform apply` or `helmfile apply`.** Operators apply from a box.

## Paths

| Target | What | Command |
| --- | --- | --- |
| **k3s (local box)** | k3d (k3s-in-docker) + ingress-nginx + cert-manager | `terraform apply -var-file=examples/k3s.tfvars` |
| **existing cluster** | Helm addons onto kubeconfig | `terraform apply -var-file=examples/external.tfvars` |
| **EKS (paid)** | VPC + EKS in `ap-southeast-2`, then this stack | `cd eks && terraform apply -var-file=examples/eks.tfvars` |

Planner (no cluster): `python scripts/blak_deploy.py plan --target k3s --cluster-create`

## Local box (k3s)

Needs Docker (or OrbStack), [k3d](https://k3d.io/), Helm ≥ 3.17.3 (not 3.18.0 / 3.20.1), Terraform ≥ 1.6, Python 3.

```bash
cd deploy/terraform
terraform init
terraform plan  -var-file=examples/k3s.tfvars
terraform apply -var-file=examples/k3s.tfvars
```

That creates `blak-eval` k3d, namespace `blak-eval`, ingress-nginx **4.11.5**, cert-manager **v1.16.2**.

### Full suite (openDesk helmfile)

openDesk eval wants ~12 CPU / 32 GiB RAM, **amd64** (upstream: ARM not supported yet). Pin `v1.18.2`.

```bash
# from repo root
deploy/terraform/scripts/fetch-opendesk.sh .cache/opendesk
export TF_VAR_master_password='choose-a-long-secret'   # never commit
cd deploy/terraform
terraform apply -var-file=examples/k3s.tfvars \
  -var apply_suite=true \
  -var opendesk_checkout="$PWD/../../.cache/opendesk"
```

Helmfile keys come from `scripts/blak_deploy.py` → `deploy/helmfile/opendesk-blak.yaml` (XWiki off, OX off, Nubus/Nextcloud/Collabora/Element/Jitsi/Notes/OpenProject on).

### Sites / Hermes sidecars

Sites Helm install is refused while `deploy/sites/chart` `imageTag` is `TBD`. Do not invent a digest. Hermes has no chart in this overlay.

## EKS

```bash
cd deploy/terraform/eks
terraform init
terraform apply -var-file=examples/eks.tfvars   # requires allow_paid_cloud=true
aws eks update-kubeconfig --region ap-southeast-2 --name blak-eval
cd ..
terraform apply -var-file=examples/external.tfvars -var target=eks \
  -var allow_paid_cloud=true -var cluster_create=false
```

Prod profile apply is refused unless `allow_prod=true`. Do not do that from this seed.

## Destroy

```bash
terraform destroy -var-file=examples/k3s.tfvars
# k3d cluster delete is hooked on destroy
```
