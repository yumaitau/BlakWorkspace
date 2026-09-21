# App-specific Blak ID roles

Status: Vault native enforcement is implemented and tested separately. Draw, Flow,
Cloud and Search enforcement is implemented. The 14-test live portal suite
passed, including existing-session role changes and private-owner boundaries. The remaining native app mappings below are still implementation
design; this document does not certify their live enforcement.

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
| Projects | Viewer | Member | Admin | Native API project/task writes and member management |
| Knowledge | Viewer | Editor | Admin | Document writes denied; document/comment distinctions documented |
| CRM | Read-only CRM permission set | Sales User | Sales Manager with scoped administration | Native Frappe permission checks on lists, documents and mutations |
| Forms | Must verify native support | Collaborator/member as supported | Workspace admin | GraphQL mutations denied to reader, including aliases and batches |
| Chat | Read-only custom native role | Normal member | Scoped app admin | Message writes, channel/member management and existing-token downgrade |
| Hermes | Use permitted sources/models | Manage permitted knowledge | App admin | Native permission checks and continued private owner boundaries |
| Draw / Flow / Cloud | Server-side read capability | Server-side write capability | Scoped management capability | Direct API denial; no owner bypass |
| Search | Search permitted sources | No extra source rights | Manage app settings only | Search cannot widen source ACLs |

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
