# Implementation milestones and acceptance

Parent epic: **MAIL-EPIC — Australian multi-region Blak Mail**. GitHub issue links
are recorded in `github-issues.json` when created. Issues use the IDs below for
stable dependency/evidence references. Each issue needs a responsible delivery owner;
the initial proposal assigns functional ownership, not invented personnel.

| ID / milestone | Owner | Depends on | Exit criteria |
| --- | --- | --- | --- |
| MAIL-01: architecture/qualification | Platform + security | None | Twenty deliverables reviewed; global boundary, account targets, supported OX/storage, outage queue contract and SIEM resolved |
| MAIL-02: regional security/IaC | Platform | 01 | AU-only plans, two AZs/region, independent keys, private endpoints, immutable backup accounts; no foreign resources or content in state artifacts |
| MAIL-03: tenant control plane | Identity + backend | 01 | Verified membership; RLS/native boundaries; domain lifecycle/DNS checks; audit/outbox; API contract and adversarial tests |
| MAIL-04: OX/Dovecot identity | Mail + identity | 02,03 | Native OIDC, supported mailbox backend, quota/Sieve/shared ACL/FTS/mobile tests; revocation; no global master mailbox credential |
| MAIL-05: Postfix/SES/outage queues | Mail + security | 02,03 | No open relay; sender policy, scope/rate limits, DNS auth, SES feedback/suppression, private transport, persistent outage HOLD and controlled SES recovery drain |
| MAIL-06: portal administration | Product + backend | 03,04,05 | Tenant-scoped domain/mailbox/SMTP/traces/audit surfaces; accessibility and real browser proof; no body/secret leaks |
| MAIL-07: backup/DR/operations | SRE + security | 02,04,05 | Durable ACK gate, restore and region-loss drill, fencing, measured RPO/RTO, SIEM receipts and independent alert paths |
| MAIL-08: assurance/pilot/release | Security + service owner | 01–07 | Control evidence, penetration/tenant tests, capacity, migration/rollback rehearsal, operating budget/support, source/CI/live proof |

## Incremental implementation scope

First increment establishes source-level region/routing guards, tenant-owned domain
data/RLS, bounded DNS verification and immutable AU storage scaffolding. No backend
is presented as ready merely because a module or UI label exists. Unavailable external
systems fail closed rather than returning success. Later increments connect real
providers and expose administration only after their security prerequisites pass.

Infrastructure layout:

```text
deploy/mail/
  aws/syd/                  # independently applied regional entry point
  aws/mel/                  # DR entry point; no SES resource by default
  security/storage/         # regional key and immutable evidence/backup storage
  security/{logging,secrets,monitoring}/  # subsequent qualified modules
  mail/{ox,dovecot,postfix}/               # supported pinned deployment modules
  dr/{replication,failover,recovery-tests}/
```

Do not create empty modules and describe them as implemented. One environment/state
per region/account; backend configuration and plans remain in AU. CI validates source
and synthetic fixtures without production credentials; deployment requires reviewed
plan and explicit target identity. Never reuse homelab manifests for AWS mail.

## Acceptance test catalogue

| ID | Scenario | Required result |
| --- | --- | --- |
| AU-01 | Foreign region/endpoint, implicit AWS region, global SES route | Rejected before network or resource creation |
| AU-02 | Lose Sydney keys, secrets, registry, DNS control, IdP | Melbourne restores/authenticates with independent local dependencies |
| TEN-01 | A requests B domain/mailbox/alias/credential/delegate | Generic not-found/denied; no enumeration, no mutation |
| TEN-02 | Omitted SQL tenant filter, absent scope, connection reuse | RLS denies/leaks no rows; transaction cleanup tested |
| TEN-03 | Forged tenant claim/header, revoked membership, background job | Current membership governs; server-owned scope only |
| TEN-04 | Cross-tenant mailbox LIST/FETCH/SEARCH/FTS/shared folder | Denied in native OX/Dovecot and storage, not merely portal |
| DNS-01 | Wrong MX, duplicate SPF/DMARC, TXT chunking, stale token, DNS failure | Accurate failed/unknown status; no false verified |
| DNS-02 | MTA-STS SSRF/rebinding/redirect/oversize/TLS failure | Fetch blocked; no metadata/private-network request |
| SMTP-01 | Anonymous external relay, spoofed envelope/header sender | Rejected at both MX and submission endpoints |
| SMTP-02 | Revoked service credential, recipient/byte/rate flood | Enforced scopes/limits; other tenants retain service |
| SMTP-03 | SES throttle/timeout/outage, duplicate event | Durable queue/retry; no lost accepted bytes; trace reconciles ambiguity |
| AUTH-01 | Existing Blak session enters OX | No extra login for valid authorised session; mailbox identity correct |
| AUTH-02 | Disable user / revoke app password / revoke session | All relevant protocols reject within measured policy bound |
| MAIL-01 | Calendar/contact/mobile/Sieve/quota/search/shared mailbox | Full real-provider workflow succeeds with tenant isolation |
| DR-01 | Sydney power/network loss immediately after SMTP ACK | Every accepted message recoverable in Melbourne; metadata loss measured |
| DR-02 | Partition with both regions alive, stale primary returns | No double writer; stale epoch cannot deliver or mutate |
| DR-03 | Sydney SES down, Melbourne takeover | Accepted messages remain held beyond ordinary expiry and restart; controlled Sydney SES drain after recovery; no alternate delivery |
| BAK-01 | Delete/tamper backup as tenant/production admin | Denied; destination-account-only restore succeeds |
| BAK-02 | Restore old checkpoint after credential revocation | Content restored without resurrecting revoked access |
| AUD-01 | Collector/SIEM outage, log injection, privileged change | Bounded durable buffering; alerts; no silent audit loss |
| UX-01 | Keyboard/screen reader/mobile admin flows | Rendered browser evidence; axe serious/critical and contrast issues resolved |
| SUP-01 | Untrusted image/digest, vulnerable release, rollback | Deployment gate rejects; approved update and rollback preserve data |

Security tests use synthetic tenants and `.invalid`/`.test` domains. AWS/SMTP drills
run only in approved staging accounts/domains. External mail tests require controlled
recipients; no unsolicited real-user mail or existing DNS changes during development.

## Production cutover

Pilot on delegated test domain, measure delivery/auth/restore under failure, then
migrate a small approved cohort. Inventory aliases/rules/calendars/contacts, freeze
changes, copy and reconcile data, lower TTL in advance, switch MX only after proof,
retain old service for rollback and retry windows, then remove old credentials.
Do not treat a successful webmail login as mail migration completion.
