# openDesk theme hooks for the Blak overlay

Prefer overlay files, not a fork of upstream app source. Keys below are the documented openDesk theming surfaces at the pinned baseline. Do not invent per-app colour APIs.

## Inventory

| Hook | Upstream location (at pin) | Blak overlay stub | Notes |
| --- | --- | --- | --- |
| Suite theme values | `helmfile/files/theme` and `theme.yaml.gotmpl` | `deploy/overlays/blak/theme-values.example.yaml` | Fill from `brand/tokens.json` only after provenance approval |
| Portal styles | portal `portalStylesheets.css` | not vendored; document only | Upgrade-sensitive; restyle via supported CSS hook |
| Portal links / tiles | `functional.portal` values | `deploy/overlays/blak/portal-labels.example.yaml` | Labels only; do not rename OIDC client IDs |
| Keycloak login theme | Nubus/Keycloak theme files | none yet | Optional later; keep upstream default until tokens exist |
| Docmost branding | Docmost theming (discovery, BW-055) | none yet | Do not assume openDesk portal deep-link keys |

## Limitations

- Per-app theming coverage is incomplete until BW-016.
- Null colours in the stub are intentional; do not invent a palette.
- Patching Element/Collabora source for colours is out of scope (`upstream:patch` if ever unavoidable).
- Image digests for theme sidecars are not vendored.

## Upgrade

Re-test hooks after each upstream pin bump (see [docs/upstream-baseline.md](../upstream-baseline.md)). If a gotmpl key disappears, fail the overlay rather than forking charts.

## Related

- [ADR-006](../adr/ADR-006.md)
- [brand/tokens.json](../../brand/tokens.json)
