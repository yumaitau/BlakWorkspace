#!/usr/bin/env bash
# Retain legacy CRM data before changing the public service. Never print credentials.
set -euo pipefail
NS=blak-micro
if ! kubectl -n "$NS" get deploy crm >/dev/null 2>&1; then exit 0; fi
if [ "$(kubectl -n "$NS" get deploy crm -o jsonpath='{.spec.replicas}')" = 0 ]; then exit 0; fi
umask 077
BACKUP="${BLAK_BACKUP_DIR:-$HOME/backups}/twenty-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP"
kubectl -n "$NS" exec deploy/crm-db -- pg_dump -U twenty -d twenty -Fc > "$BACKUP/database.dump"
test "$(head -c 5 "$BACKUP/database.dump")" = PGDMP
kubectl -n "$NS" exec deploy/crm -- tar -C /app/packages/twenty-server/.local-storage -cf - . > "$BACKUP/files.tar"
kubectl -n "$NS" get secret blak-crm -o yaml > "$BACKUP/secret.yaml"
kubectl -n "$NS" get deploy crm crm-worker crm-db crm-cache -o yaml > "$BACKUP/deployments.yaml"
printf 'Twenty rollback backup: %s\n' "$BACKUP"
