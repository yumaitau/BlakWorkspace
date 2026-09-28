\set ON_ERROR_STOP on
-- Synthetic data only. Harness runs this in a task-owned temporary PostgreSQL.
INSERT INTO blak_mail.domains (tenant_id,id,domain,challenge_token,challenge_expires_at) VALUES
('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a.example.test',repeat('a',43),now()+interval '1 hour'),
('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b.example.test',repeat('a',43),now()+interval '1 hour');
INSERT INTO blak_mail.mailboxes (tenant_id,id,domain_id,local_part,identity_id,kind,status,quota_bytes) VALUES
('22222222-2222-4222-8222-222222222222','cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','member','dddddddd-dddd-4ddd-8ddd-dddddddddddd','personal','active',1024);
SET ROLE blak_mail_runtime;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM blak_mail.domains) THEN RAISE EXCEPTION 'Missing context leaked rows'; END IF;
END $$;
BEGIN;
SET LOCAL blak.tenant_id = '11111111-1111-4111-8111-111111111111';
DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM blak_mail.domains;
  IF n <> 1 THEN RAISE EXCEPTION 'Unfiltered SELECT leaked rows'; END IF;
  IF EXISTS(SELECT 1 FROM blak_mail.mailboxes) THEN RAISE EXCEPTION 'Mailbox leaked'; END IF;
  UPDATE blak_mail.domains SET status='suspended' WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'Cross-tenant UPDATE succeeded'; END IF;
  DELETE FROM blak_mail.domains WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'Cross-tenant DELETE succeeded'; END IF;
  BEGIN
    INSERT INTO blak_mail.domains (tenant_id,id,domain,challenge_token,challenge_expires_at)
      VALUES ('22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','x.example.test',repeat('a',43),now());
    RAISE EXCEPTION 'Cross-tenant INSERT succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE blak_mail.domains SET tenant_id='22222222-2222-4222-8222-222222222222';
    RAISE EXCEPTION 'Tenant reassignment succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO blak_mail.aliases VALUES
      ('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','alias','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    RAISE EXCEPTION 'Cross-tenant foreign key succeeded';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    TRUNCATE blak_mail.domains CASCADE;
    RAISE EXCEPTION 'Runtime TRUNCATE succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM blak_mail.audit_events;
    RAISE EXCEPTION 'Runtime audit deletion succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
COMMIT;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM blak_mail.domains) THEN RAISE EXCEPTION 'Scope survived connection reuse'; END IF;
END $$;
BEGIN;
SET LOCAL blak.tenant_id = '22222222-2222-4222-8222-222222222222';
DO $$ BEGIN
  IF (SELECT count(*) FROM blak_mail.domains WHERE status='pending') <> 1 THEN RAISE EXCEPTION 'Other tenant changed'; END IF;
  IF (SELECT count(*) FROM blak_mail.mailboxes) <> 1 THEN RAISE EXCEPTION 'Own mailbox invisible'; END IF;
END $$;
ROLLBACK;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM blak_mail.domains) THEN RAISE EXCEPTION 'Rollback leaked scope'; END IF;
END $$;
SELECT 'PASS: tenant RLS, writes, foreign keys, audit grants and connection reuse' AS result;
