# Blak Hermes (sovereign AI + document search)

Opt-in sidecar. Default profiles keep it **off**. See [ADR-011](../adr/ADR-011.md).

## Deploy beside the suite

Hermes is not an openDesk chart rename. It is a Yuma-packaged runtime (`ghcr.io/yumaitau/companyos-hermes`) that sits on the same organisation deployment as Blak Drive / Docs / Knowledge.

- Stub values: [deploy/overlays/blak/hermes-values.example.yaml](../../deploy/overlays/blak/hermes-values.example.yaml)
- Eval enablement sketch: [deploy/profiles/eval/hermes.example.yaml](../../deploy/profiles/eval/hermes.example.yaml)
- Control-plane registration: [deploy/control-plane/hermes.json](../../deploy/control-plane/hermes.json)

Do not apply production from this seed. Pin the image tag before calling a profile supported.

## Control plane

Nubus is the control plane (Blak Admin). Registration document `hermes.json` is what portal/MCP wiring must match:

| Surface | Behaviour |
| --- | --- |
| Portal tile | Label **Blak Hermes**, internal id `hermes`, default `enabled: false` |
| Gateway | Port 8642, cluster DNS only, health `/health` |
| Dashboard | Port 9119, tunnel/proxy only |
| MCP | `/api/hermes/mcp` on the product/control-plane proxy, never a public Hermes URL |
| Actor | Nubus/OIDC; unauthenticated callers cannot search |

`python scripts/validate-manifest.py` loads that JSON and the profile flags together.

## Search across documents

When `hermes.enabled` **and** `hermes.documentSearch` are true, Hermes may index/query:

| Flag | Blak store | Upstream |
| --- | --- | --- |
| `corpusDrive` | Blak Drive | OpenCloud |
| `corpusDocs` | Blak Docs | Collabora (files live on Drive) |
| `corpusKnowledge` | Blak Knowledge | Docmost |

Corpus flags without `documentSearch` fail validation. Knowledge corpus requires `knowledge.xwiki: false`.

Audience stays at the organisation floor: Hermes does not invent per-user ACLs beyond what Nubus and the source apps already enforce. Live connector keys are discovery against the pinned openDesk/Docmost versions — do not invent Helm keys.

## Sovereign AI fit

- One Hermes per organisation deployment (ADR-002)
- AU hosting intent (ADR-008); no paid apply in this seed
- Inference default `owner-chosen` (local/AU). `openai` / `anthropic` / `gemini` require `allowExternalInference: true`
- AI off unless the profile opt-in is set (BW-053)
- No IRAP/PROTECTED claim
