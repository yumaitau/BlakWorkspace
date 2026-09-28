-- Initial control-plane schema. Apply as a migration owner, never as runtime.
-- No production migration is executed by CI or by the local test harness.
BEGIN;
CREATE ROLE blak_mail_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE SCHEMA blak_mail;
REVOKE ALL ON SCHEMA blak_mail FROM PUBLIC;
GRANT USAGE ON SCHEMA blak_mail TO blak_mail_runtime;

CREATE TABLE blak_mail.domains (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  domain text NOT NULL CHECK (domain = lower(domain) AND domain ~ '^[a-z0-9.-]+$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'suspended')),
  challenge_token text NOT NULL CHECK (challenge_token ~ '^[A-Za-z0-9_-]{43}$'),
  challenge_expires_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, domain)
);
-- Global routing uniqueness is reserved by a separate privileged reconciler only
-- after ownership proof. A runtime insert cannot enumerate other tenants' domains.
CREATE TABLE blak_mail.mailboxes (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  domain_id uuid NOT NULL,
  local_part text NOT NULL CHECK (local_part ~ '^[a-z0-9][a-z0-9._+-]{0,63}$'),
  identity_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('personal', 'shared')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled', 'deleting')),
  quota_bytes bigint NOT NULL CHECK (quota_bytes > 0),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, domain_id, local_part),
  FOREIGN KEY (tenant_id, domain_id) REFERENCES blak_mail.domains (tenant_id, id)
);
CREATE TABLE blak_mail.aliases (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  domain_id uuid NOT NULL,
  local_part text NOT NULL CHECK (local_part ~ '^[a-z0-9][a-z0-9._+-]{0,63}$'),
  mailbox_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, domain_id, local_part),
  FOREIGN KEY (tenant_id, domain_id) REFERENCES blak_mail.domains (tenant_id, id),
  FOREIGN KEY (tenant_id, mailbox_id) REFERENCES blak_mail.mailboxes (tenant_id, id)
);
CREATE TABLE blak_mail.audit_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('domain.created', 'domain.verified', 'domain.suspended',
    'mailbox.created', 'mailbox.disabled', 'mailbox.deleted', 'alias.created', 'alias.deleted')),
  target_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['domains', 'mailboxes', 'aliases', 'audit_events'] LOOP
    EXECUTE format('ALTER TABLE blak_mail.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE blak_mail.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_scope ON blak_mail.%I TO blak_mail_runtime
       USING (tenant_id = nullif(current_setting(''blak.tenant_id'', true), '''')::uuid)
       WITH CHECK (tenant_id = nullif(current_setting(''blak.tenant_id'', true), '''')::uuid)', table_name);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON blak_mail.domains, blak_mail.mailboxes, blak_mail.aliases TO blak_mail_runtime;
-- Append-only to runtime, not an immutable audit store; export to locked AU storage.
GRANT SELECT, INSERT ON blak_mail.audit_events TO blak_mail_runtime;
COMMIT;
