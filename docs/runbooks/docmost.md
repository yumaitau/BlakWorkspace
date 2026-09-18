# Docmost (Blak Knowledge)

Default profiles keep Knowledge **disabled** until pin and licence review. The supported enablement sketch is `deploy/profiles/eval/knowledge-docmost.example.yaml` (Docmost on, XWiki off, public unauth off).

## Pin and licence

Image tag/digest: **TBD**. Copy from a real Docmost release when integrating. Do not invent digests. Licence: TBD in THIRD_PARTY_NOTICES until recorded. Owner must confirm edition/paid SSO before calling production "supported".

## SSO / OIDC

Use Nubus/Keycloak as IdP (ADR-003, BW-019/BW-020). Map groups to Docmost spaces. Unauthorised users must not read pages via UI or direct URL/API. `knowledge.allowPublicUnauthenticated` must stay false; `scripts/validate-manifest.py` fails the tree if it is true.

Live joiner/mover/leaver and synthetic page tests require an eval cluster, which this seed does not start.

## Backup

Back up Docmost PostgreSQL and object storage with the order in [backup-restore.md](backup-restore.md). Missing encryption keys fail closed. No restore rehearsal was executed in this seed.

## Branding

Portal tile label is **Blak Knowledge** (`deploy/overlays/blak/portal-labels.example.yaml`). Keep Docmost/upstream attribution on legal/support surfaces.

## Related

- [ADR-010](../adr/ADR-010.md)
- BW-034 XWiki portions superseded by BW-055
