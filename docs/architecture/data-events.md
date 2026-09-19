# Data, events, search, notifications

## Data layer

Shared Postgres 16 cluster, one logical DB per app (`portal`, `authentik`, `opencloud`, `docmost`, `search`). Valkey 7 shared (separate DB indexes). S3 via MinIO (Micro) → SeaweedFS/sovereign S3 later. Backups: pg_dump + S3 snapshot, tested restore.

## Events

NATS (single binary, JetStream) default. Topics: `document.*`, `site.*`, `task.*`, `form.*`, `approval.*`, `chat.*`, `ai.*`. Consumers: notifications, search indexer, audit, automate. Redis Streams fallback if NATS unwanted. No Kafka.

## Search

Meilisearch for Micro/Small (low RAM, simple ops). Indexer consumes events, stores ACLs per doc (`allowed_users`, `allowed_groups`). Query filters by caller identity. OpenSearch path for large/government.

## Notifications

Service subscribes to events, renders to Portal inbox + email/Teams/webhook. Dedup + preferences per user.

## Audit

Append-only table + S3 export (JSONL). Events listed in platform-overview. SIEM forward via webhook/syslog. No PII in logs beyond IDs.
