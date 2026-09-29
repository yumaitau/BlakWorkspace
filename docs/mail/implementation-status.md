# Implementation evidence — consolidated foundation

Date: 2026-09-29. Scope: PR #202 architecture and source foundations, not deployed mail.
Consolidates `codex/au-mail-platform` with the later `codex/au-mail-foundation` policy,
tenant metadata and owner-approved queue-until-SES decision. Existing milestone
issues #193–#201 remain open; no duplicate backlog was created.

| Capability | Status | Evidence / limit |
| --- | --- | --- |
| Twenty requested design deliverables | Documented | README index; seven mail ADRs; epic #193 and issues #194–#201 |
| Regional service discovery | Public documentation checked previously | Availability matrix and source hashes; account-specific feature probes still required |
| Region/transport safety | Source-tested | Both AU regions HOLD during SES outage; recovery uses only Sydney SES SMTP |
| Deployment intent policy | Source-tested | Strict regional resources, SMTP port/STARTTLS, HOLD and ten evidence gates; no live inventory or signature verification |
| Tenant permission contract | Source-tested | Issuer/subject/current-membership binding; no workspace-admin bypass |
| Domain DNS checks | Source-tested | Ownership/MX/SPF/DKIM/DMARC/MTA-STS TXT/TLS-RPT; bounded lookups and unknown failures |
| Domain activation / MTA-STS HTTPS | Not implemented | Verifier always reports activation pending; no arbitrary HTTP fetcher |
| Tenant metadata schema | PostgreSQL-tested | Eleven FORCE RLS tables, two-tenant fixtures, composite FKs, missing-context denial, pool reset, protected verification/hash reads and append-only ingest |
| AU immutable archive module | Terraform-validated / mocked tests | Independent regional roots and KMS/private Object Lock storage; not applied |
| Tenant directory adapter / control API | Not implemented | No shared mail tenant contract or unsafe endpoint exposed |
| Native OX/Dovecot/Postfix/SES integration | Not implemented | Supported artifacts, storage, provider/account and protocol proof outstanding |
| Outage HOLD / durable event workers | Design only | Local admission/hold controller, SNS/SQS fanout, receipts, replay and controlled drain remain MAIL-05/MAIL-07 gates |
| Mail administration UI | Not implemented | Existing Proton launcher unchanged |
| Live backup/DR/observability/SIEM | Not implemented | No RPO/RTO measurement claimed |

Current local verification:

- Manifest validation passed.
- Python suite: 370 passed out of 371. The existing upstream-link network test failed
  with local `CERTIFICATE_VERIFY_FAILED`; adding public roots to the broker CA bundle
  did not resolve it. Homebrew OpenSSL 3 was selected via `BLAK_OPENSSL`. No source
  workaround or disabled TLS verification was introduced. Fresh PR CI is required.
- All 14 mail deployment-policy tests passed within that suite. Synthetic production
  example correctly exits 1 with all ten readiness gates unresolved.
- Portal regression suite passed with one existing skipped test, including all eight
  mail foundation scenarios.
- Real PostgreSQL 16 isolation tests passed on remote Docker context `m3-max`, engine
  29.4.0, using the existing pinned image. Task container and anonymous volumes removed.
  Synthetic data, no network or published ports; no production database used.
- All five mocked Terraform storage tests passed. Existing regional modules are
  unchanged; no AWS resources created.
- Gitleaks scan of every file changed from main passed. Documentation links and git
  whitespace checks passed.

Earlier PR head `a85f07e` passed GitHub `validate` run 36411467446; that result does
not validate the consolidation. The latest PR head must pass before squash merge.
No source result proves operational sovereignty, deliverability, native protocol
isolation, immutable deployed backups or regional HA. Production gates remain open.

Publication access: the GitHub connector initially rejected writes with HTTP 403.
The owner approved repository-scoped Agent Vault access on 2026-09-29; brokered
GitHub REST access now succeeds. No plaintext credentials were read or written.
Publication and merge still require the latest PR head to pass `validate`; no
production deployment is part of this foundation increment.
