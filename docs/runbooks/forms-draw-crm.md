# Forms, Draw and CRM on homelab

The selected services are HeyForm (Blak Forms), Excalidraw (Blak Draw) and Frappe CRM (Blak CRM). They are linked from the portal catalog. This supersedes the provisional CryptPad and EspoCRM shortlist.

| Service | Address | Authentication | Persistence |
| --- | --- | --- | --- |
| Forms | https://forms.homelab.local | Native OIDC through Blak ID | Existing MongoDB, `heyform` database; `forms-data` uploads PVC |
| Draw | https://portal.homelab.local/draw | Existing portal OIDC session | Portal PVC, private owner directories under `/data/draw` |
| CRM | https://crm.homelab.local | Native Blak ID social login | MariaDB `frappe-db-data`, `frappe-sites` files/config and `frappe-cache-data` queues |

Frappe CRM replaces Twenty because native custom social login is free in Frappe Framework. The confidential `blak-crm` provider uses the strict callback `/api/method/frappe.integrations.oauth2_logins.custom/blak_id`. Python token exchange trusts the mounted homelab CA. Public signup is disabled and social signup is denied; users must be provisioned explicitly.

Draw embeds the upstream Excalidraw package with bundled local fonts. Drawings are private per portal subject; explicit Save persists across devices. Revision checks reject stale writes. JSON export/import supports sharing files. Live collaboration is not enabled. Back up the portal PVC alongside the new app volumes and MongoDB database.

## Deploy

Run `scripts/homelab/deploy-micro.sh` on homelab from a clean checkout. It provisions missing secrets, reconciles Forms and CRM OIDC providers, and applies the scoped app manifests. It retains existing secrets and data. Forms uses `client_secret_post` and the homelab CA to exchange tokens with Blak ID. Secrets never belong in git or command output.

Add `forms.homelab.local` and `crm.homelab.local` to client DNS/hosts pointing at homelab's ingress, and trust the existing homelab CA. IngressRoutes use the existing `blak-wildcard` TLS secret. Database/cache services have no external ingress.

On a fresh installation, sign into Forms with Blak ID, create `Blak Workspace`, and create its first project. CRM creates its site, installs/migrates CRM, and provisions approved users automatically. The Authentik `Blak CRM users` group controls which accounts the deploy script provisions. `akadmin` is the bootstrap Sales Manager; other approved members receive Sales User. Add users to that group and redeploy to provision them. Removing group membership alone does not revoke an existing Frappe account: disable the account in Frappe and terminate its sessions. The random local Administrator password remains in `blak-frappe/admin-password` for recovery only. Outbound email requires separate configuration.

CRM runs gunicorn, nginx, websocket, queue worker and scheduler as separate processes in one pod, with separate MariaDB and Valkey deployments. The pinned release/build recipe is in `services/frappe/versions.env`; `build-frappe.sh` builds the official production image with CRM only, then adds a small shared-theme adapter. Forms retains its digest pin and Draw its dependency lockfile. Run `node scripts/brand/generate.js` when changing workspace tokens.

## Twenty retention and rollback

Before initial cutover, `backup-twenty.sh` saves a PostgreSQL custom dump, attachments, secret and deployment definitions under `~/backups/twenty-<timestamp>` with restrictive permissions. Twenty's database and volumes are retained; server and worker are scaled to zero after Frappe becomes ready. Its active records at cutover were the upstream demo companies, people and opportunities plus empty test records. They are preserved in Twenty, not imported into the fresh Frappe site.

For rollback, apply `scripts/homelab/rollback/twenty.yaml`, wait for `crm` and `crm-worker` readiness, and restore the former portal catalog from the previous release if needed. The rollback manifest restores the public Service selector. Never apply it during normal Frappe deployment. Back up Frappe separately using `bench --site crm.homelab.local backup --with-files` in the backend and copy the backup off the sites volume. Twenty backups do not contain subsequent Frappe changes.

## Acceptance checks

Run `scripts/homelab/test-e2e.sh` on homelab. It obtains existing operator credentials from Kubernetes, installs the locked Playwright version and runs the full suite. Forms tests use the first workspace project, publish only a temporary test survey, submit a synthetic answer anonymously, verify it and delete the form. CRM tests use uniquely named synthetic records: browser creation and conversion, authenticated API updates/deletes, persisted browser views, shared portal identity, logout and anonymous denial. The setup includes a metadata override to keep Contact names visible with CRM 1.84 and Framework 15. Draw tests use isolated signed test identities and clean their own boards.

Credentials, storage state, Playwright traces and screenshots may include sensitive session data. Keep evidence private; never commit auth state or raw traces.

Hermes' five-minute workspace sync indexes the mapped account's Drive/Docs, Knowledge, Chat (including that account's direct conversations), Projects, CRM, Forms, Draw, Flow and Cloud files into private collections attached to its Blak Workspace model. CRM includes leads, deals, contacts, organisations, tasks, notes, linked comments/communications and supported attachments. Forms includes question definitions and submitted answers. Draw exports text and shape relationships; Flow exports definitions and run status. Supported office/PDF/text files are extracted; binary images/audio/video are not transcribed by this text index. Infrastructure credentials and queue messages are not indexed.

`connect-hermes-apps.js` enrols the existing `homelab-admin` mapping after verifying the Hermes, portal and Forms emails agree. CRM uses that person's API key. Forms uses a dedicated authenticated session renewed by regular reads; rerun enrolment if it is revoked or expires after a long outage. Draw/Flow use separate read-only owner-bound bearer credentials, not portal session signing keys. Secrets remain in Kubernetes; export requests cannot choose a different owner. Additional people require their own mapping and credentials (`BLAK_SYNC_ACCOUNT`, `BLAK_E2E_USER`, `BLAK_E2E_PASSWORD`). Never attach one person's private collection to another user's model.
