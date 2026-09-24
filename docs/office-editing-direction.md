# Office editing without separate Drive and Docs apps

## Requested direction

Remove the separate Blak Drive and Blak Docs user-facing products. Retain editing
for documents, spreadsheets and presentations. This is a product direction;
no application, storage volume or user document has been removed.

The running homelab already uses Collabora CODE for editing. It uses LibreOffice
technology and provides the required document types. OpenCloud currently owns
the files and supplies the editor's WOPI read/write and permission boundary.
Collabora alone is not a replacement file store.

## Proposed user experience

One Documents area, reachable from the workspace and from document attachments.
Users can create a document, spreadsheet or presentation, upload an existing
file, then edit it in Collabora within the same workspace experience. The label
is provisional; no new branded product name is assumed.

Authentication remains Blak ID. The system storing the document must check its
read/edit permissions before issuing editor access. Saving, locking, version
conflicts, sharing, deletion/recovery and backups still need an owner.

## Storage decision still needed

1. Keep OpenCloud as hidden storage initially. Remove its separate app entry
   and build the smaller Documents experience on its existing APIs. Existing
   files, permissions and WOPI integration remain usable during the transition.
2. Remove OpenCloud entirely. Select or build a replacement document store and
   WOPI host, migrate files and permissions, verify saves and backups, then retire
   OpenCloud. A plain object bucket is not the complete replacement: access checks,
   file identity, locking and save/version behavior still need implementation.

The first option is the lower-change migration. The second satisfies removal of
the backend itself but is a larger storage migration. The user's intended scope
must be established before either is presented as the final architecture.

## Node-RED access

Neither option automatically exposes documents to Node-RED. A user grants an
explicit connection to selected resources and actions. The consent UI describes
Documents and the actual owning account, rather than requiring a Blak Drive app.
Read is the default; writing, deleting and sending contents elsewhere need
separate grants. Existing Hermes connections confer no Node-RED access.

For background flows, the source still enforces document ACLs and connection
revocation. Direct access to underlying storage must not bypass those checks.
See [the RBAC and opt-in proposal](node-red-rbac-and-connections.md).

## Source

[Collabora integration FAQ](https://www.collaboraonline.com/faqs/) explains its
LibreOffice-based editing, document types, WOPI integration and the host's
responsibility for storage and authentication.
