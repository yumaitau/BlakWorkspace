# Deployment profiles (pivot)

## Blak Micro (5–20 users, 1–2 SFF)

Compose or single-node K3s. Core: Portal, Identity, Drive, Docs, Sites, Postgres, Valkey, S3 (MinIO), Search (Meilisearch). No mail, no Jitsi, no OpenProject. See `deploy/docker/micro.compose.yaml` and `deploy/k3s/micro/`.

## Blak Small (20–100, 3× Tiny)

3-node K3s (or Compose cluster). Micro + replicated storage, automated backups, monitoring, failover where practical. HA Postgres (primary/replica) optional.

## Blak Business (100–500, 3–6 nodes)

K3s, HA Postgres, distributed storage, dedicated observability, Helm.

## Blak Enterprise / Government

K8s multi-zone, dedicated DB/storage, immutable audit, SIEM, private networking, sovereign infra, PSPF/ISM-aligned patterns (no certification claim), air-gap where feasible.

## Hardware ref (3× Tiny + opt DGX Spark)

Tiny#1-2 compute+apps, Tiny#3 storage/DB/HA. DGX Spark local inference only. Workspace runs if AI node down.

## Homelab target (this task)

Single-node K3s on `homelab` (Ubuntu 26.04, 12vCPU/30GB). Namespace `blak-micro`. Traefik ingress (K3s default), ClusterIP + port-forward for e2e. No TLS for first pass; add cert-manager later.
