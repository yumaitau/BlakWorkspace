# App-specific Blak ID roles

Status: implementation design. This document does not certify live enforcement.

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
