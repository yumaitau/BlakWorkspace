# Hermes (Blak Hermes)

Default profiles keep Hermes **disabled**. Enable only with the eval sketch `deploy/profiles/eval/hermes.example.yaml` after image pin, licence review, and Nubus SSO.

## Bring-up (eval intent, no prod apply)

1. Confirm `python scripts/validate-manifest.py` passes.
2. Pin `hermes.imageTag` from a real `ghcr.io/yumaitau/companyos-hermes` tag. Do not invent a digest.
3. Set `hermes.enabled: true` and, for workplace search, `documentSearch: true` plus the corpus flags you mean.
4. Keep `publishGateway: false` and `allowPublicUnauthenticated: false`.
5. Point MCP at the control-plane proxy path `/api/hermes/mcp` (compose/cluster DNS), not a public URL.
6. Inference stays `owner-chosen` unless owners set `allowExternalInference`.

## Search

Hermes searches only the corpus flags that are true: Drive (OpenCloud), Docs (Collabora-on-Drive), Knowledge (Docmost). Unauthorised users must not read hits via UI or API. There is no eval-cluster smoke in this seed.

## Backup

Hermes state is a dedicated volume (`companyos_hermes` in the YumaOS compose analogue). Treat it as application state: sessions, memory, skills. Restore after identity and object stores. Missing volume encryption keys fail closed (see [backup-restore.md](backup-restore.md)).

## Related

- [ADR-011](../adr/ADR-011.md)
- [docs/architecture/hermes.md](../architecture/hermes.md)
- BW-053 (policy default off), BW-056 (this wiring)
