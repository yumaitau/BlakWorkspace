# Blak Workspace product contract

**Maturity: seed.** This document is the product contract for the Blak Workspace overlay distributed by Yuma IT, plus the platform pivot (ADR-014). It is not a production service description and does not implement the full suite.

## What it is

Blak Workspace is an Indigenous-branded digital workplace suite distributed as branding, configuration, deploy automation, documentation, and carefully scoped extensions on [openDesk](https://docs.opendesk.eu/operations/introduction/) (ZenDiS). User-facing labels use Blak product names. Internal chart names, Helm release names, OIDC client IDs, and application identifiers stay as upstream defines them.

Pivot (ADR-014): Blak Portal (Next.js) owns UX; backends are replaceable OSS behind adapters. Base = Portal + Identity + Drive + Docs + Sites + Search + Admin + Audit. No mail, no Jitsi, no OpenProject by default. Original Blak code Apache-2.0 where possible; upstream keeps own licences. See [NOTICE](../NOTICE), [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), and [docs/adr/](adr/README.md).

## Naming map (labels only)

| Blak label | Upstream component |
| --- | --- |
| Blak Workspace | openDesk suite |
| Blak Drive | OpenCloud; the single portal entry for files and office editing |
| Blak Docs | Collabora, opened from Drive; no separate portal tile |
| Blak Chat | Rocket.Chat (OIDC via Blak ID; openDesk seed still documents Element) |
| Blak Meet | Jitsi (optional integration; Teams / Meet / Jitsi via MeetingProvider) |
| Blak Mail and Calendar | OX App Suite (optional, if licensed; default is M365/Google/IMAP integration) |
| Blak Knowledge | Outline (team wiki with free OIDC; replaced Docmost, whose SSO is licence-gated) |
| Blak Projects | Kaneo (OIDC via Blak ID; openDesk seed still documents OpenProject) |
| Blak Admin | Nubus admin / portal admin surfaces (pivot evaluates Authentik / Keycloak standalone) |
| Blak Flow | Node-RED selected with the accepted [RBAC and opt-in connection model](node-red-rbac-and-connections.md); migration from the portal prototype in progress |
| Blak Hermes | Hermes agent runtime (opt-in; Nubus control plane; default off; evolves into Blak AI Gateway) |
| BlakSmith | BlakSmith knowledge graph (separate checkout `yumaitau/BlakSmith`; catalog id `smith`) |
| BlakEyes | BlakEyes drone imagery appliance (separate checkout `yumaitau/BlakEyes`; catalog id `eyes`) |

Do not rename upstream chart IDs, Helm release names, or OIDC client IDs to match these labels. Do not rename upstream internal identifiers.

## In scope

- Branding and theming overlays that preserve upstream upgrades
- Helmfile/Kubernetes configuration profiles (eval / staging / prod intent)
- Operator documentation and architecture decision records
- GitHub backlog and seed tooling
- Carefully scoped extensions that do not break upgrades
- Pivot additions: Portal, adapters, gateway/search/notifications/audit services; Compose (Micro/Small) + K3s/Helm (Business/Enterprise) with same containers; OIDC-first, permission-aware search/AI, central audit with SIEM export

## Non-goals

- Microsoft 365 feature parity
- Invented community endorsements or cultural assets
- PROTECTED, IRAP, or other sovereignty certification claims
- Relicensing upstream openDesk components as Apache-2.0
- Deploying paid production infrastructure from this seed
- Renaming upstream internal identifiers
- Shipping every app because it exists; Phase 1 is Portal + Identity + Drive + Docs + Sites + Search + Admin + Audit + Flow only

## Decisions

The [offline community roadmap](offline-community-roadmap.md) records the accepted
delivery order for expanding the suite. Its gates must pass before offline or
community-governance claims are promoted; a selected tool is not a deployed feature.

Foundational decisions live in [docs/adr/](adr/README.md) (ADR-001 through ADR-009, extended to ADR-014). Working defaults live in [docs/assumptions.md](assumptions.md). The upstream pin lives in [docs/upstream-baseline.md](upstream-baseline.md). Pivot: [docs/architecture/platform-overview.md](architecture/platform-overview.md), [docs/architecture/adapters.md](architecture/adapters.md), [docs/architecture/profiles.md](architecture/profiles.md).
