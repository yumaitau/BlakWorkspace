# Drive is the single entry for files and editing

Decision confirmed 2026-09-24: expose Blak Drive in the portal and remove the
duplicate Blak Docs tile. Retain OpenCloud storage and Collabora editing.
Users create and open documents, spreadsheets and presentations from Drive.

The internal `docs` service, WOPI integration, source permissions, storage volumes
and existing documents remain intact. The catalog keeps the internal component
for configuration but excludes it from app navigation and public modules.

Node-RED receives no document access from this change. Its source connections
require explicit opt-in to selected resources and actions under the accepted
[RBAC model](node-red-rbac-and-connections.md). Existing Hermes connections do
not confer Node-RED access.
