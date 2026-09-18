# Architecture overview

Blak Workspace is an overlay on a pinned openDesk deployment: baseline first, then Blak labels and configuration. One customer organisation per deployment. Eval, staging, and prod are separate intents; this seed does not apply production infrastructure.

## Building blocks

- Identity: Nubus (Keycloak / OpenLDAP / portal) as baseline IdP
- Drive / Docs: Nextcloud + Collabora
- Knowledge: Docmost for Blak Knowledge (not XWiki; BW-055)
- Collaboration: Element, Jitsi, optional OX, OpenProject, Notes
- Brand: upstream theme hooks and label maps only

## Decisions

See the ADR set:

- [ADR-001](../adr/ADR-001.md) through [ADR-009](../adr/ADR-009.md)
- Index: [docs/adr/README.md](../adr/README.md)

Working defaults: [docs/assumptions.md](../assumptions.md). Pin: [docs/upstream-baseline.md](../upstream-baseline.md). Contract: [docs/product-contract.md](../product-contract.md).
