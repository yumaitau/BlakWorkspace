# Recovery targets, backups and regional runbook

Proposed targets require capacity benchmarks and regional fault drills before any SLA.

| State | Proposed RPO | Proposed RTO / behaviour |
| --- | --- | --- |
| Acknowledged inbound/submitted message bytes | 0 for a single-region loss, **conditional on proven dual-region acceptance journal** | Replay within 60 minutes of incident declaration; no success ACK without required persistence |
| Mailbox folders/flags/ACLs, calendars/contacts | At most 15 minutes target | 60 minutes regional activation target; reconcile revoked access before reopening |
| Credential revocations / security policy | Fail closed if current version cannot be established | Restore trusted policy before any send or privileged action |
| Inbound gateway availability | Senders retry; either MX survives | Regional outage detection within 5 minutes target; surviving MX accepts or safely defers |
| Outbound | Durable queue | SES recovery time plus controlled backlog drain; held/degraded throughout outage |
| Full corruption/ransomware restore | Last verified immutable recovery set; hourly target | 24 hours at agreed capacity; measured by rehearsal |

EFS replication generally targets 15 minutes but may exceed it; its sync watermark is
not a transaction-consistent snapshot across databases and files. See [AWS replication
behaviour](https://docs.aws.amazon.com/efs/latest/ug/efs-replication.html). Alarm on lag
over 5 minutes; page at 15 minutes; do not report the RPO achieved while lag exceeds
target. Cross-region replication also copies corruption/deletions and is not backup.

## Backup schedule proposal

- Continuous database recovery logs and replication, with monitored archive gaps.
- Hourly application-consistent recovery checkpoint: DB transaction positions,
  tenant/ACL/identity versions, mailbox manifest and journal watermark. Verify a common
  recoverable cut rather than independently restoring arbitrary timestamps.
- Daily full recovery set and hourly increments; daily AU cross-account copy. Retain
  hourly sets 7 days, daily sets 35 days, monthly sets 12 months, subject to approved
  retention/hold policy and cost review. Replicas are additional, not retention copies.
- S3 Object Lock compliance retention and AWS Backup Vault Lock in separate backup
  accounts; production writers cannot shorten retention or delete recovery points.
  Destination keys and recovery roles must work without Sydney or the production
  account. Stage/test lock settings before irreversible production retention.
- Back up OX DB/config, mailbox content/ACL/Sieve, control DB/outbox, Authentik DB and
  signing material, DNS, Postfix routing/queue journal, DKIM and certificate recovery
  material, manifests and IaC state. Search indexes are rebuildable.
- Weekly mailbox restore; monthly tenant restore; quarterly regional failover and
  full clean-account restore. Record actual bytes, throughput, RPO/RTO and failures.

[S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)
protects versions, not just current object names. Keep version IDs and hashes in
restore manifests. Key loss can still make immutable backups unreadable; key policy,
deletion protection and isolated recovery must be tested independently.

## Failover runbook

Roles: incident commander declares event; second authorised operator approves writer
promotion; security operator verifies audit and access state. Commands are executed
from approved AU administration infrastructure with recorded source/config revision.
Deployment-specific commands are generated and rehearsed in the recovery milestone;
this design runbook is not an executable live-cluster procedure.

1. **Detect and classify.** Regional probes check HTTPS login, IMAPS, SMTP acceptance,
   DB read/write canary, queue age and replication watermark. Correlate at least two
   independent probes. Alarm opens incident automatically; detection alone never
   promotes a writable replica. Identify outage versus partition versus compromise.
2. **Freeze and record.** Stop administrative/provisioning changes and outbound workers
   that cannot establish policy freshness. Record UTC time, last good transaction and
   journal watermarks. Keep surviving-region inbound queuing for known recipients.
3. **Fence Sydney.** Obtain positive evidence that old writers/delivery agents cannot
   mutate state, using pre-provisioned fencing and epoch controls. DNS changes alone
   are not fencing. If proof is unavailable, remain read-only/queued; do not risk two
   writers. Two regions alone cannot magically establish consensus during partition.
4. **Check Melbourne readiness.** Independent KMS decrypt, local secrets/images, DB
   replicas, identities, certificate validity, capacity and immutable backup access.
   If recovery watermarks exceed objectives, record degraded RPO before promotion.
5. **Promote in dependency order.** Control/identity DB, OX DB, mailbox filesystem and
   owner map, identity service, Dovecot/LMTP, OX, submission and outbound. Allocate a
   new writer epoch. Reapply latest account suspensions and credential revocations.
6. **Replay/reconcile.** Restore missing accepted messages from journal by server-owned
   delivery ID and per-recipient ledger. Avoid duplicate local delivery; reconcile
   ambiguous external sends instead of silently resending everything. Verify tenant
   A/B content and ACLs, mail counts/hashes and outbox state.
7. **Prove service.** Synthetic accounts authenticate, send/receive, search, use shared
   mailbox and calendar. During SES outage, prove accepted outbound messages remain
   held and show degraded delivery. After recovery, verify policy/quotas and controlled
   Sydney SES drain per the [outage queue runbook](queue-and-events.md). No alternate relay.
8. **Expose.** Update mail/imap/submission DNS through approved AU DNS control; keep
   both region-specific MX records accurate. Account for cached DNS and long-lived
   connections; stale endpoints must reject writes. Watch retry traffic and duplicates.
9. **Observe and close.** Record measured recovery time/loss, queue drainage, identity
   failures and security events. Notify through pre-approved incident channel independent
   of the affected mail platform. Archive signed/redacted evidence appropriately.

## Failback and restore

Failback is a planned migration: preserve Melbourne as sole writer, rebuild Sydney
from trusted artifacts, reverse/recreate replication and wait for full sync. Fence
Melbourne writes, obtain a consistent checkpoint, promote Sydney with a new epoch,
prove tenant and message integrity, then route clients. Never just restore the old
Sydney disks and turn them on. Keep prior recovery sets until verification completes.

Corruption restore: isolate compromised systems; select known-good recovery manifest;
restore keys/identities, DBs and mail to an isolated AU network with external delivery
disabled; verify hashes, ACLs, tenant boundaries and journal replay; scan artifacts;
rotate compromised credentials; obtain operational approval to resume delivery.
Exercise unavailable-key, damaged-backup and backup-account-only scenarios.

## Dashboards and alerts

Regional dashboards: queue depth/oldest age, delivery p50/p95, bounce/complaint rate,
SES reputation/quota headroom, OX/Dovecot login and protocol health, storage/IOPS,
auth failures, sender bursts, replication watermark, oldest unarchived log, last
restorable backup, certificate/DNS status and region readiness. Tenant views filter
at source. Proposed initial alerts: queue age >5 minutes, storage >80%, replication
>5/15 minutes warning/page, backup checkpoint >2 hours, collector delay >5 minutes,
any foreign endpoint attempt, failed fencing or restore test. Tune rate/reputation
alerts against current SES account limits and agreed tenant baselines, not guessed
universal thresholds. Test alarm delivery from each region during isolation.
