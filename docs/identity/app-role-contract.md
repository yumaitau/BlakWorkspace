# App-specific Blak ID roles

Status: Vault native enforcement is implemented and tested separately. Draw, Flow,
Cloud and Search enforcement is implemented. The 14-test live portal suite
passed, including existing-session role changes and private-owner boundaries.
Hermes, Projects and Knowledge native acceptance is recorded below. The other native app
mappings remain implementation design; this document does not certify them.

Blak ID is the authority for membership. Every app must enforce its native data
permissions as well as the login grant. A hidden launcher, proxy login gate, or
unsigned browser value is not authorization.

## Group contract

Use `blak-<app>-reader`, `blak-<app>-writer`, and `blak-<app>-admin`. Resolve multiple
memberships to the highest role for that app only: admin, writer, reader. No role
means no access. App administration does not confer Blak ID administration or
administration of another app. Preserve the existing operator's access during
migration; never silently turn ordinary existing users into administrators.

Roles apply to the managed group workspace or collections and the app's relevant
administrative controls. Existing personal ownership and source ACLs remain
separate; group membership must not expose another person's private data.

- Reader: view permitted content; no content edits or member management.
- Writer: create and edit permitted content; no member or role management.
- Admin: manage the app's managed workspace, membership and settings.

Each adapter must document native differences, such as whether a viewer can
comment, export, or create a private personal item. Never label an editor as a
reader because the app lacks a suitable native role.

## Enforcement and lifecycle

Prefer signed OIDC claims interpreted natively. Otherwise use a dedicated
controller and supported native membership/permission APIs. Bind users by the
immutable Blak ID subject and an explicit native account link. Do not relink an
existing account from an unverified or changed email address.

Reconcile additions, role downgrades, removals and disabled users. Report the
measured convergence interval and native token lifetime. Removing login access
alone does not prove existing sessions lost data access. A failed reconciliation
must be visible and must not be reported as applied. Do not log credentials,
private item bodies, or vault contents.

Custom portal modules enforce roles on the server for every data operation and
retain existing owner checks. Docs permissions follow the Drive file/Space. Search
and Hermes must respect source ownership and permissions; neither indexes Vault.

## Native mapping to validate

| App | Reader | Writer | Admin | Required proof |
| --- | --- | --- | --- | --- |
| Vault | Group collection read-only | Group collection edit | Organization admin, not server operator | Cipher and attachment ACLs, membership removal, encrypted key handoff |
| Drive / Docs | Space can-view | Space can-edit | Space management plus deliberately scoped app administration | DAV upload/delete denied to reader; Docs cannot save read-only file |
| Projects | Managed viewer | Managed content writer | Managed workspace admin | Native API project/task writes, immutable membership authority, existing key/session downgrade |
| Knowledge | Viewer | Editor | Admin | Document writes denied; document/comment distinctions documented |
| CRM | Read-only CRM permission set | Sales User | Sales Manager with scoped administration | Native Frappe permission checks on lists, documents and mutations |
| Forms | Must verify native support | Collaborator/member as supported | Workspace admin | GraphQL mutations denied to reader, including aliases and batches |
| Chat | Read-only custom native role | Normal member | Scoped app admin | Message writes, channel/member management and existing-token downgrade |
| Hermes | Use permitted sources/models | Manage permitted knowledge | App admin | Native permission checks and continued private owner boundaries |
| Draw / Flow / Cloud | Server-side read capability | Server-side write capability | Scoped management capability | Direct API denial; no owner bypass |
| Search | Search permitted sources | No extra source rights | Manage app settings only | Search cannot widen source ACLs |

## Knowledge native enforcement

Knowledge uses Outline's native viewer, member and admin roles, mapped from
`blak-knowledge-reader`, `blak-knowledge-writer` and `blak-knowledge-admin`.
The controller matches the native OIDC provider and immutable subject only.
Email cannot link an existing account to another identity. New OIDC users start
as viewers until directory reconciliation applies their current role.

The pinned native CanCan policy engine caps viewer permissions, including private
documents and collection ownership. Readers can read permitted content, export,
bookmark and subscribe; they cannot edit, delete, share or comment on documents.
Personal profile and API-key controls retain their native policies. Writers use
native member permissions. Admins manage application content and settings, but
membership, identity providers and role authority stay in Blak ID. Humans cannot
alter the dedicated controller or remove the team. Native object ACLs remain
required at every role: an app grant never grants access to another user's private
collection.

Directory reconciliation runs every 60 seconds. Disabled or removed identities
become viewers and are suspended through native APIs. The native collaboration
processor invalidates open editors. Outline also permanently deletes API keys
during suspension cleanup; restored users must sign in and issue new keys.
The managed viewer cap preserves existing collection ACLs instead of permanently
rewriting them during a temporary downgrade. Restoring writer access therefore
restores only permissions the existing object ACL already granted.

Run `scripts/deploy/deploy-knowledge-roles.sh` from a committed prepared release.
It backs up the native database, enrolls a dedicated controller through native
models, stores its scoped API key in a Kubernetes Secret, and upgrades the
reconciler before activating the new configuration. The controller exposes only
identity/role metadata and native role operations; it does not read documents.

Acceptance tests are `e2e/tests/knowledge-roles.spec.js` (real OIDC, private
ownership, existing sessions/keys, open editor, disable/remove/restore) and
`e2e/tests/knowledge-sync.spec.js` (owner-bound private create/update/retrieve/delete
through Hermes). Native role acceptance passed in 10.1 minutes against Knowledge
image `blak-knowledge:dd4ee23a75f6`; private source indexing, update, retrieval and
deletion passed in 41.4 seconds. Configuration/role tests (295), portal tests (35),
sync tests (34), and actual patched native/helper JavaScript tests (12) passed.
The portal runs `blak-portal:5b5ab93a4e30`; the reconciler runs
`blak-app-roles:7a2a44bc9c7f`; source sync runs `blak-hermes-sync:f78f62132d42`.

## Projects native enforcement

Projects uses Kaneo's Better Auth workspace permission engine. The controller
owns `Blak Group Projects`; Blak ID grants map to `blak-reader`, `blak-writer`,
and `blak-admin` native roles. Writer adds project editing/deletion and task
assignment/deletion to the upstream member role. Reader retains the upstream
viewer permissions. Admin manages workspace content and settings, while group
membership and role authority remain managed in Blak ID. Native app admins
cannot promote a reader, alter managed role definitions, remove the controller,
or delete the managed workspace.

The controller binds accounts only through the native `custom` OIDC account's
immutable subject. Human global instance-admin roles are removed before applying
workspace roles. Disabled identities, removed app grants, and unbound local
accounts are banned through Better Auth. An explicit controller account is the
only exception. Existing independently owned workspaces are preserved. The
current app role caps their native object permissions too: ownership or a local
custom role cannot let a reader edit content or manage members. App-wide removal
bans access to all workspaces.

The pinned native patch disables the five-minute cookie permission cache,
checks account bans on existing API keys, and closes existing user/project
WebSockets on role changes. Reconciliation runs every 60 seconds. Administrator
operations use short-lived persisted Better Auth sessions, deleted after each
pass; synthetic API-key sessions cannot authorize upstream sensitive operations.
No native database permissions are edited directly.

`scripts/deploy/deploy-projects-roles.sh` builds committed prepared images,
backs up the native database, migrates the identity contract, enrolls the native
controller through operator-only server APIs, and activates the reconciler.
`e2e/tests/projects-roles.spec.js` exercises real OIDC identity links, native
reader/writer/admin permissions, same-key and same-cookie downgrades, WebSocket
closure, disabled users, cross-app grants, and application removal. Report live
acceptance separately from a successful build or rollout.

Live acceptance on 2026-09-22 passed with image `blak-projects:87536895cff8`:
reader/writer/admin transitions; API-key and cookie downgrade; read-only limits
on a privately owned workspace; protected directory/controller authority;
WebSocket closure; disabled users; cross-app grants; restoration; and app removal.
The real Blak ID journey passed in 7.3 minutes. A separate Chat/Projects-to-Hermes
sync regression passed, including native retrieval and cleanup. Validation also
passed 289 Python tests, 12 bridge tests, and 6 patched-native function tests.

## Acceptance

For every app, test a reader, writer, admin and unrelated user through native
login and direct APIs. Test permitted actions, prohibited mutations, role removal,
role downgrade, cross-app role isolation and native resource ownership. Verify
configuration through a fresh login and through an existing session. Do not claim
all apps are integrated while any mapping above remains unimplemented.

## References checked 2026-09-21

- [OpenCloud role mapping](https://docs.opencloud.eu/docs/dev/server/services/proxy/information/)
- [OpenCloud Space roles](https://docs.opencloud.eu/docs/user/roles/space-roles/)
- [Outline roles](https://docs.getoutline.com/s/guide/doc/users-roles-cwCxXP8R3V)
- [Kaneo permission vocabulary](https://github.com/usekaneo/kaneo/tree/main/packages/permissions)
- [HeyForm native role guard](https://github.com/heyform/heyform/blob/next/packages/server/src/common/guard/role.guard.ts)
- [Vaultwarden OIDC](https://github.com/dani-garcia/vaultwarden/wiki/Enabling-SSO-support-using-OpenId-Connect)

## Portal module implementation

Draw, Flow, Cloud and Search use `blak-draw-*`, `blak-flow-*`, `blak-cloud-*`
and `blak-search-*` groups. Their signed `blak_roles` claims are re-read from
Blak ID userinfo every 30 seconds, alongside active status and app grants. The
portal requires both the app grant and the role on every interactive local data operation.
Reader cannot mutate data, invoke a flow, create buckets/queues or send messages.
Draw uses native Excalidraw view mode; private drawing and flow ownership checks
remain in force even for app admins. Cloud buckets are shared app storage.
Search writer/admin roles do not grant additional source visibility. These portal
modules currently have no separate member-management UI; app admin therefore
adds no cross-owner powers beyond writer capabilities.

The one-time migration grants existing legacy module members writer access and
existing directory operators app admin. It records a marker on each legacy group;
future deployments do not restore removed memberships. New users need an explicit
role group. No role, malformed claims or missing claims fail closed. Existing
sessions can retain their last checked permissions for at most 30 seconds before
an online request refreshes them; previously loaded/exported content cannot be
retracted.

Search filters cached documents by current source-app grants as well as document
ownership, workspace visibility and expiry. A Search admin role grants no source
access. Removing a source grant hides its cached results after the same session
refresh interval; unknown sources and Vault are excluded. Source labels are shared
with the indexer through a generated catalog to prevent mapping drift.

## Remaining delegated-access work

Hermes source enrollment uses separate owner-bound machine credentials. Those
credentials and already copied native Hermes knowledge still need source-grant
revocation reconciliation; portal session checks and Search filtering do not
provide that guarantee. The remaining native-app work must test these credentials
and existing native tokens after role removal, not just a fresh OIDC login.

## Hermes native enforcement

`blak-hermes-reader`, `blak-hermes-writer` and `blak-hermes-admin` map to native
Open WebUI groups and user roles. The controller reconciles every 60 seconds.
Native users link through their stored OIDC subject, including the frozen subject
aliases used before the UUID migration. Email does not establish that link.
Unlinked, disabled and removed users become native `pending`, which rejects data
requests made with existing tokens. Only the explicitly enrolled service
controller is exempt. Other native group memberships are removed because native
permissions are additive; Blak ID is authoritative for Hermes membership.

Readers can chat and read shared group knowledge. Writers can create and edit
knowledge; only collection owners or app admins can change collection access or
delete the collection itself. Native personal resources retain owner capabilities.
An uploaded file attached to shared knowledge requires current write access to
**every** containing shared collection, even for its uploader. This check covers
content updates, renames, deletion and ingestion APIs. App admins have native
administrative visibility; do not grant this role to ordinary knowledge writers.

The pinned upstream image has small, hash-checked native patches. Image builds
fail if upstream permission/deletion code changes and run tests against the
patched functions. Vector and storage failures keep file metadata available for
retry; per-file vector collections are actually deleted rather than silently
left behind. Shared knowledge membership changes cannot be smuggled through the
metadata update endpoint. The enrolled controller alone may reconcile the
original human administrator's role, and other app admins cannot edit or delete
that controller.

The role controller shares only the indexer's state volume and immutable owner
journal; it does not receive source credentials. When source access is removed,
it pauses the affected native account before attempting the indexing lock,
removes only tracked copies owned by that account, and detaches their model
references before restoring permitted Hermes access. A partial cleanup leaves
the account paused and reports unhealthy reconciliation. The indexer also checks
current directory grants on every run. Neither component indexes Vault.

Deploy the new identity contract and run the indexer successfully to establish
its owner journal before enabling the role controller. Enroll a dedicated native
controller with `scripts/deploy/provision-hermes-roles.py`; credentials are stored
in Kubernetes Secrets. Enrollment preserves other configured native apps. Native
role acceptance is recorded separately from image builds and unit tests.

Use `scripts/deploy/deploy-hermes-roles.sh` on the homelab host from a prepared
release for the scoped rollout. It preserves other enrolled app configurations,
requires a successful indexer job, and waits for controller readiness. Fresh
native accounts default to `pending` until reconciled. The current native token
lifetime is four weeks; role enforcement is checked against current native state,
not deferred until token expiry.

Live acceptance on 2026-09-22 verified native reader/writer/admin transitions,
writer denial of membership changes, reader denial of edits to their own shared
upload, controller protection, disabled users, cross-app isolation, and removal
with the same native token. Separate source-revocation acceptance verified native
file, retrieval, model-reference and per-file vector cleanup while retaining the
user's authorized Hermes session. These checks cover Hermes; the remaining native
application mappings above require their own acceptance.

Controller enrollment and recurring administrator calls use the prepared HTTPS
Hermes origin with certificate and hostname verification. The controller trusts
the configured workspace CA in addition to system roots. Ownerless legacy sync
mappings are rejected before native data access or deletion. Once a source listing
has established current access, transient processing failures preserve tracked
copies for retry; explicit access denial still revokes them. A failed source
listing remains fail-closed because continuing source access cannot be verified.

## CRM native enforcement (acceptance pending)

CRM uses pinned Frappe 15.121.0 and CRM 1.84.0. The controller binds accounts
through native `User Social Login` records using the immutable Blak ID subject.
Existing email collisions fail closed; email changes cannot relink an account.
Human admin maps to Sales Manager, never System Manager. Directory-managed role
markers cap native document permissions, including owner and ignore-permission
paths. Native object permissions still apply.

Reader retains read, select, print, export and report operations plus explicitly
reviewed read RPCs. Both API versions, document-method dispatch and uploads apply
the same role bounds. Writer and admin cannot change identity links, role
profiles, directory roles or another user's authority. Native field metadata
marks reader inputs read-only. Role changes close the user's native realtime
connections; subsequent cookie and API-key requests evaluate current permissions.
Disabled or removed members become disabled native users. Restoration retains
the original native account and its ownership.

The scoped deployment backs up MariaDB before migration and rejects a site name
that differs from the live deployment. Prepare tailnet releases with
`--crm-site <existing-site-directory>`: public DNS must not select a different
Frappe database. Startup refuses to create a new site when another site already
exists on the volume. Startup journals exact
native Blak ID bindings and fails if migration or setup loses one; ordinary user
saves cannot remove or replace an existing binding. Recovery must use the exact
original native binding, never inferred email matching. The dedicated controller
and built-in Administrator are separate from human app administrators.

Validation so far: 299 repository tests, nine actual native Python entry-point
tests and the native realtime-consumer test pass. Authenticated live acceptance
is still pending; deployment alone does not certify CRM roles.
