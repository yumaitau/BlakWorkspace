BEGIN;
CREATE ROLE mail_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE mail_ingest NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE SCHEMA mail;
REVOKE ALL ON SCHEMA mail FROM PUBLIC;
GRANT USAGE ON SCHEMA mail TO mail_app, mail_ingest;

CREATE FUNCTION mail.current_tenant() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('blak.tenant_id', true), '')::uuid $$;
REVOKE ALL ON FUNCTION mail.current_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mail.current_tenant() TO mail_app, mail_ingest;

CREATE TABLE mail.tenants (
    tenant_id uuid PRIMARY KEY,
    state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'disabled'))
);
CREATE TABLE mail.domains (
    tenant_id uuid NOT NULL REFERENCES mail.tenants,
    id uuid NOT NULL,
    name text NOT NULL CHECK (name = lower(name) AND length(name) BETWEEN 3 AND 253 AND name ~ '^[a-z0-9.-]+$'),
    verified_at timestamptz,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, name)
);
-- A separate privileged global domain-claim registry is required before verification.
-- Do not infer global ownership from this tenant-local desired-state table.
CREATE TABLE mail.mailboxes (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL,
    domain_id uuid NOT NULL,
    local_part text NOT NULL CHECK (local_part ~ '^[a-z0-9][a-z0-9._+-]{0,63}$'),
    identity_subject text,
    kind text NOT NULL CHECK (kind IN ('personal', 'shared')),
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'active', 'disabled', 'deleted')),
    quota_bytes bigint NOT NULL CHECK (quota_bytes > 0),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, domain_id, local_part),
    FOREIGN KEY (tenant_id, domain_id) REFERENCES mail.domains (tenant_id, id)
);
CREATE TABLE mail.aliases (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL,
    domain_id uuid NOT NULL,
    local_part text NOT NULL CHECK (local_part ~ '^[a-z0-9][a-z0-9._+-]{0,63}$'),
    mailbox_id uuid NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, domain_id, local_part),
    FOREIGN KEY (tenant_id, domain_id) REFERENCES mail.domains (tenant_id, id),
    FOREIGN KEY (tenant_id, mailbox_id) REFERENCES mail.mailboxes (tenant_id, id)
);
CREATE TABLE mail.distribution_lists (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL,
    domain_id uuid NOT NULL,
    local_part text NOT NULL CHECK (local_part ~ '^[a-z0-9][a-z0-9._+-]{0,63}$'),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, domain_id, local_part),
    FOREIGN KEY (tenant_id, domain_id) REFERENCES mail.domains (tenant_id, id)
);
CREATE TABLE mail.list_members (
    tenant_id uuid NOT NULL,
    list_id uuid NOT NULL,
    mailbox_id uuid NOT NULL,
    PRIMARY KEY (tenant_id, list_id, mailbox_id),
    FOREIGN KEY (tenant_id, list_id) REFERENCES mail.distribution_lists (tenant_id, id),
    FOREIGN KEY (tenant_id, mailbox_id) REFERENCES mail.mailboxes (tenant_id, id)
);
CREATE TABLE mail.delegations (
    tenant_id uuid NOT NULL,
    mailbox_id uuid NOT NULL,
    delegate_mailbox_id uuid NOT NULL,
    permission text NOT NULL CHECK (permission IN ('read', 'write', 'send_as')),
    PRIMARY KEY (tenant_id, mailbox_id, delegate_mailbox_id, permission),
    FOREIGN KEY (tenant_id, mailbox_id) REFERENCES mail.mailboxes (tenant_id, id),
    FOREIGN KEY (tenant_id, delegate_mailbox_id) REFERENCES mail.mailboxes (tenant_id, id)
);
CREATE TABLE mail.smtp_credentials (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL,
    mailbox_id uuid NOT NULL,
    service_id uuid NOT NULL,
    password_hash text NOT NULL,
    recipient_limit_per_minute integer NOT NULL CHECK (recipient_limit_per_minute BETWEEN 1 AND 10000),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    last_used_at timestamptz,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, mailbox_id) REFERENCES mail.mailboxes (tenant_id, id)
);
CREATE TABLE mail.trace_events (
    tenant_id uuid NOT NULL REFERENCES mail.tenants,
    id uuid NOT NULL,
    occurred_at timestamptz NOT NULL,
    message_id text NOT NULL CHECK (length(message_id) <= 998),
    sender text NOT NULL CHECK (length(sender) <= 320),
    recipient text NOT NULL CHECK (length(recipient) <= 320),
    originating_service uuid,
    sending_region text NOT NULL CHECK (sending_region IN ('ap-southeast-2', 'ap-southeast-4')),
    delivery_region text CHECK (delivery_region IN ('ap-southeast-2', 'ap-southeast-4')),
    status text NOT NULL CHECK (status IN ('queued', 'deferred', 'accepted_by_provider', 'delivered', 'bounced', 'complained', 'suppressed')),
    reason_code text CHECK (reason_code ~ '^[A-Za-z0-9_.-]{1,64}$'),
    retry_at timestamptz,
    PRIMARY KEY (tenant_id, id)
);
CREATE TABLE mail.audit_events (
    tenant_id uuid NOT NULL REFERENCES mail.tenants,
    id uuid NOT NULL,
    occurred_at timestamptz NOT NULL,
    actor_id uuid NOT NULL,
    action text NOT NULL CHECK (action ~ '^[a-z][a-z_.]{1,80}$'),
    target_id uuid NOT NULL,
    request_id uuid NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'failed')),
    region text NOT NULL CHECK (region IN ('ap-southeast-2', 'ap-southeast-4')),
    PRIMARY KEY (tenant_id, id)
);
CREATE TABLE mail.outbox (
    tenant_id uuid NOT NULL REFERENCES mail.tenants,
    id uuid NOT NULL,
    target_id uuid NOT NULL,
    action text NOT NULL CHECK (action ~ '^[a-z][a-z_.]{1,80}$'),
    generation bigint NOT NULL CHECK (generation > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, target_id, generation)
);

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['tenants', 'domains', 'mailboxes', 'aliases',
        'distribution_lists', 'list_members', 'delegations', 'smtp_credentials',
        'trace_events', 'audit_events', 'outbox']
    LOOP
        EXECUTE format('ALTER TABLE mail.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE mail.%I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('CREATE POLICY tenant_boundary ON mail.%I USING (tenant_id = mail.current_tenant()) WITH CHECK (tenant_id = mail.current_tenant())', table_name);
    END LOOP;
END $$;
GRANT SELECT ON ALL TABLES IN SCHEMA mail TO mail_app;
GRANT INSERT (tenant_id, id, name), DELETE ON mail.domains TO mail_app;
GRANT INSERT, UPDATE, DELETE ON mail.mailboxes, mail.aliases, mail.distribution_lists,
    mail.list_members, mail.delegations, mail.smtp_credentials, mail.outbox TO mail_app;
GRANT INSERT ON mail.trace_events, mail.audit_events TO mail_ingest;
-- Credential hashes must never be returned by ordinary admin listing queries.
REVOKE SELECT ON mail.smtp_credentials FROM mail_app;
GRANT SELECT (tenant_id, id, mailbox_id, service_id, recipient_limit_per_minute,
    expires_at, revoked_at, last_used_at) ON mail.smtp_credentials TO mail_app;
COMMIT;
