# Implementation evidence — first increment

Date: 2026-09-28. Scope: architecture package and source foundations, not deployed mail.

| Capability | Status | Evidence / limit |
| --- | --- | --- |
| Twenty requested design deliverables | Documented | README index; seven mail ADRs; epic #193 and issues #194–#201 |
| Regional service discovery | Public documentation checked | Availability matrix and endpoint source hashes; account-specific feature tests still required |
| Region/transport safety | Source-tested | Reject non-AU regions; hold unqualified DR route rather than foreign relay |
| Tenant permission contract | Source-tested | Issuer/subject/current-membership binding; no workspace-admin bypass |
| Domain DNS checks | Source-tested | Ownership/MX/SPF/DKIM/DMARC/MTA-STS TXT/TLS-RPT; bounded lookups and unknown failures |
| Domain activation / MTA-STS HTTPS | Not implemented | Verifier always reports activation pending; no arbitrary HTTP fetcher |
| Tenant domain/mailbox/alias schema | PostgreSQL-tested | Real remote PostgreSQL 16 tests for missing scope, unfiltered reads, writes, FKs, audit grants, transaction reuse |
| AU immutable archive module | Terraform-validated / mocked tests | Both regional roots; independent KMS, private versioned Object Lock buckets; not applied |
| Tenant directory adapter / control API | Not implemented | Existing identity has no shared mail tenant contract; no unsafe endpoint exposed |
| Native OX/Dovecot/Postfix/SES integration | Not implemented | Supported artifacts, storage, provider/account and protocol proof outstanding |
| Mail administration UI | Not implemented | Existing Proton launcher unchanged; no fake management controls |
| Live backup/DR/observability/SIEM | Not implemented | Runbooks and acceptance gates documented; no RPO/RTO measurement claimed |

Local verification:

- Manifest validation passed.
- Python suite: 357 passed, using Homebrew OpenSSL 3 via `BLAK_OPENSSL`; macOS
  system LibreSSL initially failed the pre-existing local-TLS prerequisite.
- Portal suite: 73 passed, 1 skipped; includes 8 new mail foundation tests.
- Real PostgreSQL isolation harness passed against task-owned remote Docker container;
  container and anonymous volumes removed afterward. No production database used.
- Terraform storage module and both regional entry points validated. Five mocked
  Terraform cases passed, including foreign region, provider mismatch and shared
  writer/restore-identity rejection. No AWS resources created.
- Public patch secret scan and local documentation-link check passed.

No source-level result in this table proves operational sovereignty, provider
deliverability, native protocol isolation, immutable deployed backups or regional HA.
Production rollout requires the open gates in README and milestone evidence.
