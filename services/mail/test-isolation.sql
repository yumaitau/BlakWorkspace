\set ON_ERROR_STOP on
-- Fixture installation uses the container-only database administrator.
INSERT INTO mail.tenants VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO mail.domains (tenant_id,id,name) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','a.example.test'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','b.example.test');
INSERT INTO mail.mailboxes (tenant_id,id,domain_id,local_part,kind,quota_bytes) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','owner','personal',1000),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','owner','personal',1000);
DO $$
DECLARE t uuid; d uuid; m uuid; object_id uuid;
BEGIN
    FOR t,d,m IN SELECT b.tenant_id,b.domain_id,b.id FROM mail.mailboxes b LOOP
        object_id := (left(t::text,35) || '7')::uuid;
        INSERT INTO mail.aliases VALUES (t,object_id,d,'alias',m);
        INSERT INTO mail.distribution_lists VALUES (t,object_id,d,'list');
        INSERT INTO mail.list_members VALUES (t,object_id,m);
        INSERT INTO mail.delegations VALUES (t,m,m,'read');
        INSERT INTO mail.smtp_credentials VALUES (t,object_id,m,object_id,'synthetic-hash-not-a-credential',60,now()+interval '1 day',NULL,NULL);
        INSERT INTO mail.trace_events VALUES (t,object_id,now(),'synthetic-message-id','sender@example.test','recipient@example.test',object_id,'ap-southeast-2',NULL,'queued',NULL,NULL);
        INSERT INTO mail.audit_events VALUES (t,object_id,now(),m,'fixture.created',m,object_id,'success','ap-southeast-2');
        INSERT INTO mail.outbox (tenant_id,id,target_id,action,generation) VALUES (t,object_id,m,'mailbox.create',1);
    END LOOP;
END $$;
-- A helper contains assertions only, never SECURITY DEFINER privilege elevation.
CREATE FUNCTION public.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF; END $$;
SELECT public.assert_true((SELECT count(*) = 11 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='mail' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity), 'all tenant tables force RLS');
SELECT public.assert_true((SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin FROM pg_roles WHERE rolname='mail_app'), 'app role unprivileged');
SET ROLE mail_app;
SELECT public.assert_true((SELECT count(*) = 0 FROM mail.mailboxes), 'missing context sees nothing');
BEGIN;
SELECT set_config('blak.tenant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
SELECT public.assert_true((SELECT count(*) = 1 FROM mail.mailboxes), 'tenant A sees only A');
SELECT public.assert_true((SELECT count(*) = 1 FROM mail.domains), 'tenant A domain list');
SELECT public.assert_true((SELECT count(*) = 1 FROM mail.tenants), 'tenant registry scoped');
DO $$
DECLARE table_name text; visible bigint;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['tenants','domains','mailboxes','aliases','distribution_lists',
        'list_members','delegations','smtp_credentials','trace_events','audit_events','outbox'] LOOP
        EXECUTE format('SELECT count(*) FROM mail.%I', table_name) INTO visible;
        PERFORM public.assert_true(visible=1, 'A can enumerate only A: ' || table_name);
    END LOOP;
END $$;
WITH changed AS (UPDATE mail.mailboxes SET quota_bytes=1 WHERE tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' RETURNING id)
SELECT public.assert_true((SELECT count(*)=0 FROM changed), 'cross-tenant update invisible');
WITH removed AS (DELETE FROM mail.mailboxes WHERE tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' RETURNING id)
SELECT public.assert_true((SELECT count(*)=0 FROM removed), 'cross-tenant delete invisible');
UPDATE mail.mailboxes SET quota_bytes=2000 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
SELECT public.assert_true((SELECT quota_bytes=2000 FROM mail.mailboxes), 'own update allowed');
DO $$ BEGIN
    BEGIN
        INSERT INTO mail.domains (tenant_id,id,name) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','attack.test');
        RAISE EXCEPTION 'cross-tenant insert allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        UPDATE mail.mailboxes SET tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        RAISE EXCEPTION 'tenant reassignment allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        INSERT INTO mail.aliases VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','attack','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');
        RAISE EXCEPTION 'cross-tenant alias allowed';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
        INSERT INTO mail.list_members VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');
        RAISE EXCEPTION 'cross-tenant list member allowed';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
        INSERT INTO mail.delegations VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','read');
        RAISE EXCEPTION 'cross-tenant delegation allowed';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
        UPDATE mail.domains SET verified_at=now();
        RAISE EXCEPTION 'app can forge domain verification';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        PERFORM password_hash FROM mail.smtp_credentials;
        RAISE EXCEPTION 'ordinary listing can read credential hashes';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        DELETE FROM mail.audit_events;
        RAISE EXCEPTION 'app can delete audit';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        TRUNCATE mail.mailboxes CASCADE;
        RAISE EXCEPTION 'app can bypass RLS with truncate';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
COMMIT;
SELECT public.assert_true((SELECT count(*)=0 FROM mail.mailboxes), 'transaction pool context cleared');
BEGIN;
SELECT set_config('blak.tenant_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
SELECT public.assert_true((SELECT count(*)=1 FROM mail.mailboxes), 'tenant B sees only B');
SELECT public.assert_true((SELECT quota_bytes=1000 FROM mail.mailboxes), 'tenant B unchanged');
ROLLBACK;
RESET ROLE;
SET ROLE mail_ingest;
BEGIN;
SELECT set_config('blak.tenant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
INSERT INTO mail.audit_events VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',now(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','mailbox.created','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6','success','ap-southeast-2');
DO $$ BEGIN
    BEGIN
        UPDATE mail.audit_events SET action='forged';
        RAISE EXCEPTION 'ingest can overwrite audit';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        INSERT INTO mail.audit_events VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5',now(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','mailbox.created','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6','success','ap-southeast-4');
        RAISE EXCEPTION 'ingest can cross tenants';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
COMMIT;
RESET ROLE;
SET ROLE mail_app;
BEGIN;
SELECT set_config('blak.tenant_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
SELECT public.assert_true((SELECT count(*)=1 FROM mail.audit_events), 'tenant B cannot enumerate A audit');
ROLLBACK;
RESET ROLE;
