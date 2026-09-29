# Mail control-plane foundations

Not a running mail server or exposed API. Architecture and release gates live in
[docs/mail](../../docs/mail/README.md). Existing Proton launcher remains unchanged.

- `apps/portal/mail-policy.js`: authenticated membership and AU region contracts.
  Both regions hold while Sydney SES is unavailable; recovery uses only Sydney SES.
- `apps/portal/mail-dns.js`: bounded tenant-authorised DNS checks. MTA-STS HTTPS,
  provider activation, routing reservation and delivery remain pending gates.
- `schema.sql`: eleven tenant-scoped metadata tables with FORCE RLS, composite
  references, protected domain verification, credential-hash read restrictions and
  separate append-only ingest grants. No message bodies or production migration.
- `scripts/mail/check-deployment.py`: strict declared-intent checks for Australian
  resources, SES SMTP with STARTTLS, outage HOLD and evidence gates. No cloud discovery
  or evidence-signature verification; passing intent does not authorise deployment.

Identity and memberships must come from a verified server-side adapter, never request
fields. No portal endpoint is enabled. The consolidated initial schema replaces the
unshipped four-table draft; the DNS verifier's server-owned ownership challenge and
expected records still require a provisioning adapter before exposing an API.

Install schema into an empty dedicated database as a migration owner. `mail_app` and
`mail_ingest` are NOLOGIN groups without superuser/BYPASSRLS. Runtime login roles must
inherit only needed privileges and never own tables. Trusted provisioning creates
tenants and verifies domains; ordinary app grants cannot mark domains verified.

Each request starts a transaction and uses parameterized
`set_config('blak.tenant_id', $1, true)` with its server-authorised tenant UUID.
Commit/rollback clears scope; missing context sees no rows. RLS guards omitted filters,
not a compromised shared backend that can set another tenant UUID. Native protocol,
global domain ownership and storage isolation remain production gates.

App reads audit/traces; dedicated tenant-scoped ingest appends. Outbox records desired
changes with provisioning/audit intent in one transaction. Publisher leases, consumer
receipts, replay archive and immutable external audit are not implemented yet; see
[queue and event contract](../../docs/mail/queue-and-events.md).

```sh
node --test apps/portal/test/mail-foundation.test.js
PYTHONPATH=tests python3 -m unittest test_mail_policy
python3 scripts/test-mail-isolation.py
```

SQL tests use digest-pinned PostgreSQL on remote Docker context `m3-max`, synthetic
data, no network or published ports, and remove only their own container and volumes.
They never contact AWS or an existing database.
