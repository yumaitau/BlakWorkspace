# Backup and restore rehearsal plan

Do not claim tested DR until a rehearsal actually runs (BW-045 on eval). Do not delete production to test.

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
