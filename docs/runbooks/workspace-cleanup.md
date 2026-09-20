# Workspace cleanup and deployment checks

The portal now shares session validation, bounded HTTP/request-body handling,
application catalogue and theme tokens. Regression checks cover invalid cookies,
expired/malformed claims, browser-bound login state, owner isolation, storage
errors, Unicode object names, atomic Flow state, keyboard navigation and responsive
dark/light pages. Search indexes must declare filterable `allowedUsers` and
`visibility` fields; only matching usernames or explicit `visibility: workspace`
documents can appear. Indexes without that ACL contract are skipped.

## Theme source

`apps/portal/theme-tokens.json` contains the existing Blak palette. Run
`node scripts/brand/generate.js` after changing it; CI runs `--check` to detect
stale Drive, ID and native-app adapters. Portal pages use the same tokens and one
persistent theme controller. Drive exposes both modes. Chat uses Custom CSS;
Hermes uses its supported custom stylesheet while retaining Open WebUI branding;
Knowledge uses its supported workspace accent preferences. Projects uses a pinned
upstream image with a small static stylesheet overlay copied by an init container.
Its startup script edits CSS, so the overlay must be copied into a writable volume.
Collabora remains the document editor launched through the branded Drive shell.
Native products retain their own navigation and per-app theme preference.

## Checks

```bash
python3 scripts/validate-manifest.py
python3 -m unittest discover -s tests
node --test apps/portal/test/*.test.js
python3 -m unittest discover -s services/hermes-sync -p 'test_*.py'
node scripts/brand/generate.js --check
# On homelab, from this checkout:
scripts/homelab/test-e2e.sh
```

Playwright uses real homelab services. Isolated portal regression accounts use
signed test sessions; separate tests exercise real Blak ID SSO. Tests cover all
portal routes in both themes, widths 390/768/1440, Flow lifecycle and permissions,
Cloud upload/filter/download/delete, native SSO/themes, and Hermes sync/retrieval.
Reports, screenshots and traces stay in ignored E2E output directories; they may
contain private test-account data and must not be published indiscriminately.

## Deploy

Use a clean main checkout on homelab, with Docker, kubectl, k3s, Node and PyYAML.
`scripts/homelab/deploy-micro.sh` builds portal/sync images tagged with the commit,
imports them into k3s, applies only the changed application resources, waits for
rollouts, and starts a sync verification job. It does not restart databases.

The first run migrates existing Flow definitions/history from `emptyDir` into
`portal-flow-data`. The migration briefly pauses portal writes while copying the
snapshot, then replaces the pod with the persistent-volume configuration. A failed
copy resumes the original process. The migration does not delete existing flows.

Before the first Hermes persistent-key rollout, the deployment script copies its
running signing key into the existing cluster Secret. Generated configuration
hashes restart apps that consume theme ConfigMaps through subPath mounts.

Knowledge's supported preferences are applied separately with
`scripts/homelab/theme-outline.js`, using the same `BLAK_E2E_USER` and
`BLAK_E2E_PASSWORD` environment as the browser suite. No credentials enter git.

After deployment, run the complete browser suite again and inspect the latest
scheduled Hermes job. A successful build or HTTP health response alone does not
prove login, document retrieval or browser chat.
