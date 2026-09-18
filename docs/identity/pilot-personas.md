# Pilot personas and groups (BW-020)

Pilot groups map to Nubus groups. Overlay list in `deploy/overlays/blak/identity.yaml` `personas`:

- site-owner
- site-admin
- member
- contributor
- reader

`scripts/blak_identity.persona_failures` is empty only when all five are present. Do not invent extra privileged personas in the seed.
