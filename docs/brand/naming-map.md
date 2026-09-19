# Naming map

Labels only. Do not rename Helm releases, chart names, or OIDC client IDs without a migration plan.

| Blak label | Upstream component | Internal ID (do not rename) |
| --- | --- | --- |
| Blak Workspace | openDesk suite | openDesk / helmfile releases as upstream |
| Blak Drive | Nextcloud | nextcloud |
| Blak Docs | Collabora | collabora |
| Blak Notes | Notes | notes |
| Blak Chat | Element | element / synapse |
| Blak Meet | Jitsi | jitsi |
| Blak Mail and Calendar | OX App Suite (optional, if licensed) | ox |
| Blak Knowledge | Docmost (not XWiki) | docmost |
| Blak Projects | OpenProject | openproject |
| Blak Admin | Nubus admin / portal admin | nubus |
| Blak Flow | Reserved for later | n/a |
| Blak Hermes | Hermes agent (Yuma-packaged `companyos-hermes`) | hermes |
| Blak Sites | Sites (overlay aggregation layer) | sites |

Blak Knowledge maps to **Docmost**, not XWiki. See BW-055. Do not enable both in default profiles. Do not show an XWiki portal tile as Blak Knowledge.

## Portal tile plan

Apply labels via `deploy/overlays/blak/portal-labels.example.yaml` using upstream `functional.portal` keys (see [theme-hooks.md](theme-hooks.md)). Keep `en-AU` locale. Internal tile `id` values stay upstream identifiers.

## Upgrade re-test checklist

- [ ] After each openDesk pin bump, diff portal tile keys
- [ ] Confirm Blak Knowledge still points at Docmost, not XWiki
- [ ] Confirm Helm release names unchanged
- [ ] Confirm OIDC client IDs unchanged
- [ ] Re-read legal/support surfaces so Docmost/openDesk attribution remains visible
- [ ] Confirm Blak Hermes tile stays off unless `hermes.enabled` is opted in
- [ ] Confirm Blak Sites tile stays off unless `sites.enabled` is opted in
