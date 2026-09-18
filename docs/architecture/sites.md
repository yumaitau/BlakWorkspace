# Blak Sites

Intranet aggregation layer. Default profiles keep it **off**. See [ADR-012](../adr/ADR-012.md).

Sites does not store file binaries and does not rebuild Drive, Docs, Knowledge, Projects, Chat, or Meet. It owns site membership, pages, list schemas, library metadata, security-trimmed search, and audit.

## Providers (v1)

| Interface | Initial binding | Notes |
| --- | --- | --- |
| IdentityProvider | Nubus OIDC | No second IdP |
| FileProvider | Nextcloud | Collabora opens those files |
| KnowledgeProvider | Docmost | XWiki forbidden |
| Projects / Chat / Meet | OpenProject / Element / Jitsi | Deep-links only |

## Ship behind a flag

- Overlay: [deploy/overlays/blak/sites.yaml](../../deploy/overlays/blak/sites.yaml)
- Profiles: `sites.enabled: false` on eval/staging/prod
- OpenAPI: [deploy/sites/openapi.yaml](../../deploy/sites/openapi.yaml)
- Helm: [deploy/sites/chart](../../deploy/sites/chart) — platforms `linux/amd64,linux/arm64`, `egress.mandatory: false`, image tag TBD

Do not apply production from this seed. Pin the image before calling a profile supported. Live SSO/Helm smoke is not run here.

## API

Non-UI clients call the same operations as the UI (`createSite`, `addMember`, `createList`, `createListItem`). Server-side RBAC still applies if a control is hidden in the frontend.

Search results omit objects the caller cannot read. Audit export includes membership and role changes and strips document bodies.
