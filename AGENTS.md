# Agent notes

Blak Workspace is an Indigenous-branded overlay on openDesk (ZenDiS). Product names are labels. Helm chart ids and OIDC client ids stay upstream. Do not claim IRAP, PROTECTED, or sovereignty certification.

Read these before changing product scope or a deploy:

- `docs/product-contract.md`
- `docs/upstream-baseline.md`
- `docs/runbooks/dedicated-deployment.md`
- `docs/runbooks/tailnet-access.md`
- `docs/runbooks/secrets.md`

App source is this checkout (`yumaitau/BlakWorkspace`), not `~/apps`.

## Git and CI

`main` moves by squash-merge of a pull request after the `validate` workflow is green. Do not push `main` directly. CodeRabbit review is not a merge gate.

The required check is the `validate` workflow, job `manifest`. GitHub Apps can open empty check suites and leave the combined commit status pending. That is not a failed `validate` run. On the yumaitau org, leave Cloudflare Workers and Pages, Cursor, and CodeRabbit installed. Vercel, Claude, and AWS Amplify were uninstalled on purpose.

History was rewritten in 2026-09 to purge leaked homelab secrets. `CONTRIBUTING.md` records that rewrite. Fetch and reset an old clone before rebasing. Do not commit secret values, session cookies, or API keys. Tests that guard burned secrets split a token across adjacent string literals so the full value is not one git object. `scripts/deploy/ensure-secrets.sh` creates a missing secret and must not print or overwrite an existing one.

Python tests that import helpers under `tests/` need `PYTHONPATH=tests`. Laptop Python may be 3.9. CI is Python 3.12 and Node 22. CI must never run `terraform apply` or `helmfile apply`.

`scripts/generate_sbom.py` tests write a temp SBOM. They do not diff `sbom/cyclonedx.json`. Leave unrelated SBOM drift out of other commits.

## Two deploy paths

Eval, staging, and prod openDesk stand up with Terraform and Helmfile at the pin in `docs/upstream-baseline.md`. That is not the homelab suite.

The running homelab suite is single-node K3s, namespace `blak-micro`.

- SSH `justinmiddler@100.95.43.17`
- `KUBECONFIG=$HOME/.kube/blak-homelab-ts.yaml`
- The laptop default kubectl context is an AWS EKS cluster. Do not use it for this suite.
- Tailnet name `homelab.tail073805.ts.net`. Funnel is off. Tailscale Serve maps portal 443 and app ports 8444–8456 to `127.0.0.1:18480`, then workspace-shell. Port 8443 is reserved. BlakSmith is 8455 and BlakEyes is 8456.

Checked-in manifests use `workspace.example.com`. A live tailnet deploy stores real origins in env and in the workspace-shell nginx ConfigMap. Applying the whole manifest replaces that live config.

Do not apply these onto the live homelab:

- `deploy/k3s/micro/30-portal.yaml` (wipes `BLAK_APP_ORIGINS` and the Outline public URL)
- the `forms` Deployment in `deploy/k3s/micro/94-forms.yaml` (wipes `APP_HOMEPAGE_URL` and the live image)
- `deploy/k3s/micro/50-opencloud.yaml` (wipes OpenCloud public URLs)
- `deploy/k3s/micro/90-rocketchat.yaml` (wipes `ROOT_URL` and OAuth URLs)

Patch the live object, or run the script that changes one field. `scripts/deploy/prepare-release.py` is how a new environment gets a real domain. It rejects `example.com`. Tailnet publish is `scripts/deploy/prepare-tailnet.py`. It is optional and is not the product default.

`services/workspace-shell/nginx.conf` in git is the example.com host map. Live routing is ConfigMap `workspace-shell-nginx`. A subPath mount does not reload when the ConfigMap changes. Roll the workspace-shell pod after editing it.

`BLAK_APP_ORIGINS` is a JSON object keyed by catalog id. `apps/portal/public-urls.js` replaces protocol and host and keeps path and query. Empty `BLAK_APP_ORIGINS` is ignored.

Cookies are not scoped by port. A cookie set on the tailnet hostname is sent to every app port. The shell matches `location.host`. Drive is listed before Docs, so a shared Drive origin is branded Blak Drive. The shell does not inject into iframes, including Collabora WOPI. `GET` on the Collabora port alone is a plain `OK` health body.

## Builds

Build images that k3s must run on the homelab, then import them:

```sh
docker save IMAGE | sudo k3s ctr -n k8s.io images import -
```

The Docker context `m3-max` may still point at `ssh://justinmiddler@192.168.1.228`, which times out. The M3 Max is reachable over Tailscale at `100.89.92.86`. Do not rewrite the user's Docker context. Do not prune images on either engine unless the user asks, or you created them for the current task.

From the laptop, the chat build uses `BLAK_BUILD_HOST`. Do not hardcode the homelab address into the script.

```sh
BLAK_BUILD_HOST=justinmiddler@100.95.43.17 scripts/deploy/build-chat.sh --roll
```

`--roll` only runs `kubectl set image` on `deploy/chat`. It does not change the public URL.

## Product choices older docs still get wrong

Blak Knowledge is Outline (catalog id `sites`). Docmost Community cannot do OIDC or page templates. Do not deploy Docmost. Do not co-enable XWiki. Some docs and openDesk-seed tests still say Docmost, Element, or OpenProject. For the homelab, the catalog and the Outline deployment win.

Intranet sites are Outline collections created from the portal. Each site is seeded with published pages: Home, News, How we work, People, and Policies. That is not Outline's in-app template picker, and it is not a portal JSON store.

There is no Blak Files app. Blak Drive is OpenCloud. The file list inside Drive is labelled All files. Blak Docs is Collabora opened from a Drive file. The docs catalog URL is the Drive origin.

Blak Chat is Rocket.Chat. Blak Projects is Kaneo. Mattermost and OpenProject were dropped because Team and CE SSO are enterprise-gated. Blak ID is Authentik. Blak Vault is Vaultwarden. Blak Cloud is a white-label Floci console (catalog id `storage`), not AWS. Homelab Hermes is Open WebUI, not the companyos-hermes sidecar. BlakSmith (`smith`) and BlakEyes (`eyes`) stay in their own yumaitau checkouts. Their CI publishes images to GHCR (`ghcr.io/yumaitau/blaksmith*`, `ghcr.io/yumaitau/blakeyes`); the manifests pin `sha-` tags. The packages are public; no pull secret. `scripts/deploy/deploy-smith-eyes.sh` starts them. See `docs/runbooks/smith-and-eyes.md`. Smith and Eyes sign in through Blak ID. Both need a directory account before that login succeeds. `scripts/deploy/sync-directory.py` pushes Blak ID users into both. Eyes keeps a local recovery account on the appliance itself.

Git CRM is Frappe. At the last cluster check the live `crm` Deployment was still Twenty. Read the live image before deleting Twenty storage.

Every app keeps Blak branding and a way back to Home. An existing Blak ID session must not show a second login, MFA, or "Verify your identity" step. Vault's provider uses the implicit-consent authorization flow. Do not put an authenticator-enrollment stage back on that provider. The vault master password is separate from SSO. The first SSO user still sets it inside Vaultwarden. Suite logout clears the portal cookie only.

## Held files

ClamAV scans named Drive files under `/var/lib/opencloud/storage/users/users`. The loop defaults to 300000 ms, and to 15 seconds after a failed pass. Skip dot-directories, `*.held.txt`, symlinks, and files over 64MB. Do not move `.oc-nodes` blobs. Moving them breaks Drive. Do not scan Vault ciphertext. Do not send file bytes to VirusTotal. Chat and Forms uploads are out of scope.

User-facing words are: held back, looked unsafe, not deleted, Put it back, Delete it for good. Do not say quarantine, virus, malware, signature, or ClamAV in the main UI. The signature stays under Technical detail. A non-admin is told to ask a workspace admin and to give the file name.

An admin has `idp` in their apps, or drive role `admin`. `ownerId` is the first path segment, the OpenCloud user uuid. It often does not equal the Authentik subject, so a non-admin usually sees the note left in Drive and an empty Held files list. Admins see every held record.

Release copies the bytes back and deletes the note. Refuse the release when the original path already exists. Delete removes the held copy and the note.

`file-guard.js` must load without `app-roles.js`. The ConfigMap sidecar only mounts the file-guard files, and `isAdmin` is inlined for that reason.

On `main` (`fc1319a`) the sidecar is `node:22-alpine`, command `node /opt/file-guard/file-guard-run.js`, ConfigMap `blak-file-guard-code`, PVC `file-guard-data`, secret `blak-file-guard` key `token`. That is what the homelab was running on 2026-09-23. The portal calls `FILE_GUARD_URL=http://drive:8092`.

The uncommitted working tree runs the checker from the portal image (`node /app/file-guard-run.js`, image `blak-portal:micro`) via `scripts/deploy/file-guard.py`. `up` requires `PORTAL_IMAGE`, creates the secret when missing, applies `deploy/k3s/micro/98-clamav.yaml`, and patches the live opencloud Deployment, portal Deployment, and drive Service. `down` removes the sidecar, the portal `FILE_GUARD_*` env, service port 8092, and the clamav Deployment. It keeps both PVCs. It must not rewrite `OC_URL` or `BLAK_APP_ORIGINS`.

Do not point the live sidecar at `blak-portal:knowledge-sites`. That image does not contain `file-guard-run.js`. Rebuild and import the portal image before `file-guard.py up`.

`scripts/deploy/deploy-drive-roles.sh` still applies the opencloud Deployment from the yaml after it swaps image names. On a tailnet deploy that replaces public URLs. Use `file-guard.py` for the checker.

Tests:

```sh
node --test apps/portal/test/file-guard.test.js
PYTHONPATH=tests python3 -m unittest tests.test_file_guard_deploy
```

## Chat upgrades

`main` still builds Rocket.Chat from the 7.9.3 digest and tags `blak-chat:7.9.3-blak1`. The homelab `deploy/chat` was rolled with `kubectl set image` to `docker.io/library/blak-chat:8.8.1-blak1`. The version API returns the string `8.8`. That image is release 8.8.1. Do not apply `90-rocketchat.yaml` to make git match the cluster.

The uncommitted tree pins the release with `ARG ROCKET_CHAT_VERSION` in `services/chat/Dockerfile` (currently `8.8.1`). `services/chat/patch.cjs` patches `app.js` only when its unpatched SHA-256 equals `PIN` and every named anchor occurs once. Current `PIN` is `6f58bb2bcfaefff598c0e2f932e245027e5eeb2730a4e0674b93ae021f709f52`. Anchor names: accounts, routes, oauth, adminEnv, oldestAdmin, routeGuard, login, externalLogin, room, upload.

`oldestAdmin` must include the following `oldestUser` line. The shorter string matches twice. `externalLogin` is the later assignment, the one whose parameter list contains a comment. There is an earlier assignment of the same function. Patching that one does nothing, because the later assignment overwrites it.

When the anchors still match and the hash changed, the image build prints the new hash and does not write the bundle. Review the upstream release, set `PIN` to that hash, and rebuild. When an anchor moved, the error names it.

Mongo stays on `mongo:7.0`. MongoDB 8.0 exits on this host (kernel `7.0.0-31-generic`) with `SERVER-121912`. Rocket.Chat 8.8.1 starts on Mongo 7.0 and logs that 9.0 will drop MongoDB older than 8. Do not set `mongo:8.0` on this host.

A dump from before the 8.8.1 roll is `rocketchat-7.9.archive.gz`, mode 600, at `/home/justinmiddler/` on the homelab, with a copy under `/tmp/blak-backups/` on the laptop. `mongodump` progress is stderr. The archive starts with gzip magic `1f 8b`. The laptop copy is under `/tmp` and is not a durable backup.

Chat role files are also mounted from ConfigMap `blak-chat-role-policy`. Restarting chat without those mounts drops the live overlay even when the image contains `/app/bundle/blak/`.

## Versions surveyed 2026-09-23

Treated as current stable at that check: Authentik `ghcr.io/goauthentik/server:2026.8.3`, Vaultwarden 1.37.3 (`blak-vault:1.37.3`). Homelab Hermes reported Open WebUI 0.11.3. The next stable noted then was 0.11.4. Do not retag Hermes until `services/hermes/patch-*.py` is re-anchored. The image is digest-pinned in `services/hermes/Dockerfile` and `deploy/k3s/micro/92-hermes.yaml`. Drive is OpenCloud 7.5.0 (`blak-drive:7.5.0-blak1`). Outline, Collabora, Kaneo, HeyForm, Meilisearch, Frappe, Postgres, nginx, Valkey, and NATS were not bumped. Confirm upstream again before the next bump.

ClamAV in git is `clamav/clamav:1.4`. The live daemon at that check was 1.4.6.

## Browser checks

Homelab Playwright is operator-run. CI cannot reach the tailnet. Use the Chromium installed under `e2e/node_modules`. In an ESM script, import Playwright with `import pkg from '<path>/playwright/index.js'` and take `chromium` from `pkg`.

Credentials are `BLAK_E2E_USER` and `BLAK_E2E_PASSWORD`. They are not in git. The bootstrap admin username is `akadmin`. The password comes from secret `blak-idp`, keys `bootstrap-email` and `bootstrap-password`. Do not print it.

Authentik stages: textbox "email or username", button Log in, password, button Continue. If `fill` does not stick, type the username with `pressSequentially`. Kaneo may auto-redirect or show "Continue with OIDC". Wait for either.

Stay in one browser context. A new tab does not keep `blak_session` the way a same-page navigation does. The signed-out portal HTML does not list app names. Catalog hosts stay on `workspace.example.com` until `publicApps(BLAK_APP_ORIGINS)` runs.

## Working tree versus main, 2026-09-23

`main` is `fc1319a`. These edits were local and not merged. Verify the cluster before the next rollout. `kubectl` custom columns on `containers[0]` of `deploy/opencloud` show the sidecar. The OpenCloud process is the container named `opencloud`.

Uncommitted, and part of the intended workflow above:

- Chat 8.8.1 `ARG`, `services/chat/patch.cjs`, `services/chat/patch.test.cjs`, `scripts/deploy/build-chat.sh`, and the `90-rocketchat.yaml` image tag plus the Mongo 8 comment
- `scripts/deploy/file-guard.py`, the portal-image sidecar in `50-opencloud.yaml`, the `blak-file-guard` block in `ensure-secrets.sh`, the `deploy-micro.sh` and `deploy-drive-roles.sh` hooks, `tests/test_file_guard_deploy.py`, and the `98-clamav.yaml` comment

Also dirty, and not part of that work: `sbom/cyclonedx.json`.

The live checker on that date was still the `main` ConfigMap sidecar. The live chat image was already `blak-chat:8.8.1-blak1`. The live portal image seen earlier was `blak-portal:knowledge-sites`, with portal code overlaid from a ConfigMap. Git says `blak-portal:micro`.
