# Third-party notices

This file is a skeleton inventory for Blak Workspace overlays that configure or document openDesk components. It is not a complete SBOM.

## Deployment project

| Component | Upstream | Licence (as documented) | Notes |
| --- | --- | --- | --- |
| openDesk deployment (Helmfile) | ZenDiS / Open CoDE GitLab | Apache-2.0 | Baseline pin in docs/upstream-baseline.md |

## Functional applications (from openDesk introduction docs)

| Function | Component | Licence (as documented upstream) | Blak label |
| --- | --- | --- | --- |
| Chat | Element Web / Synapse / Nordeck | AGPL-3.0-or-later / AGPL-3.0-only / Apache-2.0 | Blak Chat |
| Notes | Notes | MIT | Blak Notes |
| Diagrams | CryptPad | AGPL-3.0-only | (diagrams) |
| Files | Nextcloud | AGPL-3.0-or-later | Blak Drive |
| Groupware | OX App Suite | GPL-2.0-only / AGPL-3.0-or-later | Blak Mail and Calendar (optional) |
| Knowledge | Docmost (Blak default; replaces XWiki) | TBD — record upstream licence at pin | Blak Knowledge |
| Knowledge (openDesk default, not Blak default) | XWiki | LGPL-2.1-or-later | Not enabled in Blak default profiles (see BW-055) |
| Portal and IAM | Nubus | AGPL-3.0-or-later | Blak Admin / sign-in |
| Projects | OpenProject | GPL-3.0-only | Blak Projects |
| Meet | Jitsi | Apache-2.0 | Blak Meet |
| Weboffice | Collabora | MPL-2.0 | Blak Docs |

## Gaps (honest)

- Full image digest and chart version inventory is not vendored in this seed; see upstream `images.yaml.gotmpl` and `charts.yaml.gotmpl` at the pinned tag.
- Transitive dependency licences for each application are not exhaustively listed here (tracked under BW-043).
- Enterprise Edition only components (for example Dovecot Pro / Cassandra paths) are not enabled by default and need separate licence review.
- Container base image notices are not yet collected.
- Exact Docmost licence and image pin are TBD until recorded under BW-055.

Do not treat this file as legal advice. Do not relicense upstream components as Apache-2.0.

## Blak Knowledge replacement

Docmost replaces XWiki for Blak Knowledge defaults (BW-055). Do not enable XWiki and Docmost together in default profiles.
