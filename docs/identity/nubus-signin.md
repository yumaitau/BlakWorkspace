# Nubus sign-in as baseline IdP (BW-019)

Blak Workspace uses **Nubus** (Keycloak / OpenLDAP / portal) as the only baseline identity provider. Sign-in is OIDC. Do not stand up a second IdP for the first release. Microsoft Entra stays optional investigation (BW-021).

Machine-readable: `deploy/overlays/blak/identity.yaml`. `scripts/blak_identity.idp_failures` must be empty.
