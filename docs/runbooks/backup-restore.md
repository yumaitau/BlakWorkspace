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

## Backups page in Blak Home

Blak ID admins (people with the `idp` app) get a **Backups** page at `/backups`.
Drive admins do not. From the page an admin can:

- see saved backups, the next scheduled run and the last drill
- start a backup or a drill
- restore the whole workspace from a backup
- add or remove other places that keep a copy
- show the recovery key

The design follows umbrelOS (scheduled encrypted snapshots, extra destinations,
a full restore that signs everyone out). No umbrelOS code is used. Its licence is
PolyForm Noncommercial.

### How it fits together

- `scripts/deploy/backup/backup-agent.py` runs on the host as root under
  `blak-backup-agent.service`.
  - It listens on `10.42.0.1:8093`, the k3s `cni0` pod bridge, so only the host
    and its pods can reach it. Set `BACKUP_AGENT_BIND` to use a different address.
  - Every request needs the bearer token in `/etc/blak-backup/agent-token`.
    `install.sh` copies that token into secret `blak-backup-agent`.
  - The agent never does the work itself. It starts one of these systemd units:
    - `blak-workspace-backup.service`: a snapshot
    - `blak-workspace-restore.service`: the isolated drill
    - `blak-workspace-full-restore.service`: a production restore
  - Jobs survive agent and portal restarts, and it runs one job at a time.
- The portal reads `BACKUP_AGENT_URL` and `BACKUP_AGENT_TOKEN`. Without them the
  page says backups are not available.
- While a snapshot or restore runs, every Deployment except `ollama` and
  `workspace-shell` is scaled to zero. That includes the portal. The page polls
  and comes back by itself.
- When Blak ID is unreachable, the portal refuses the request but no longer
  deletes the session. An admin stays signed in across a backup.

### Install on the homelab

1. Run `scripts/deploy/backup/install.sh` on the host. It installs the scripts
   and units, creates the agent token and secret, and installs `cifs-utils` and
   `nfs-common` if they are missing.
2. Build and import the portal image as usual.
3. Do not apply `30-portal.yaml` to the live homelab. Patch the live Deployment
   instead:

```sh
kubectl -n blak-micro set env deploy/portal BACKUP_AGENT_URL=http://10.42.0.1:8093
kubectl -n blak-micro set env deploy/portal --from=secret/blak-backup-agent --prefix=BACKUP_AGENT_ --keys=token
```

The second command creates `BACKUP_AGENT_TOKEN` from the secret's `token` key.

### Full restore

The admin picks a backup and types `RESTORE`. The agent writes
`restore-request.json`, and `workspace-backup.py restore` then runs these steps:

1. Fetch the archive from the chosen place if it is not already on the host.
2. Refuse to start unless free space is at least 4× the archive size plus 5 GiB.
3. Decrypt and unpack the archive with numeric owners, then check every SHA-256
   in the manifest.
4. Pause the workspace. This uses the same quiesce step and `resume.json` journal
   as a snapshot.
5. Put back every Secret whose data changed, except `blak-backup-agent` and
   service-account tokens.
6. For each volume that is in both the backup and the cluster, rename the live
   directory to `<pv path>.pre-restore-<stamp>` and move the backup copy into its
   place.
7. Delete the portal `sessions.enc`, so everyone signs in again.
8. Start the apps again and write `last-restore.json`.

Each step is recorded in `restore-journal.json`. If anything fails, or the unit
is stopped, `recover` puts the old directories and secrets back before scaling
up. The latest `.pre-restore-*` directories are kept until the next successful
restore, so a restore can be undone by hand.

Blak ID sessions stored in PostgreSQL go back to how they were at backup time.
People and grants removed after the backup come back. Review Blak ID after a
restore.

Restoring onto a new host needs the same namespace and PVCs to exist first:

1. Deploy the suite.
2. Put the saved recovery key in `/etc/blak-backup/key` with mode 600.
3. Add the place.
4. Restore from it.

### Other places

Places are stored in `/etc/blak-backup/places.json`, mode 600. After each
successful snapshot the archive is copied to every place, and each place keeps
its newest N copies. A place that fails is recorded in `places-status.json` and
shown on the page. It does not fail the backup.

| Kind | Rules |
| --- | --- |
| Folder | Must be under `/media` or `/mnt` and on a different device from `/`, so an unplugged drive cannot fill the system disk |
| SMB | Mounted with `vers=3.0,seal`. Credentials are passed through a private temporary file |
| NFS | Mounted `soft`. The export must already allow this host |
| S3 | S3, R2, B2 or MinIO over HTTPS, using path-style requests signed with SigV4 and multipart uploads. Needs only the Python standard library |

Archives are GPG-encrypted before they leave the host. Save the recovery key
outside the workspace. Without it, no copy can be opened, including off-site
copies.

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
