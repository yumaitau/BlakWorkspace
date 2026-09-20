# Third-party notices

This file is a skeleton inventory for Blak Workspace overlays that configure or document openDesk components. It is not a complete SBOM.

## Deployment project

| Component | Upstream | Licence (as documented) | Notes |
| --- | --- | --- | --- |
| openDesk deployment (Helmfile) | ZenDiS / Open CoDE GitLab | Apache-2.0 | Baseline pin in docs/upstream-baseline.md |

## Functional applications (from openDesk introduction docs)

| Function | Component | Licence (as documented upstream) | Blak label |
| --- | --- | --- | --- |
| Chat | Rocket.Chat (dedicated); Element Web / Synapse in openDesk seed | MIT / AGPL-3.0-or-later | Blak Chat |
| Notes | Notes | MIT | Blak Notes |
| Diagrams (dedicated) | [Excalidraw](https://github.com/excalidraw/excalidraw) 0.18.1 | MIT | Blak Draw, embedded editor |
| Diagrams (openDesk seed) | CryptPad | AGPL-3.0-only | Not selected for dedicated |
| Forms (dedicated) | [HeyForm](https://github.com/heyform/heyform) | AGPL-3.0 | Blak Forms, pinned upstream image |
| CRM (dedicated) | [Frappe CRM](https://github.com/frappe/crm/tree/v1.84.0) 1.84.0 | AGPL-3.0 | Blak CRM; native Blak ID login |
| CRM framework | [Frappe Framework](https://github.com/frappe/frappe/tree/v15.121.0) 15.121.0 | MIT | Native social login, persistence and background jobs |
| CRM rollback only | [Twenty](https://github.com/twentyhq/twenty) 2.41.0 | AGPL-3.0 with separately licensed Enterprise files | Retained inactive rollback manifest and data |
| Files | Nextcloud | AGPL-3.0-or-later | Blak Drive |
| Groupware | OX App Suite | GPL-2.0-only / AGPL-3.0-or-later | Blak Mail and Calendar (optional) |
| Knowledge | Docmost (Blak default; replaces XWiki) | TBD — record upstream licence at pin | Blak Knowledge |
| Knowledge (openDesk default, not Blak default) | XWiki | LGPL-2.1-or-later | Not enabled in Blak default profiles (see BW-055) |
| Portal and IAM | Nubus | AGPL-3.0-or-later | Blak Admin / sign-in |
| Projects | Kaneo (dedicated MIT); OpenProject in openDesk seed | MIT / GPL-3.0-only | Blak Projects |
| Meet | Jitsi | Apache-2.0 | Blak Meet |
| Weboffice | Collabora | MPL-2.0 | Blak Docs |
| Sovereign AI runtime | Hermes Agent (Yuma package `companyos-hermes`) | TBD — record upstream licence at pin | Blak Hermes (opt-in, default off) |

## Gaps (honest)

- Full image digest and chart version inventory is not vendored in this seed; see upstream `images.yaml.gotmpl` and `charts.yaml.gotmpl` at the pinned tag.
- Transitive dependency licences for each application are not exhaustively listed here (tracked under BW-043).
- Enterprise Edition only components (for example Dovecot Pro / Cassandra paths) are not enabled by default and need separate licence review.
- Container base image notices are not yet collected.
- Exact Docmost licence and image pin are TBD until recorded under BW-055.
- Exact Hermes Agent licence and `companyos-hermes` image pin are TBD until recorded under BW-056.

Do not treat this file as legal advice. Do not relicense upstream components as Apache-2.0.

## Blak Knowledge replacement

Docmost replaces XWiki for Blak Knowledge defaults (BW-055). Do not enable XWiki and Docmost together in default profiles.

## Dedicated application overlays

Forms and CRM retain upstream application code and notices. Shared CSS comes from a generated ConfigMap. Forms uses a disposable template copy; the Frappe adapter adds a stylesheet link to its CRM template. The upstream source links above provide the corresponding projects; Forms image digest is pinned in `deploy/k3s/micro/94-forms.yaml`; Frappe source releases and Docker recipe revision are pinned in `services/frappe/versions.env`. Excalidraw dependencies and patched transitive versions are recorded in `apps/portal/draw/package-lock.json`. The embedding source is `apps/portal/draw/src/`. Bundled fonts retain their upstream licences.
