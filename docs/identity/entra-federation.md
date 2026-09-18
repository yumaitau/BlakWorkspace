# Optional Microsoft Entra federation (BW-021)

Spike only. Entra is **off** in the seed. `identity.entraFederation` in `deploy/overlays/blak/identity.yaml` must be false. Do not create Entra tenants or credentials from this repository.

`scripts/blak_identity.entra_federation_enabled` reads that flag.
