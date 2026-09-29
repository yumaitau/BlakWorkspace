# Mail architecture decision records

Mail ADRs use the `MAIL-ADR` namespace to avoid renumbering existing suite ADRs.
Status is proposed unless explicitly stated. Product requirement acceptance does
not approve operational exceptions, paid licences or unverified security claims.

## MAIL-ADR-001 — Australian runtime and explicit global boundary

**Decision:** content, logs, backups, keys and runtime processing only in Sydney and
Melbourne. Use independent regional keys, stores and endpoints. No foreign fallback.
**Reason:** residency must cover ancillary data, not only mailbox disks.
**Alternatives:** unrestricted managed SaaS rejected for this deployment; global
multi-region services rejected unless their exact scope is verified and constrained.
**Consequence:** IAM/global metadata and external delivery are explicit policy
boundaries. Absolute Australia-only control plane is incompatible with commercial
AWS IAM. **Gate:** customer boundary acceptance and supplier assessment.

## MAIL-ADR-002 — Queue in Australia until Sydney SES recovers

**Evidence:** [SES endpoint table](https://docs.aws.amazon.com/general/latest/gr/ses.html)
lists Sydney but not Melbourne on 2026-09-28.
**Decision (owner, 2026-09-29):** both regions use Sydney SES and retain outbound mail
in encrypted Australian Postfix queues during its outage. This supersedes the earlier
independent-relay proposal. No direct-MX delivery, alternate relay or foreign fallback.
**Recovery:** drain through Sydney SES only after health, credentials, sender policy,
suppression and quota checks; rate-limit batches and reconcile uncertain attempts.
**Consequence:** outbound Internet delivery is unavailable until SES recovers plus
backlog drain. Mailbox and inbound recovery objectives remain separate.
**Gate:** prolonged-outage HOLD controller, restart survival, backpressure and tested
hold-to-requeue recovery; ordinary retry expiry does not meet indefinite retention.
See [outage queues and events](queue-and-events.md).

## MAIL-ADR-003 — One writable mailbox region, positively fenced

**Decision:** multi-AZ primary, warm independent regional standby, automatic detection,
controlled promotion. No bidirectional writable mailboxes across partitioned regions.
**Reason:** prevent split-brain and corrupted mailbox/groupware state.
**Alternative:** active-active requires a supported consistency model and measured
conflict handling; not assumed from a two-way arrow.
**Gate:** fencing proof, identity/control DB failover and recovery drill.

## MAIL-ADR-004 — Replication is not backup or acknowledged-message durability

**Decision:** asynchronous regional storage replication plus independent immutable
recovery sets; zero-loss acceptance requires a qualified durable cross-region journal.
**Evidence:** CE 2.4 removed Dovecot replicator; EFS replication is asynchronous.
**Alternatives:** supported Dovecot Pro deployment subject to licensing; end-of-support
software or hand-written mailbox replication rejected.
**Consequence:** 15-minute metadata target is separate from message-byte durability.
Lossless arbitrary IMAP mutations is not promised by this design. If required, select
a supported synchronous storage design and measure latency before committing RPO 0.
**Gate:** storage support and durable acceptance demonstration; no dishonest RPO claim.

## MAIL-ADR-005 — Tenant authority belongs to Blak

**Decision:** verified membership, scoped API/database/runtime identity, OX context,
Dovecot namespace/ACL and tenant-owned events. Application roles alone are insufficient.
**Alternative:** infer tenancy from email suffix or workspace admin flag rejected.
**Consequence:** initial control-plane RLS protects omitted filters, not a compromised
shared backend; higher-assurance cells isolate databases/credentials/storage.
**Gate:** native protocol and data-layer isolation tests plus privileged-access audit.

## MAIL-ADR-006 — Stable SMTP abstraction, no SES secrets in apps

**Decision:** `smtp.blakworkspace.au` is the only application transport contract.
Postfix owns durable queues and provider routing. Initial SES SMTP transport uses
Secrets Manager; workload roles retrieve the delivery credential. Apps get scoped
Blak SMTP credentials, never provider credentials.
**Alternative:** qualified role-based API adapter can remove long-lived provider
credentials, but needs queue/retry/duplicate semantics tested first. Do not falsely
claim SES SMTP supports temporary IAM role credentials.
**Gate:** residency review for IAM-derived credential metadata and rotation test.

## MAIL-ADR-007 — Source evidence is not production acceptance

**Decision:** complete design/backlog first, then small tested increments, staging
qualification, audited deployment and live proof. No automatic Terraform/Helm apply
in CI. Existing Proton launcher remains until migration is delivered and selected.
**Consequence:** production stays blocked by unresolved runtime/licensing/account
requirements, while isolated source work can proceed without disturbing existing apps.
