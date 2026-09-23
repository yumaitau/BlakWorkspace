# Blak Workspace integration contract

The portal catalog owns application names and URLs. `apps/portal/integration.js`
owns native entry points and access groups. When a live portal mounts a newer
`catalog.js` from a ConfigMap, mount `integration.js` beside it. Without an entry,
`/launch/<id>` falls back to the catalog URL and skips the native login path.
Blak ID remains the identity provider;
each application establishes its own native OIDC session.
Forms initializes HeyForm's native browser device binding before starting its
server-generated OAuth state/PKCE transaction. CRM uses Frappe's generated login
URL; Chat invokes its registered Meteor OAuth service.

## Access and account identity

Run `python3 scripts/deploy/provision-id.py` from a prepared release. This reconciles
group policies and claims and asserts that existing client IDs, secrets and
subject modes did not change. It is safe to repeat.

Assign users to the `Blak … users` groups listed in the integration contract.
Workspace administrators retain all apps. Drive and Docs share one grant.
The portal checks claims again at most 30 seconds after the last check. Protected
portal routes enforce the same grants as navigation. Native app OIDC authorization
also requires the corresponding group. Removing a grant prevents new native logins;
use native session revocation when an already signed-in app must be disconnected.

`blak_id` is the immutable Authentik user UUID. Existing username-based subjects are
frozen in the managed **Blak Workspace stable subject** mapping, keyed by UUID.
New accounts receive UUID subjects. Never regenerate that mapping from current
usernames: doing so would disconnect existing files and native account links.
OpenCloud looks up and provisions by `sub`; names and email remain display fields.
The portal uses `sub` for existing private ownership and exposes `blak_id` separately.

## Sessions and logout

Portal sessions are encrypted on the persistent volume. Cookies contain a random
session identifier and signature. A cookie without a server record cannot sign in.
OIDC uses PKCE, nonce and signature/issuer/audience validation. Refresh credentials
remain server-side. The deployment has one replica and uses `Recreate` for its
single-writer journal.

**Sign out of workspace** calls native logout on each app's origin, waits for
origin/source/state-checked acknowledgements, then ends Blak ID. It reports apps
that fail to confirm instead of claiming they signed out. Authentik also sends
signed back-channel logout to the portal, invalidating its server session.
The portal provider uses the managed `blak-workspace-invalidation` flow with a
User Logout stage. Authentik's default provider invalidation flow alone leaves
the central identity session active.

Native adapters: HeyForm `/logout`; Frappe `/api/method/logout`; Kaneo's Better Auth
`sign-out`; Outline `auth.delete`; Rocket.Chat `/api/v1/logout`; Open WebUI
`/api/v1/auths/signout`. Outline's native action invalidates that user's other
browser sessions too. OpenCloud's browser OIDC records are removed before ending
the provider session. Self-contained OpenCloud access JWTs retain their normal
expiry; this does not claim instantaneous revocation of copied bearer tokens.
Hermes uses a dedicated persistent Valkey journal with `noeviction` and synchronous
append-only writes. Open WebUI requires this store to revoke signed-out JWTs;
without `REDIS_URL`, its logout only clears browser credentials.

## Controlled client-secret rotation

Routine provisioning never rotates a secret. The old standalone `ak-*.py` modules
require `ak-provider-common.py` to be prepended; application bindings are resolved
before provider names, so a renamed provider is not duplicated.

Rotate one confidential client during a planned maintenance window:

1. Back up that provider and its Kubernetes Secret privately. Record the existing
   client ID, issuer, subject mode, callbacks and consumer configuration.
2. Generate a new random secret. Update the existing provider's secret only; keep
   its client ID and identity configuration. Apply the same value to the consumer.
3. Reconcile persisted native settings where applicable, then restart the consumer.
   CRM stores its Social Login Key in Frappe; Chat persists Custom OAuth settings;
   Hermes may persist its OAuth configuration. An environment change alone is not
   proof that those applications adopted a rotation.
4. Complete a fresh native login and token refresh, then verify the old secret
   fails at the token endpoint. On failure, restore both sides from the backup.

| Application | Kubernetes Secret | Consumer |
| --- | --- | --- |
| Portal | `blak-portal/oidc-secret` | `portal` |
| Forms | `blak-forms/oidc-secret` | `forms` |
| CRM | `blak-frappe/oidc-secret` | Frappe setup and `frappe-crm` |
| Knowledge | `blak-sites/oidc-secret` | `outline` |
| Projects | `blak-kaneo/oidc-secret` | `projects` |
| Chat | `blak-chat/oidc-secret` | Custom OAuth settings and `chat` |
| Hermes | `blak-hermes/oidc-secret` | OAuth configuration and `hermes` |

OpenCloud's browser client is public and has no confidential client secret to rotate.

## Maintained theming

`theme-tokens.json` generates shared assets. Keep native adapters tied to the
deployed upstream version and test light/dark themes, mobile menus, dialogs and
document canvases before changing an image. Outline is pinned to the tested image
digest; generated styled-component class names are not a theme contract.
Use native settings where exposed (OpenCloud themes, Frappe brand settings,
Rocket.Chat color roles, Open WebUI custom CSS, Outline's theme override). The
shared switcher supplies navigation and theme selection without accessing app
credentials. Only the separate same-origin logout adapter uses native logout
credentials; it never sends them to another application.

Run `polish.spec.js` and `logout.spec.js` against a prepared release using real
Blak ID credentials. When a remote browser cannot reach its own tailnet Serve
origin, forward its Playwright WebSocket to the operator machine and set
`PLAYWRIGHT_EXPOSE_NETWORK` to the exact tailnet hostname. For a Linux browser
controlled from macOS, set `BLAK_E2E_SNAPSHOT_PLATFORM=linux` to compare the existing
Linux baselines. This forwards browser network traffic; credentials remain in
the operator test process and native application requests.

## Authentik upgrade

Do not skip release families. `rehearse-id-upgrade.py` clones the database, runs
each release's **lifecycle** migrations and proves real server HTTP readiness.
`upgrade-id.py --rehearsal PATH --id-origin URL` then stops sign-ins, takes an
offline backup and applies that exact sequence. On failure, restore the database
before restoring old deployments; changing an image alone is not a rollback.

References: [Authentik upgrades](https://docs.goauthentik.io/install-config/upgrade/),
[OIDC logout](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/frontchannel_and_backchannel_logout/),
[OpenCloud external OIDC](https://docs.opencloud.eu/docs/admin/configuration/authentication-and-user-management/external-idp/).
