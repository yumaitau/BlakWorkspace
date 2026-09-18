# Environment profile matrix

Promotion from eval to staging or prod is a **human gate**. No CI job in this repository applies production. Record promotion in [docs/governance/decision-log.md](../governance/decision-log.md).

| Topic | eval | staging | prod |
| --- | --- | --- | --- |
| Purpose | Learn overlay and helmfile diff | Pre-prod intent | Production intent |
| Apply from this seed | No | No | No |
| Bundled DB/object storage | Allowed for learning | Must not be the production path | Forbidden; operator-managed services |
| External services | Optional | Required | Required |
| High availability | No | Optional | Intent: yes |
| Backups | Optional rehearsal | Required before promotion | Required |
| Secrets in git | None | None | None |
| Optional OX / Entra / AI | Off | Off | Off |
| `knowledge.xwiki` | false | false | false |
| `knowledge.docmost` | false until BW-055 pin | false until BW-055 pin | false until BW-055 pin |
| Dual-enable XWiki + Docmost | Forbidden | Forbidden | Forbidden |

Stubs: `deploy/profiles/eval/values.yaml`, `deploy/profiles/staging/values.yaml`, `deploy/profiles/prod/values.yaml`.
