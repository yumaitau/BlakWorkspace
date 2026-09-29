# Blak Workspace Mail — architecture and delivery record

Status: design and incremental implementation; **not a deployed mail service**.
Reviewed 2026-09-28 against repository `dc48d0e` and linked vendor documentation.
No IRAP assessment, PROTECTED authorisation, or certification is claimed.

The requested product owns identity, tenant policy, administration and user experience;
OX, Dovecot, Postfix and SES provide the underlying mail functions. Production runtime
and customer data are restricted to Sydney (`ap-southeast-2`) and Melbourne
(`ap-southeast-4`). The existing Proton launcher is not this product and is not migrated
by this work. This proposal supersedes the earlier optional-mail scope only for the
new Australian mail deployment, not existing homelab installations.

## Deliverable index

| Requested deliverable | Record |
| --- | --- |
| 1 Current state | [Current state](current-state.md) |
| 2 Proposed architecture; 5 data flows | [Architecture](architecture.md) |
| 3 AWS regional availability | [Availability matrix](availability.md) |
| 4 Threat model; 6 residency | [Security and residency](security.md) |
| 7 Multi-region; 8 RPO/RTO; 14 backups; 15 DR runbook | [Recovery](recovery.md) |
| 9 SES; 10 OX/Dovecot/Postfix; 11 identity | [Integration contracts](integrations.md), [outage queues and events](queue-and-events.md) |
| 12 Tenant isolation; 13 DNS/mail security | [Control plane](control-plane.md) |
| 16 ISM mapping | [Control evidence register](ism-evidence.md) |
| 17 ADRs | [Decisions](decisions.md) |
| 18 Milestones; 19 GitHub epics/issues; 20 acceptance | [Delivery plan](delivery.md) |

## Release blockers, not inferred approvals

1. Identify production/staging AWS accounts, Australian operators, budget, DNS owner
   and existing SIEM ingestion endpoint. The laptop default AWS profile is not an
   authorised production target just because credentials exist.
2. Accept or redesign the documented global AWS control-plane boundary. IAM's
   commercial control plane is in the US; this cannot be fixed with a region flag.
   Public GitHub stores source and synthetic evidence only.
3. Confirm supported OX/Dovecot versions, artifact access, licences, support and
   mailbox storage topology. Do not invent commercial entitlements or pin old
   Dovecot merely to retain its removed replication plugin.
4. Per owner decision on 2026-09-29, both regions retain outbound mail until Sydney
   SES recovers. No alternate relay or direct delivery. Prove prolonged-outage HOLD,
   restart survival, capacity backpressure and controlled replay. Outbound Internet
   delivery remains unavailable during an SES outage; see [outage queues](queue-and-events.md).
5. Demonstrate durable acceptance, fencing, mailbox recovery, tenant isolation and
   capacity in two actual regions. Proposed targets are not measured SLOs.

Architecture precedes implementation. Each milestone records tests and limitations;
passing unit tests does not satisfy infrastructure or production acceptance gates.

See [implementation status and verification](implementation-status.md) for exactly
which parts exist and which remain planned.

## Evidence handling

Public: design, tests, source revisions, synthetic domains, redacted test summaries.
Private Australian evidence store: account inventories, deployed plans, real domain
records, restore manifests, incident records and access logs. Never upload customer
addresses, mail, keys, Terraform state or raw AWS inventories to GitHub/CI artifacts.
Every private evidence manifest records UTC time, actor, source SHA, config digest,
environment, test command, result, artifact hash, retention and reviewer.
