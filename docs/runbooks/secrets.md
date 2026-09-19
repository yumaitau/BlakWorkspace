# Secrets management

CI in this repository runs `python scripts/validate-manifest.py` and unit tests only. It must not use production secrets.

## Secret classes

| Class | Examples | Eval | Staging/prod |
| --- | --- | --- | --- |
| Identity | Nubus/Keycloak admin, LDAP bind | Local/sealed, never committed | External secret store / CSI |
| App DB | Postgres, MariaDB passwords | Bundled generator, not in git | Operator-managed; injected |
| Object storage | S3 keys for Drive/Docmost | Floci local | Cloud IAM roles preferred over static keys |
| SMTP / push | Mail relay, APNs | Disabled or dummy | External secret |
| OIDC clients | Client secrets | Generated in cluster | External secret; do not rename IDs casually |
| Backup encryption | Restores keys | Documented in BW-012 | Split from cluster admin |

## Inventory notes

Upstream GitOps docs warn that pre-rendered manifests can embed secrets. Prefer live Helmfile lookups and external references. Never commit `.env`, `*.secret`, or PEM private keys. See `.gitignore`.

Homelab Micro (`deploy/k3s/micro/`): Opaque secrets are created in-cluster by
`scripts/homelab/ensure-secrets.sh`. Manifests must not contain `kind: Secret` /
`stringData` password literals. OIDC client secrets are generated in the cluster
and patched into Authentik providers; they are never committed.

Values published in git history of PR #135 (portal/Authentik/Outline/Hermes/OpenProject
OIDC and bootstrap literals) are burned. Rotate live copies; do not reuse.

## Rotation

1. Rotate in the external store first
2. Roll the workload
3. Revoke the old secret
4. Record the rotation in the customer run log (not this repo)

## Recovery

If a secret leaks via git: rotate immediately, purge from history if it reached a remote, and treat the old value as burned. If the external store is lost: restore from the backup rehearsal (BW-012), then rotate. Missing backup encryption keys fail the restore closed (do not skip detection).

## CI policy

`.github/workflows/validate.yml` must not reference production secret names or deploy steps. No `helmfile apply`, no cloud credentials.
