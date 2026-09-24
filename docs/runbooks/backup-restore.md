# Backup and restore rehearsal plan

Do not claim tested DR until a rehearsal actually runs (BW-045 on eval). Do not delete production to test.

## Homelab recovery checks

The running `blak-micro` suite uses
`scripts/deploy/backup/workspace-backup.py`, not the openDesk seed inventory below.
It discovers namespace PVCs and archives their bytes plus Kubernetes configuration
and secrets in an encrypted snapshot. Snapshot creation briefly stops application
workloads; the restore drill uses copied data and isolated Docker containers with
no network or published ports. It does not stop production services.
The drill requires the archived deployment's database images in the node's Docker
cache and uses `--pull=never`. K3s/containerd and Docker have separate image stores;
prepare the exact image in the restore engine before disconnecting. Missing images
fail closed rather than silently relying on a registry.

The database drill checks the shared PostgreSQL database, Frappe MariaDB,
Rocket.Chat MongoDB, Smith PostgreSQL 18, Hermes SQLite, Eyes SQLite and Vault
SQLite when those optional volumes exist. Smith's deployment and volume must both
be present, along with its recovery key; an incomplete inventory fails the drill.
An empty Smith graph is valid, but its `public.nodes` table must be readable. Eyes
requires its database file plus SQLite integrity and foreign-key checks.

Key presence is not proof that every culturally governed record can be decrypted.
The drill also does not prove fresh sign-in, office editing, full application
recovery, or offline image availability. Rehearse those separately under the
[offline readiness gates](offline-readiness.md). Ollama model weights are excluded
from the current snapshot: retain a separate verified offline copy before a remote
deployment; re-downloading them is not an offline recovery plan.

Read `/var/backups/blak-workspace/last-backup.json` and
`last-restore-drill.json` on the node for actual timestamps and coverage. Keep
archives, recovery keys and private resource inventories out of git. A successful
older drill does not prove recovery of applications added afterward.

On **24 September 2026**, the expanded drill restored
`workspace-20260923T173122Z.tar.gpg`: **27 volumes, 16,288 verified files**, and
successful checks for all seven stores listed above, in 41 seconds. Database
containers had `--network none` and `--pull=never`; only copied volumes were mounted.
The archived Smith graph contained zero nodes, so this proves schema readability,
not recovery of an encrypted cultural record. PostgreSQL 18 parent-directory
ownership is repaired within the copied volume before startup, because safe tar
extraction deliberately discards original ownership. Production workloads remain
running during the drill.

## openDesk seed rehearsal plan

## Stores to back up

From [docs/architecture/storage.md](../architecture/storage.md):

1. PostgreSQL (Authentik, OpenCloud, Docmost, Meilisearch when enabled)
2. MariaDB (only if optional OX is on)
3. S3-compatible buckets (Drive, Projects, Knowledge, media)
4. LDAP / identity artefacts required to bind users after restore
5. Backup encryption keys (held outside the cluster)
6. Hermes volume when Blak Hermes is enabled (sessions, memory, skills)

Skip caches (Redis/Memcached). Collabora is stateless.

## Restore order

1. Confirm encryption keys present; **abort if keys missing** (incomplete backup)
2. Identity (Nubus / LDAP) so subjects exist
3. Database instances
4. Object buckets
5. Application config / Helm values (no secrets from git)
6. Smoke: one Drive file, one Chat message, one Knowledge page (when Docmost enabled)

## RPO / RTO assumptions (not owner-accepted)

Published so operators can accept or reject them. **Owner accept is pending** in [docs/governance/decision-log.md](../governance/decision-log.md). Do not treat this as signed DR.

| Assumption | Seed default | Status |
| --- | --- | --- |
| RPO | 24 hours for pilot eval data | pending owner accept |
| RTO | 8 hours to restore eval into a fresh namespace | pending owner accept |
| Prod RPO/RTO | Undecided; tighter than eval | pending |

## Rehearsal checklist

- [ ] Inventory matches live PVCs/DBs/buckets
- [ ] Encryption keys recoverable by a second person
- [ ] Restore into a non-prod namespace
- [ ] Missing-key test: restore without key is detected and fails closed
- [ ] Synthetic Drive object round-trips
- [ ] Docmost space reserved for BW-055 once pinned
- [ ] Record date, operator, and outcome in the customer log (not a fake pass here)
- [ ] Schedule first rehearsal after eval exists (BW-045)

## Related

- BW-011 storage design, BW-045 execute rehearsal, BW-055 Docmost stores
- [ADR-005](../adr/ADR-005.md)
