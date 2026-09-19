# Adapters (upstream → Blak)

Prefer adapter over fork. Each capability has a TypeScript interface in `packages/` (scaffold) and one adapter per backend in `adapters/`.

```
Upstream → Adapter → Blak API → Blak UI
```

## Interfaces

- `StorageProvider`: My Files, Shared With Me, Teams, Sites, Recent, Favourites; WebDAV, sharing, versions, locking, previews. Backends: `opencloud`.
- `DocumentProvider`: WOPI/collab edit, comments, versions, locking. Backend: `collabora`.
- `KnowledgeProvider`: sites, pages, KB, policies, history, templates, search, attachments. Backend: `docmost`. XWiki removed.
- `ProjectProvider`: projects, tasks, boards, milestones, assignees. Backend: `plane` (optional). OpenProject not default.
- `IdentityProvider`: OIDC/OAuth2, SAML, MFA, groups/roles, SCIM, LDAP/AD, Entra federation, service accounts. Backends: `authentik`, `keycloak`.
- `ChatProvider`: channels, mentions, history. Backends: `matrix`, `mattermost`.
- `MeetingProvider`: create/join, links. Backends: `teams`, `meet`, `jitsi` (optional self-host).
- `MailProvider`: read/send via integration, not hosting. Backends: `m365`, `google`, `imap`.
- `AIProvider`: OpenAI-compatible chat/embeddings via gateway. Backends: local, bedrock, azure.
- `SearchProvider`: index + permission-filtered query. Backends: `meilisearch`, `opensearch`.

Rules: Portal talks to Blak API only. Secrets via env/vault, never git. Permission checks at source + re-checked at search/AI layer.
