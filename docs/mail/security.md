# Threat model and data residency

Assets: message bodies/attachments, addresses/headers, credentials, signing keys,
calendar/contacts, mailbox ACLs, domain ownership, queues, backups and evidence.
Actors: tenants/users, tenant administrators, service identities, platform operators,
backup/security operators, external senders, compromised suppliers and AWS operators.
Trust boundaries: browser/API, IdP/membership, tenant data, SMTP ingress/submission,
application/storage, region, backup account and external delivery.

| Threat | Required mitigation | Acceptance evidence |
| --- | --- | --- |
| Tenant ID substitution / IDOR | Verified membership; tenant-scoped queries, composite FKs, forced RLS; deny missing context | A/B tests for list/get/write/search/export and background jobs |
| OX context / shared mailbox leakage | Server-owned context mapping, mailbox UUID paths, explicit ACL delegation | Native OX/IMAP adversarial tests, not API-only tests |
| Open relay / sender impersonation | Separate ingress/submission, auth, sender ownership, recipient maps; no broad trusted networks | Unauthenticated external-to-external and spoofed sender transcripts rejected |
| Stolen tokens / SMTP credentials | Phishing-resistant MFA, scoped app passwords, hash-only storage, expiry/revocation, rate limits | Revoked credentials fail all protocols within defined bound |
| DNS takeover / SSRF | Random tenant-bound ownership token, TXT proof, exact expected records; fixed MTA-STS path, public-IP-only HTTPS | Rebinding, redirect, private IP, timeout, duplicate TXT tests |
| Mail phishing / malicious files | Inbound/outbound scanner policy, authentication results, attachment limits; no foreign file upload | Controlled synthetic specimens; scanner outage handling |
| Queue exhaustion / spam abuse | Per-tenant/service limits, connection caps, byte quotas, queue pressure alerts | One noisy tenant cannot exhaust another tenant's reserved capacity |
| Ransomware / backup tampering | Separate backup account, immutable retention, independent keys and restore role | Denied deletion, lost-primary-account restore rehearsal |
| Split brain / regional partition | Single writer epoch, positive fencing, automatic detection but controlled promotion | Partition and stale-primary restart tests |
| Cross-region leakage | Region allowlist, endpoint/network policy, service-specific deny rules, resource inventory | Foreign-region plan and runtime requests rejected |
| Log/feedback injection | Structured allowlisted fields, bounded lengths, no bodies/subjects, authorised ingestion | Forged/replayed SES events rejected; tenant filter retained |
| Supply-chain compromise | Digests/signatures, SBOM, private AU registry copies, vulnerability review | Artifact provenance and patch/rollback drill |
| Privileged mailbox access | Separate privileged identities, time-limited approved access, immutable event | Break-glass access independently reviewed |

## Residency classification

| Data/path | Allowed handling | Constraint |
| --- | --- | --- |
| Mail, contacts, calendars, identity DB, sessions | Only Sydney/Melbourne storage and processing | No production snapshots copied to laptops, GitHub or foreign services |
| Queue, FTS, crash dumps, swap, caches | Same restrictions as content | Disable core dumps containing secrets; encrypted disks |
| Logs, message traces, bounce/complaint payloads | Regional encrypted stores and verified AU SIEM | Feedback may contain addresses/headers; sanitise before broader access |
| Customer secrets / encryption keys | Independent regional Secrets Manager/KMS; explicit AU copies only | No multi-region KMS keys; preserve regional decryptability during DR |
| Backups / IaC state | Separate AU accounts/buckets/keys; state is sensitive | No SaaS Terraform state or raw CI artifacts |
| IAM / Organizations / billing / support | Global control metadata; opaque resource IDs only | Cannot assert Australia-only global control plane |
| Public DNS and certificate transparency | Public domain/host names and verification values only | Public distribution is inherent; no private tenant data in record names |
| External recipient delivery | Content leaves platform for recipient-selected system | Requires an explicit information-release policy; cannot promise foreign recipients store mail in Australia |

[AWS documents](https://docs.aws.amazon.com/IAM/latest/UserGuide/disaster-recovery-resiliency.html)
that commercial IAM configuration is controlled in US East and propagated to regional
data planes. Regional STS is required, especially in Melbourne. Pre-create roles so
DR does not need the global IAM control plane. No customer names, email addresses,
mailbox data or secret values in IAM names/tags. An absolute prohibition on **all**
foreign control metadata cannot be satisfied by ordinary commercial AWS: obtain
explicit boundary acceptance before production, otherwise change infrastructure.

Route 53 public DNS is global; public query logs have service-specific destinations.
Default design uses AU authoritative DNS and regional health probes instead of
Route 53 public query logging/foreign health probes. Public delegation still exists
globally. [AWS cautions against sensitive data in DNS tags/names](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/data-protection.html).
Do not use CloudFront, Global Accelerator, SES global endpoints or global secret
replication. CloudTrail global service events need an explicit handling review;
regional workload trails alone do not audit all IAM changes.

AWS regional selection does not prove support-personnel location, legal sovereignty,
or network transit geography. Contract review must cover subprocessors, service
telemetry/abuse review, support access, inter-region transit and incident handling.
SES acceptance for PROTECTED use is an assessment question, not a property inherited
from an AWS assessment. Ordinary Internet SMTP is not end-to-end encryption; a
future classified profile requires approved destinations, cryptography and release
controls. Default commercial profile must never be marketed as that profile.

## Evidence and incident controls

Require WebAuthn/FIDO2 for administrators, dedicated privileged accounts, regional
break-glass credentials under two-person custody and recovery independent of mail.
Collect authentication, provisioning, delegation, forwarding, credential, retention,
privileged access and failover events. Store UTC time, actor, tenant, action, target,
result, correlation ID and policy/config revision; exclude bodies and tokens.
Reject privileged changes if durable audit/outbox commit fails.

Existing portal JSONL and Beszel do not establish a SIEM integration. Required adapter:
regional collector with mTLS to the supplied AU SIEM, disk buffering, acknowledgement,
replay protection and immutable S3 archival. Tenant admins see only their own events;
security operators use a separate audited investigation role. Retention defaults
require customer policy approval and must not defeat legal hold or minimisation.
