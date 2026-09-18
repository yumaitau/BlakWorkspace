# Per-app branding coverage (BW-016)

Audit of user-facing Blak labels versus the portal overlay. Source of truth is `scripts/blak_brand.py` reading `docs/brand/naming-map.md` and `deploy/overlays/blak/portal-labels.example.yaml`.

## Method

1. List Blak labels from the naming map.
2. Match portal tiles by label.
3. Suite name (Blak Workspace) and reserved Blak Flow need no tile.
4. Disabled tiles (OX, Hermes) count as covered-but-off, not gaps.

## Expected gaps

None for named products with a tile. Remaining hook gaps (not product tiles):

- Keycloak login theme still upstream-default until brand tokens exist
- Per-app CSS inside Element/Nextcloud/Collabora is out of scope (no source patches)

Run: `python -c "from pathlib import Path; import sys; sys.path.insert(0,'scripts'); from blak_brand import coverage_gaps; print(coverage_gaps(Path('.')))"`
