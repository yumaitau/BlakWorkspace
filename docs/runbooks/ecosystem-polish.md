# Ecosystem presentation and recovery

The workspace-shell proxy adds same-origin presentation assets to HTML responses.
JSON APIs, file transfers, websocket upgrades and streaming responses retain their
upstream behaviour. Authentik routes and the Docs-to-Drive redirect are unchanged.
The shared switcher offers app navigation, workspace home, getting started, sync
status and a light/dark switch. Its `blak-theme` cookie contains only `light` or
`dark`, scoped to homelab.local with Secure and SameSite=Lax. No identity or session
credential is shared through the theme adapter. Document canvases keep their own
formatting; app chrome receives the palette.

All public assets derive from portal catalog/tokens. Run
`node scripts/brand/generate.js --check` before release. The adapter is deliberately
separate from upstream apps; upstream attribution remains in the switcher.

## Private Hermes health and enrolment

`/sync` and `/api/sync-health` require a portal session and filter the generated
report by its verified OIDC subject. The worker publishes counts, last success,
error state and optional credential expiry only. Credentials, filenames, source
record IDs and document text are never included. A last success older than 15
minutes is stale. Known expiries warn 14 days ahead; unknown expiries are displayed
as not reported, never guessed. Failed source credentials detach that collection
from the private workspace model until repaired.

To add another person, prepare a mode-600 JSON mapping using the schema in
[hermes-sync.md](hermes-sync.md), then run:

```sh
python3 scripts/homelab/enrol-hermes-account.py /private/account.json
BLAK_SYNC_ACCOUNT=account-name BLAK_E2E_USER=account-user node scripts/homelab/connect-hermes-apps.js
```

Provide the owner's SSO password through the process environment or a private
operator session; never put it in shell history. Do not use the admin fallback
for another person's mapping. Enrolment verifies Hermes, portal, Forms and CRM
identity. Optional `credential_metadata.SOURCE.expires_at` is a Unix timestamp
obtained from that provider, not an inferred lifetime. Refresh the mapping with
`--replace` to rotate credentials without changing ownership. Verify `/sync` and
successful private retrieval after enrolment. Warnings appear in the portal;
external notifications require a separately configured destination.

## Consistent encrypted backups

On the single-node homelab, `scripts/homelab/backup/install.sh` installs two systemd
timers. Daily at 03:30 Australia/Sydney, the backup suspends CronJobs, waits for
active jobs, records replica counts, stops workspace writers/databases, copies
all data PVCs and resource/Secret definitions, and restores original replicas.
Ollama weights are excluded because they are downloadable. A private recovery
journal and ExecStopPost resume workloads even after a failed backup. Expect a
brief maintenance window plus app startup time; unrelated host containers are
never stopped.

Snapshots are AES256-encrypted GPG archives under `/var/backups/blak-workspace`.
The mode-600 key is provisioned separately at `/etc/blak-backup/key`. Seven complete
archives are retained. Do not store the only key with the archive. This is local
recovery protection: copy encrypted archives and escrow the key on a separate
machine for protection against complete homelab disk loss.

Every Sunday at 04:30 an isolated restore drill decrypts the latest archive,
verifies every file checksum, boots copied PostgreSQL/MariaDB/Mongo data in
Docker containers with `--network none` and no published ports, checks database
contents, verifies Hermes SQLite integrity and parses portal JSON state. No app
workers run and no restored process can contact production. Temporary containers
and restored plaintext files are removed afterwards. `last-backup.json` and
`last-restore-drill.json` are private machine-readable evidence.

```sh
sudo systemctl status blak-workspace-backup.timer blak-workspace-restore.timer
sudo systemctl start blak-workspace-backup.service
sudo systemctl start blak-workspace-restore.service
sudo cat /var/backups/blak-workspace/last-backup.json
sudo cat /var/backups/blak-workspace/last-restore-drill.json
```

A full disaster recovery uses matching recorded images, restores Secrets and PVC
contents before starting databases, then starts apps and runs the complete E2E
suite. Keep restored workers isolated until the intended production cutover.

## Visual and accessibility acceptance

`polish.spec.js` checks shared navigation, keyboard focus/Escape, cross-domain
preferences, mobile switcher bounds, reviewed screenshot baselines and axe checks
on new chrome. Native app screenshots are retained privately for manual review;
third-party accessibility is not represented as universally compliant. Existing
functional tests continue to cover actual create/update/delete and SSO behaviour.
Generate baselines on homelab Linux using `--update-snapshots`, review them, commit
them, then run again without update mode. Never blindly regenerate to hide a diff.

## Verified integration boundaries

Drive starts OpenCloud's `collaboration` service explicitly and exposes its WOPI
endpoint through the workspace gateway. Collabora uses a persistent RSA proof key
from `blak-docs-proof-key`; proof verification remains enabled. The image is pinned
by digest. `docs.spec.js` uploads a fixture, opens the actual editor, edits it,
saves it back to Drive, verifies the stored document content and removes it.

Hermes discovery uses HTTPS and a CA bundle that includes both public roots and
the homelab CA. Using the HTTP discovery URL loses the browser's existing secure
Blak ID session and can loop at identification; the cross-app acceptance test
covers the HTTPS path. Shared navigation isolates its keyboard/click handling
from upstream app shortcuts, including Escape after mobile focus changes.

On the CPU-only homelab, the deploy configures Hermes to use the original question
for retrieval and disables automatic titles, tags and follow-up suggestions.
These [optional model tasks](https://docs.openwebui.com/features/administration/task-models/)
otherwise compete with the answer for local inference. Users can name chats
manually. Other administrator settings are preserved through the supported task
configuration API; changing environment defaults alone does not update saved settings.

Cold recovery starts and waits for databases before restoring application
replicas, then resumes the original CronJob schedules. Mongo has a stable local
replica identity and a primary-aware readiness probe; it uses Recreate to avoid
two writers opening its persistent volume during a rollout.

The homelab runner uses the matching official Playwright Docker image and its own
network namespace, preventing host CNI interface changes from aborting browser
navigation. Only the browser runs in the container; Kubernetes fixtures and credentials
stay on the host. Its temporary Playwright endpoint binds to loopback only and
the runner stops its own container on exit. Baselines are
reviewed in that pinned browser/OS environment. `BLAK_E2E_NATIVE=1` is an explicit
local debugging fallback; it may render fonts differently and is not the baseline
acceptance environment.
