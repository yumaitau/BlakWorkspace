# Eval profile

**Do not apply production infrastructure from this profile.** Eval is a learning/dev intent that may use upstream-bundled services. No paid AU cloud is provisioned by these stubs.

## Files

- `values.yaml` — overlay flags, optional stacks off, Knowledge engines not dual-enabled

## Prerequisites

See [deploy/PREREQS.md](../../PREREQS.md). Follow https://docs.opendesk.eu/operations/ at the pinned openDesk tag.

## Smoke checklist (no cluster apply required for this seed)

1. `python scripts/validate-manifest.py`
2. Confirm `knowledge.xwiki` is false and `knowledge.docmost` is not true alongside it
3. Read `deploy/README.md` no-apply warning
4. Optional operator: `terraform apply -var-file=deploy/terraform/examples/k3s.tfvars` (not CI; not production)

## Helmfile notes

Check out upstream openDesk at the pin (`deploy/terraform/scripts/fetch-opendesk.sh`). Terraform copies Blak helmfile values into the checkout `dev` environment when `apply_suite=true`. Never helmfile apply prod values from this repository.
