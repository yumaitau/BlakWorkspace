# Blak Workspace product contract

**Maturity: seed.** This document is the product contract for the Blak Workspace overlay distributed by Yuma IT. It is not a production service description and does not implement the full suite.

## What it is

Blak Workspace is an Indigenous-branded digital workplace suite distributed as branding, configuration, deploy automation, documentation, and carefully scoped extensions on [openDesk](https://docs.opendesk.eu/operations/introduction/) (ZenDiS). User-facing labels use Blak product names. Internal chart names, Helm release names, OIDC client IDs, and application identifiers stay as upstream defines them.

openDesk is provided by ZenDiS GmbH. Overlay materials in this repository are Apache-2.0; upstream components keep their own licences. See [NOTICE](../NOTICE), [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), and [docs/adr/](adr/README.md).

## Naming map (labels only)

| Blak label | Upstream component |
| --- | --- |
| Blak Workspace | openDesk suite |
| Blak Drive | Nextcloud |
| Blak Docs | Collabora |
| Blak Notes | Notes |
| Blak Chat | Element |
| Blak Meet | Jitsi |
| Blak Mail and Calendar | OX App Suite (optional, if licensed) |
| Blak Knowledge | Docmost (replaces openDesk XWiki in Blak defaults; see BW-055) |
| Blak Projects | OpenProject |
| Blak Admin | Nubus admin / portal admin surfaces |
| Blak Flow | Reserved for later |
| Blak Hermes | Hermes agent runtime (opt-in; Nubus control plane; default off) |

Do not rename upstream chart IDs, Helm release names, or OIDC client IDs to match these labels.

## In scope

- Branding and theming overlays that preserve upstream upgrades
- Helmfile/Kubernetes configuration profiles (eval / staging / prod intent)
- Operator documentation and architecture decision records
- GitHub backlog and seed tooling
- Carefully scoped extensions that do not break upgrades

## Non-goals

- Microsoft 365 feature parity
- Invented community endorsements or cultural assets
- PROTECTED, IRAP, or other sovereignty certification claims
- Relicensing upstream openDesk components as Apache-2.0
- Deploying paid production infrastructure from this seed
- Renaming upstream internal identifiers

## Decisions

Foundational decisions live in [docs/adr/](adr/README.md) (ADR-001 through ADR-009). Working defaults live in [docs/assumptions.md](assumptions.md). The upstream pin lives in [docs/upstream-baseline.md](upstream-baseline.md).
