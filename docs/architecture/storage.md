# Production database and object storage

Eval may use upstream-bundled data stores. Production must not. Mapping follows openDesk external-services guidance plus a Docmost placeholder for BW-055.

## Mapping (core pilot)

| App / Blak label | Store | Eval | Prod intent | Backup relevant |
| --- | --- | --- | --- | --- |
| Nubus / Blak Admin | PostgreSQL (+ LDAP data) | Bundled | Operator Postgres | Yes |
| Nextcloud / Blak Drive | PostgreSQL + S3-compatible | Bundled / local disk | Operator Postgres + S3 | Yes |
| Collabora / Blak Docs | Stateless / config | Bundled | Stateless | Config only |
| Element / Blak Chat | PostgreSQL + media | Bundled | Operator Postgres + object | Yes |
| Jitsi / Blak Meet | Ephemeral | Bundled | Ephemeral | No (recordings if enabled: object) |
| OpenProject / Blak Projects | PostgreSQL + S3 | Bundled | Operator Postgres + S3 | Yes |
| Notes / Blak Notes | Per upstream Notes store | Bundled | Operator DB | Yes |
| Docmost / Blak Knowledge | PostgreSQL + object (discovery under BW-055) | Disabled until pin | Operator Postgres + object | Yes (once enabled) |
| OX App Suite (optional) | MariaDB; EE paths may involve Cassandra | Off | Off unless licensed | Yes if enabled |
| Redis / Memcached | Cache | Bundled | Operator cache | No (rebuild) |

Do not use NFS for RWO volumes where upstream marks it unsupported.

## Sizing (assumptions, not a quote)

Pilot: start small (single-digit GiB DB, tens of GiB object) and re-evaluate after BW-047. These numbers are planning hints, not purchased capacity.

## Gaps

- Exact Docmost volume names and bucket layout: BW-055
- Image digest inventory: not vendored
- EE Cassandra only if OX EE is later enabled (not default)

## Related

- [ADR-005](../adr/ADR-005.md)
- [docs/runbooks/backup-restore.md](../runbooks/backup-restore.md)
- [docs/architecture/profile-matrix.md](profile-matrix.md)
