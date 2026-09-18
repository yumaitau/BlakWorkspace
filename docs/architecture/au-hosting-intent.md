# Australian production hosting intent (no apply)

Spike only. **This seed does not create credentials, accounts, or production infrastructure.**

## Intent

Primary data stores for a future production Blak Workspace should reside in Australia. ADR-008 records regional data flows. No PROTECTED, IRAP, or sovereignty certification is claimed.

## Options (unevaluated)

| Option | Notes | Gaps |
| --- | --- | --- |
| Australian region of a public cloud | Matches AU residency intent if region is actually AU | Account, billing, and IRAP/PROTECTED claims are out of scope |
| Australian sovereign / government-oriented cloud | May help some customers | Product fit, licence, and network egress untested |
| Customer-owned AU datacentre Kubernetes | Strong isolation | Ops burden; not provisioned here |

No option is selected. Do not treat this table as a purchase recommendation.

## Explicit non-apply

Do not run terraform, cloud CLIs, or helmfile apply against production from this repository. Eval remains local/kind-or-lab only under later owner approval (BW-007).

## Decisions for owners

Record outcomes in [docs/governance/decision-log.md](../governance/decision-log.md):

1. Which hosting option, if any, for the first production customer
2. Whether image pull and chart registries may egress outside AU
3. Who pays for the account (this seed will not)
4. Whether any compliance regime is actually in scope (none are claimed here)

## Related

- [ADR-008](../adr/ADR-008.md)
- [docs/assumptions.md](../assumptions.md)
- [docs/architecture/profile-matrix.md](../architecture/profile-matrix.md)
