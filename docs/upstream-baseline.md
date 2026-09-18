# Upstream baseline

Pinned discovery date: **2026-09-18 AEST**.

## Pin (use this)

| Field | Value |
| --- | --- |
| Project | openDesk deployment |
| Repository | https://gitlab.opencode.de/bmi/opendesk/deployment/opendesk |
| Tag | `v1.18.2` |
| Commit | `eab2ee774187308f82307f0daaf1471dfe560f34` |
| Tag date | 2026-09-11 |
| Operations docs | https://docs.opendesk.eu/operations/ |
| Introduction | https://docs.opendesk.eu/operations/introduction/ |

See also [deploy/upstream/PIN.md](../deploy/upstream/PIN.md) and [ADR-001](adr/ADR-001.md).

## Parallel line (do not mix with the pin)

Observed on the same discovery date: tag `v1.17.4`, commit `21c590d8f684d916be80ba00728fb02ef6c1250b` (2026-09-15). Recorded so operators do not confuse the two lines. Overlays target `v1.18.2` only.

## Image and chart inventory

Upstream lists images in `helmfile/environments/default/images.yaml.gotmpl` and charts in `helmfile/environments/default/charts.yaml.gotmpl` at the pinned tag. This repository does **not** vendor those files and does **not** invent image digests.

## Eval versus production external services

Eval may use upstream-bundled databases and object storage for learning only. Production intent requires operator-managed PostgreSQL/MariaDB/object storage per upstream external-services guidance. This seed does not apply production infrastructure.

## Gaps (honest)

- Image digests and chart versions are not copied here; read them from the pinned tag.
- Docmost is not an openDesk default; pin and licence for Blak Knowledge are tracked under BW-055 and must not be invented.
- Exact Helmfile key names for a Docmost replacement are discovery work, not assumed.
- Enterprise Edition only paths (for example Dovecot Pro / Cassandra) stay disabled.

## How to refresh

If ZenDiS publishes a newer tag, update this file, `deploy/upstream/PIN.md`, and ADR-001 together. Do not silently drift.
