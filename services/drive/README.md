# Native Drive role enforcement

OpenCloud 7.5.0 remains the file server. The image rebuilds the pinned upstream
source and assets with small authorization hooks; it preserves the upstream
storage engines, image processing, UI and Collabora integration.

Drive and Docs use the same `blak-drive-reader`, `blak-drive-writer` and
`blak-drive-admin` groups because Docs edits files governed by Drive ACLs.
Reader maps to native User Light plus explicit write caps. Writer maps to User;
admin maps to Space Admin, never global Administrator. Native object ACLs still
apply: an app role does not grant access to another person's files.

The directory controller publishes a complete current snapshot keyed by frozen
OIDC subjects. Native usernames are provisioned from those subjects, not email
or mutable display names. Missing, disabled, malformed or older-than-three-minute
authority denies access. The controller endpoint uses a separate strong bearer
credential; human administrator sessions cannot reconcile roles.

Checks run inside native JWT validation, proxy requests, storage permissions,
resumable upload chunks/finalization, settings permission evaluation and WOPI
requests. Both modern and legacy decomposed storage paths receive the hooks.
Old session tokens and file ownership cannot preserve write access after the
directory snapshot records a downgrade. Running WOPI sessions recheck each
request and expose reader sessions as read-only.

Required runtime settings:

- `BLAK_DRIVE_ROLES=true`
- `BLAK_DRIVE_ROLES_FILE`: writable persistent snapshot path, shared by native services
- `BLAK_DRIVE_ROLE_TOKEN`: dedicated controller secret, at least 32 characters
- `PROXY_ROLE_ASSIGNMENT_DRIVER=oidc`

`services/app-roles/drive.py` publishes snapshots to `POST /blak/roles/reconcile`.
Publish an initial complete snapshot before enabling human traffic. Preserve
all existing app entries when adding Drive to the role controller configuration.

Build from this directory. The Dockerfile verifies source and web archive hashes,
pins base images by digest, runs native tests, and builds with VIPS enabled.
`patch.py` rejects any unexpected upstream source change before editing files.

Deployment acceptance remains pending: helper tests are not proof of live
OIDC, owned-file downgrades, resumed uploads, or active Docs session revocation.
