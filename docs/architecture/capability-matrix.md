# Capability matrix (seed)

Historical openDesk defaults are not Blak defaults. XWiki is **not** an enabled Blak Knowledge backend.

| Capability | Blak default | Backend | Notes |
| --- | --- | --- | --- |
| Drive | Overlay intent | Nextcloud | BW-025+ |
| Docs | Overlay intent | Collabora | BW-027 |
| Chat | Overlay intent | Element | BW-031 |
| Meet | Overlay intent | Jitsi | BW-032 |
| Notes | Overlay intent | Notes | BW-034 (Notes only) |
| Knowledge | Docmost when enabled | **Docmost** | XWiki is migration/history only; see ADR-010 / BW-055 |
| Projects | Overlay intent | OpenProject | BW-035 |
| Mail/Calendar | Off | OX optional | BW-033 |
| Admin / SSO | Nubus | Nubus | BW-019 |
| Flow | Live | Blak Flow engine | BW-052; Drive + Sites connectors |
| AI / document search | Off | **Hermes** (opt-in) | Blak Hermes; default off; ADR-011 / BW-053 / BW-056 |

Residual XWiki mentions in this repository are historical, migration, or "not enabled" statements.
