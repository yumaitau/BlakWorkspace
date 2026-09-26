# Blak Workspace product contract

**Maturity: seed.** This document is the product contract for the Blak Workspace overlay distributed by Yuma IT, plus the platform pivot (ADR-014). It is not a production service description and does not implement the full suite.

## What it is

Blak Workspace is an Indigenous-branded digital workplace suite distributed as branding, configuration, deploy automation, documentation, and carefully scoped extensions on [openDesk](https://docs.opendesk.eu/operations/introduction/) (ZenDiS). User-facing labels use Blak product names. Internal chart names, Helm release names, OIDC client IDs, and application identifiers stay as upstream defines them.

Pivot (ADR-014): Blak Portal (Next.js) owns UX; backends are replaceable OSS behind adapters. Base = Portal + Identity + Drive + Docs + Sites + Search + Admin + Audit. No self-hosted mail, no Jitsi, no OpenProject by default. Original Blak code Apache-2.0 where possible; upstream keeps own licences. See [NOTICE](../NOTICE), [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), and [docs/adr/](adr/README.md).

## Naming map (labels only)

| Blak label | Upstream component |
| --- | --- |
| Blak Workspace | openDesk suite |
| Blak Drive | OpenCloud; the single portal entry for files and office editing |
| Blak Docs | Collabora, opened from Drive; no separate portal tile |
| Blak Chat | Rocket.Chat (OIDC via Blak ID; openDesk seed still documents Element) |
| Blak Meet | Jitsi (optional integration; Teams / Meet / Jitsi via MeetingProvider) |
| Proton Mail (mail and calendar) | Proton for Business, linked from Blak Home (catalog id `mail`). Not self-hosted and not Blak-branded. See [Mail and calendar](#mail-and-calendar). OX App Suite stays an optional licensed alternative. |
| Blak Knowledge | Outline (team wiki with free OIDC; replaced Docmost, whose SSO is licence-gated) |
| Blak Projects | Kaneo (OIDC via Blak ID; openDesk seed still documents OpenProject) |
| Blak Admin | Nubus admin / portal admin surfaces (pivot evaluates Authentik / Keycloak standalone) |
| Blak Flow | Node-RED selected with the accepted [RBAC and opt-in connection model](node-red-rbac-and-connections.md); migration from the portal prototype in progress |
| Blak Hermes | Hermes agent runtime (opt-in; Nubus control plane; default off; evolves into Blak AI Gateway) |
| BlakSmith | BlakSmith knowledge graph (separate checkout `yumaitau/BlakSmith`; catalog id `smith`) |
| BlakEyes | BlakEyes drone imagery appliance (separate checkout `yumaitau/BlakEyes`; catalog id `eyes`) |

Do not rename upstream chart IDs, Helm release names, or OIDC client IDs to match these labels. Do not rename upstream internal identifiers.

## Mail and calendar

Blak Workspace does not run its own mail or calendar server. The recommended
provider is **Proton for Business** (Proton Mail and Proton Calendar). Blak Home
shows a Proton Mail tile to members of the `Blak Mail users` group, and the tile
opens Proton directly.

### Why Proton

- **Mail is the hardest service to self-host well.** A mail server needs a clean
  sending reputation, spam and phishing filtering, blocklist monitoring, and
  24-hour operations. Home and small-site connections often cannot send mail at
  all. A missed message costs more than any other outage. Proton runs all of this.
- **Proton cannot read the mail.** Mail and calendar events are end-to-end or
  zero-access encrypted. Proton cannot read what is stored, and does not fund
  itself through advertising or by training AI on customer content. That supports
  a community keeping control of its own information, as in the CARE Principles
  for Indigenous Data Governance. It is not a sovereignty certification.
- **The apps are open source.** Proton's clients are published, and they have
  been independently audited.
- **It covers what people expect.** You get mail on the organisation's own
  domain, a shared calendar, contacts, and web, desktop and phone apps without
  extra work.
- **The rest of the workspace is unaffected.** Files stay in Blak Drive,
  passwords in Blak Vault, and chat in Blak Chat. Proton only replaces what we
  chose not to build.

### What to tell customers

- **Data location.** Data is held by Proton in Switzerland and the EU, not in
  Australia. Do not describe Proton as Australian-hosted or sovereign. An
  organisation that must keep mail in Australia should use Microsoft 365 with
  Australian data residency, or a licensed OX App Suite deployment.
- **Sign-in.** Proton accounts are separate from Blak ID. Confirm that the
  customer's Proton plan supports SAML single sign-on before promising one
  login. Blak ID (Authentik) can act as the SAML identity provider.
- **No Blak branding.** Proton pages carry no Blak branding and no way back to
  Home, because the workspace shell cannot reach them. The tile is labelled
  Proton Mail, not Blak Mail.
- **Encrypted content stays out of the workspace.** Hermes, Blak Search and
  Blak Flow cannot read Proton mail or calendars.
- **Limited sync with other apps.** Proton Calendar does not sync with other
  calendar apps over CalDAV. Other mail clients such as Outlook or Thunderbird
  need Proton Bridge, a desktop app on paid plans.
- **Other providers.** An organisation that already uses Microsoft 365, Google
  Workspace or another IMAP provider can keep it. Point the `mail` tile's URL at
  that provider with `BLAK_APP_ORIGINS`.

## In scope

- Branding and theming overlays that preserve upstream upgrades
- Helmfile/Kubernetes configuration profiles (eval / staging / prod intent)
- Operator documentation and architecture decision records
- Optional LAN DNS and local TLS tooling for dedicated/offline installations, or generated records for existing DNS; no dependency on a particular homelab or Tailscale account
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
