# ISM control evidence register

Baseline: ASD ISM online guidelines dated 3 September 2026, consulted 28 September
2026. This is an initial applicability mapping, not the complete system security plan,
an assessor opinion or a statement of compliance. Control IDs and wording must be
revalidated when the baseline changes. All implementation rows below are proposed
unless a linked evidence record explicitly records a passing deployed test.

| Requirement | Relevant ISM controls | Implementation/configuration | Test and evidence |
| --- | --- | --- | --- |
| Phishing-resistant authentication | 1872, 1873 | Authentik WebAuthn policy, recent privileged auth | OIDC/browser MFA and recovery tests; exported policy digest |
| Least privilege / tenant access | 1508, 1852 | Membership authority, mail roles, scoped DB/runtime identities, RLS | A/B API+SQL+IMAP isolation and denied privilege escalation |
| Separate privileged identities | 0445, 1263 | Dedicated operator accounts, separate app administration roles | Role inventory and prohibited-session tests |
| Privileged audit | 1509, 1650 | Regional immutable journal, tenant/actor IDs, durable outbox | Mutation failure when audit commit fails; role-change event receipt |
| Controlled administration | 0042, 1211, 1380, 1385 | Reviewed IaC, separate administration environment/network | Change record, access-path scan, approved plan hashes |
| Patch and supply-chain process | 1493, 1643, 1143, 1876 | SBOM/version inventory, signed images, vulnerability SLA | Inventory diff, scanner result and staged rollback evidence |
| Recoverable backups | 1511, 1810, 1811, 1548 | Common recovery checkpoints, separate AU immutable stores | Restore manifest and measured full/tenant recovery |
| Backup access restrictions | 1812, 1814 | Backup-only roles and account, retention deny policy | Tenant/operator deletion denied; isolated restore succeeds |
| Central logging/time | 1405, 0988 | Regional collector, AU SIEM, UTC synchronisation | Collector loss/replay tests; timestamp drift evidence |
| Encryption/key lifecycle | 0507, 1080, 1091 | Independent regional KMS keys, rotation/recovery procedures | Wrong-region decrypt denied; destination-only restore; rotation test |
| PROTECTED crypto suitability | 0457, 0465 | Assessor-reviewed cryptographic implementation/transport | Vendor evidence and assessed applicability; TLS/KMS alone is not proof |
| Cryptographic incident response | 0142 | Key-compromise procedure and restricted evidence handling | Tabletop, emergency rotation, recipient/impact accounting |

Sources: [System access](https://www.cyber.gov.au/business-government/asds-cyber-security-frameworks/ism/cyber-security-guidelines/guidelines-for-system-access),
[System management](https://www.cyber.gov.au/business-government/asds-cyber-security-frameworks/ism/cyber-security-guidelines/guidelines-for-system-management),
[Security assurance](https://www.cyber.gov.au/business-government/asds-cyber-security-frameworks/ism/cyber-security-guidelines/guidelines-for-security-assurance),
[Cryptography](https://www.cyber.gov.au/business-government/asds-cyber-security-frameworks/ism/cyber-security-guidelines/guidelines-for-cryptography).

Regional failover, explicit AU data boundaries, DNS security, supply-chain provenance
and tenant isolation also implement product requirements. Do not invent a single ISM
ID for an entire architecture: complete detailed control applicability, cloud shared
responsibility and residual-risk mapping with a qualified assessor before PROTECTED
use. Include incident response, system authorisation, protective markings, personnel,
physical facilities, supplier assurance and release policy in that assessment.

Evidence chain for each change:

`requirement ID -> control/applicability -> implementation revision -> deployed config
digest -> automated test -> signed evidence manifest -> reviewer/disposition`.

Evidence status values: planned, source-tested, staging-verified, production-verified,
exception-approved, failed. Source-tested never upgrades automatically to verified.
An approved exception records owner, scope, expiry, compensating control and review.
