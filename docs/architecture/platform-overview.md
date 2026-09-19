# Platform overview (pivot)

Portal owns UX. Backends replaceable via adapters. OIDC-first, API-first, event-light.

```
┌───────────────────────┐
│    Blak Workspace     │
│        Portal         │  Next.js, Blak Home, launcher, search, notifications
└───────────┬───────────┘
            │ OIDC / REST / WebDAV / WOPI / webhooks / events
┌───────────┼────────────┐
│           │            │
Drive       Docs        Sites       Projects (opt)  Forms (opt)  Chat (opt)
│           │            │
OpenCloud  Collabora   Docmost      Plane           TBD           Matrix/Mattermost
│           │            │
└───────────┴───────┬────┴────────────┘
                    │
             Identity Layer (Authentik / Keycloak, federate Entra/LDAP/AD/SAML)
```

## Blak Home (Portal)

Dashboard, app launcher, branding, nav, global search, recent, favourites, notifications, announcements, profile, directory, site discovery, admin, permission visibility, AI entry (when enabled).

## Phase 1 MVP

Portal + Identity + Drive + Docs + Sites + Search + Admin + Audit.

Flow: open domain → SSO once → Home → Sites → files → create/edit/collab → permitted search → knowledge → logout once.

## Cross-cutting

- Search: Blak Search over Drive/Sites/Projects/Forms/Chat, permission-enforced. Meilisearch default for Micro/Small, OpenSearch optional larger.
- Notifications: central service, backends emit `document.shared`, `task.assigned`, etc. Deliver Portal/email/push/Teams/webhook.
- Events: NATS (default) or Redis Streams. No Kafka unless scale demands. Feeds notifications, search index, automation, audit, AI.
- Audit: `user.login`, `file.read/created/modified/shared/deleted`, `site.read/modified`, `permission.changed`, `admin.changed`, `ai.query/document_access`, `workflow.executed`. SIEM export.
- AI: Blak AI Gateway, OpenAI-compatible. Local (DGX Spark/GPU) or Bedrock/Azure/OpenAI. Workspace calls gateway only. Permission-aware retrieval. Runs without AI node.

## Data

Shared Postgres cluster (logical DBs per app), Valkey/Redis, S3 abstraction (MinIO/SeaweedFS/sovereign S3). Separate later for scale.

## Deploy

Compose for Micro/Small (POC, 1–3 nodes), K3s/Helm for Business/Enterprise. Same containers. Observability via Blak Admin (health, logs, metrics, storage, auth events, AI usage).
