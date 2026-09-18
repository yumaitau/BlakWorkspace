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
4. Optional later: helmfile diff against a kind cluster under explicit owner approval (not this seed)

## Helmfile notes

Check out upstream openDesk at the pin, place this overlay beside it, and run helmfile **diff** only until owners approve an eval apply. Never helmfile apply prod values from this repository.
