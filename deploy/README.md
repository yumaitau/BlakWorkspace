# Deploy adapters

Stubs for adapting upstream openDesk Helmfile deployments with a Blak overlay.

## Layout

- `upstream/` notes on how to fetch and pin openDesk
- `overlays/blak/` theme and functional label overlays
- `profiles/` eval, staging, and prod intent values

## Warning

Do not apply production infrastructure from this seed. Eval K3s may be applied by an operator via [terraform](terraform/README.md) (ADR-013). GitHub Actions never runs terraform apply. No paid AU cloud resources are provisioned unless `allow_paid_cloud` is set on the EKS root.
