# Outage queues and durable event delivery

Owner decision, 2026-09-29: queue outbound email until Sydney SES returns. No direct delivery from Melbourne, alternate relay or foreign SES fallback. Postfix remains the delivery queue; pub/sub carries operational events, not a second copy of email content. This is the implementation contract for MAIL-05/MAIL-07, not a deployed queue controller or broker.

## What already exists

Postfix supplies persistent queues, retry scheduling and temporary delivery failure handling. Its normal `maximal_queue_lifetime` defaults to five days; **zero means try once, not retain forever**. Ordinary retries alone therefore do not meet “until SES is back.” See [Postfix parameters](https://www.postfix.org/postconf.5.html).

The checked-in homelab NATS Deployment (`deploy/k3s/micro/10-data-events.yaml`) has `-js`, one replica and no persistent volume or volume mount. JetStream is enabled, but that manifest does not establish durable restart survival, HA, tenant subject permissions or recovery. No live broker inventory was performed. Do not reuse it as the production mail durability boundary.

The existing mail foundation has a tenant-scoped PostgreSQL outbox table, but no publisher or consumers. SNS/SQS was already proposed for SES feedback. Extend that regional event path rather than introduce another production broker.

## Mail bytes: Postfix

1. Authenticate and authorise tenant/sender; enforce quotas and available queue space before accepting. A final SMTP 250 means the system owns durable delivery responsibility, not that the recipient received mail. IMAP sent-folder copies are separate from the delivery queue.
2. Keep each regional queue on encrypted persistent storage with exclusive writer ownership, recovery procedures and backups. Queue files do not live on container writable layers. Retaining a file locally does not itself meet the separate zero-loss regional durability gate.
3. For short provider errors, retain and back off. Distinguish temporary infrastructure/authentication/quota problems from permanent message/recipient rejection. Never convert an SES outage into a permanent delivery failure.
4. A local outage controller latches outage state durably and moves affected outbound messages to Postfix **HOLD** well before normal expiry. New outage submissions enter that hold path too. Controller operation must not depend on SNS/SQS or Sydney being available. Separate outbound queues/policies prevent an outage from holding local mailbox delivery.
5. Track hold reason, tenant, originating service, logical delivery ID, region/instance and current queue ID. Outage holds must remain distinct from security, legal or operator holds. Alert if the controller is stale or any affected message approaches expiry outside HOLD; stop accepting new outbound mail if the required protection is unavailable. Startup must restore hold policy before enabling submission.
6. Held messages do not expire while held. No automatic age-based deletion, silent discard or outage-generated bounce. Capacity remains finite: reserve disk space, alert at 75%/85%, and temporarily reject new submissions before exhausting the reserve. Size for at least five days of peak traffic initially and expand before needed; that budget is not a retention deadline. Do not promise unlimited acceptance.
7. On SES recovery, verify production access, credentials, identity, quotas and suppression/revocation freshness. Resume with a small controlled batch and ramp below both per-second and daily quotas, retaining headroom for new mail. Do not flush the entire queue at once.
8. For old outage-held messages, use the version-tested requeue path where needed to reset the ordinary queue lifetime; merely releasing old HOLD entries can cause immediate expiry. Preserve original acceptance time/logical ID and record changed queue IDs. Revalidate sender/suppression policy; do not re-run business side effects or release unrelated holds. Ambiguous previous SES acceptance remains a duplicate-delivery risk requiring attempt reconciliation.

The [Postfix queue maintenance manual](https://www.postfix.org/postsuper.1.html) documents hold/release/requeue behaviour. Production automation must scope every operation to the dedicated instance and verified current queue ID, account for concurrent deliveries/queue-ID reuse, and never use a blanket `ALL` release. No such controller is implemented in this increment.

States shown to users: queued, waiting for mail service, sending, accepted by provider, delivered, delivery failed. Provider acceptance is not recipient delivery. Outbound delivery RTO during the outage is SES recovery time plus backlog drain; mailbox availability and inbound acceptance have separate objectives.

## Metadata events: transactional outbox, SNS and SQS

Each AU region gets its own KMS-encrypted SNS topic and durable SQS subscription per consumer: provisioning, trace projection, audit/SIEM and notifications. Each subscription needs its own queue so consumers do not steal each other's events. Queues and topics remain regional; never bridge to a foreign region. Melbourne's local events must work without Sydney. SES feedback still originates in Sydney and can be delayed during that region's outage.

The [SNS/SQS fanout pattern](https://docs.aws.amazon.com/sns/latest/dg/sns-sqs-as-subscriber.html) decouples subscribers while retaining events for unavailable consumers. Use standard queues with application idempotency and ordering checks, not an exactly-once claim. [SQS can redeliver messages](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html).

Required event envelope: version, immutable event ID, tenant ID, aggregate ID/generation, event type, occurrence time, source region and correlation ID. Only opaque references and allowlisted status/reason codes belong in the bus; no body, attachment, subject, password or token. Consumer fetches authorised detail through tenant-scoped storage if needed. Queue/SNS policies restrict source ARN/account and worker roles. Broker filters do not replace tenant authorisation.

- Commit desired-state changes and an immutable outbox event in one database transaction. Publisher leases a bounded batch; mark published only after broker acknowledgement. A crash after publication but before marking produces a duplicate, never silent loss. Outbox archival must retain replayable metadata beyond broker retention.
- Consumers persist `(tenant_id, consumer_id, event_id)` receipts and local effects atomically, then delete the SQS message. Crash before commit retries; crash after commit is a no-op on redelivery. External effects use a stable idempotency key plus reconciliation because database and remote service cannot commit atomically.
- Use bounded retries with jitter, visibility-timeout extension for long jobs and dead-letter queues. Alarm on queue age, publisher lag, consumer lag and DLQ depth. Classify permanent invalid events; prevent endless poison-event loops. Redrive preserves event ID and tenant context and records the operator/reason.
- Handle out-of-order events with aggregate generations: ignore already-applied versions, detect gaps and reconcile current authoritative state before applying dependent changes. Do not use a notification event as sole authority to grant mailbox access.
- [SQS retention is finite (up to 14 days)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html). Preserve unprocessed events in an AU outbox/archive until each required consumer has a receipt or audited disposition. Broker expiry is not an archival policy. Test replay after broker retention has elapsed.
- Region promotion requires the same fencing/authority generation as mail provisioning. Paused old-region publishers/consumers must not replay stale grants or duplicate provisioning after failback. Regional SNS/SQS does not automatically replicate; rebuild projections from approved AU outbox/archive recovery points.

Pub/sub is not in the SMTP acceptance path. Broker failure must not lose already accepted email or cause duplicate SMTP submissions. SMTP queue state remains authoritative for delivery attempts. PostgreSQL outbox/schema needs publication leases, receipts and replay storage before this design is operational; these remain MAIL-05/MAIL-07 work.

## Required failure tests

- Block SES, submit a synthetic corpus, restart gateway, advance beyond ordinary queue expiry: every accepted message remains held; no foreign/direct egress.
- Kill hold controller; prove startup/admission fail closed and held data survives. Inject storage pressure; new submissions receive temporary failure and accepted messages remain intact.
- Restore SES with tight quotas; controlled drain eventually reaches test inboxes. Exercise expired credentials, revoked sender, suppression updates, ambiguous provider responses and crash during hold-to-requeue transition.
- Crash publisher before/after SNS acknowledgement and consumer before/after DB commit; effects occur once despite duplicate events. Exercise visibility expiry, retries, poison DLQ, out-of-order generations, cross-tenant forged envelopes and replay beyond SQS retention.

These tests are release gates. Local intent-policy tests enforce the selected route/hold declarations, but do not prove the Postfix or SNS/SQS runtime behaviours above.
