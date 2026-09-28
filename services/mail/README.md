# Mail control-plane foundations

This is not a running mail server or exposed API. Architecture and release gates live
in [docs/mail](../../docs/mail/README.md).

Implemented source increment:

- `apps/portal/mail-policy.js`: explicit region/transport policy and membership checks.
  Melbourne/failed Sydney returns `hold`; no unqualified relay is used.
- `apps/portal/mail-dns.js`: tenant-authorised, bounded DNS-only record verification.
  TXT policies compare to provisioned values and do not imply full SPF evaluation.
  MTA-STS HTTPS, provider activation and delivery remain separate pending gates.
- `schema.sql`: tenant-qualified domain/mailbox/alias keys, forced PostgreSQL RLS and
  append-only runtime audit grants. No production migration or DB credentials.

Ownership challenge tokens are public DNS proof values, not authentication secrets;
the schema retains them so administrators can see required TXT records until expiry.

The identity/membership arguments must be supplied by a verified server-side adapter.
These functions do not verify OIDC tokens. No new portal route accepts caller-supplied
memberships. The existing Mail launcher is untouched until integration is complete.

The SQL migration is initial-only, runs under a migration owner and creates a NOLOGIN
runtime group. Provision a separate authenticated runtime role later. Execute queries
inside a transaction with `SET LOCAL blak.tenant_id` from verified membership; never
use a connection-wide tenant setting. Runtime cannot own tables, TRUNCATE or bypass
RLS. A trusted backend can change the tenant GUC: this is not protection against a
compromised shared backend. Native mail/storage isolation remains a later acceptance
gate. See [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

```sh
node --test apps/portal/test/mail-foundation.test.js
python3 scripts/test-mail-isolation.py
```

The SQL test uses remote Docker context `m3-max`, verifies availability, creates a
randomly named container with no network or published ports, and removes only that
container and its anonymous volumes. It never contacts AWS or an existing database.
