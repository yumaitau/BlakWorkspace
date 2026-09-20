# Forms, Draw and CRM on homelab

The selected services are HeyForm (Blak Forms), Excalidraw (Blak Draw) and Twenty (Blak CRM). They are linked from the portal catalog. This supersedes the provisional CryptPad and EspoCRM shortlist.

| Service | Address | Authentication | Persistence |
| --- | --- | --- | --- |
| Forms | https://forms.homelab.local | Native OIDC through Blak ID | Existing MongoDB, `heyform` database; `forms-data` uploads PVC |
| Draw | https://portal.homelab.local/draw | Existing portal OIDC session | Portal PVC, private owner directories under `/data/draw` |
| CRM | https://crm.homelab.local | Separate email/password login | Dedicated PostgreSQL `crm-db-data` and `crm-data` attachment PVCs |

Twenty's native SSO is Enterprise licensed. No licence is configured. The catalog explicitly discloses the separate login; selecting Twenty does not satisfy the original free native OIDC preference. Do not bypass licence checks or claim CRM SSO has passed. `IS_MULTIWORKSPACE_ENABLED=false` prevents uninvited creation of additional workspaces after initial setup.

Draw embeds the upstream Excalidraw package with bundled local fonts. Drawings are private per portal subject; explicit Save persists across devices. Revision checks reject stale writes. JSON export/import supports sharing files. Live collaboration is not enabled. Back up the portal PVC alongside the new app volumes and MongoDB database.

## Deploy

Run `scripts/homelab/deploy-micro.sh` on homelab from a clean checkout. It provisions missing secrets, reconciles the Forms OIDC provider, and applies the scoped app manifests. It retains existing secrets and data. Forms uses `client_secret_post` and the homelab CA to exchange tokens with Blak ID. Secrets never belong in git or command output.

Add `forms.homelab.local` and `crm.homelab.local` to client DNS/hosts pointing at homelab's ingress, and trust the existing homelab CA. IngressRoutes use the existing `blak-wildcard` TLS secret. Database/cache services have no external ingress.

On a fresh installation, sign into Forms with Blak ID, create `Blak Workspace`, and create its first project. CRM requires one-time browser onboarding: use the operator email, retrieve `blak-crm/admin-password` privately from Kubernetes, create `Blak Workspace`, and skip app installs and invitations unless needed. The current homelab operator email is `admin@blak.local`. Secret creation does not itself create a CRM user; subsequent runs preserve the existing account. Invitations and outbound email were not exercised by acceptance tests.

Images are pinned by digest in `94-forms.yaml` and `95-crm.yaml`; Draw dependencies are pinned in its lockfile. Generated palette adapters preserve upstream names and UI. Forms uses shared light/dark palette variables; CRM uses shared accent/focus colours and retains native surfaces. Re-run `node scripts/brand/generate.js` when changing workspace tokens.

## Acceptance checks

Run `scripts/homelab/test-e2e.sh` on homelab. It obtains existing operator credentials from Kubernetes, installs the locked Playwright version and runs the full suite. Override `BLAK_CRM_EMAIL` if the CRM operator email differs. Forms tests use the first workspace project, publish only a temporary test survey, submit a synthetic answer anonymously, verify it and delete the form. CRM tests use uniquely named synthetic records. Draw tests use isolated signed test identities and clean their own boards.

Credentials, storage state, Playwright traces and screenshots may include sensitive session data. Keep evidence private; never commit auth state or raw traces.

Hermes' existing five-minute workspace sync remains enabled and separately tested. This release does not ingest Forms responses, private drawings or CRM records into Hermes. Adding these sources requires source-specific permission handling; the current source connector scope is unchanged.
