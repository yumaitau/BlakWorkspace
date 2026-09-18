"""Per-app branding coverage against portal tiles and the naming map."""

from __future__ import annotations

from pathlib import Path

PORTAL_REL = "deploy/overlays/blak/portal-labels.example.yaml"
NAMING_REL = "docs/brand/naming-map.md"
LOCALE_RELS = (
    "deploy/overlays/blak/theme-values.example.yaml",
    "deploy/overlays/blak/portal-labels.example.yaml",
)
REQUIRED_LOCALE = "en-AU"


def _portal_tiles(text: str) -> list[dict]:
    tiles: list[dict] = []
    current: dict | None = None
    in_tiles = False
    for raw in text.splitlines():
        stripped = raw.split("#", 1)[0].rstrip()
        if not stripped:
            continue
        if stripped.strip() == "tiles:":
            in_tiles = True
            continue
        if not in_tiles:
            continue
        if stripped.lstrip().startswith("- id:"):
            if current:
                tiles.append(current)
            current = {"id": stripped.split(":", 1)[1].strip(), "enabled": True}
            continue
        if current is None:
            continue
        if "label:" in stripped:
            current["label"] = stripped.split(":", 1)[1].strip().strip('"')
        if "enabled:" in stripped:
            current["enabled"] = stripped.split(":", 1)[1].strip().lower() == "true"
    if current:
        tiles.append(current)
    return tiles


def _named_labels(text: str) -> list[str]:
    labels: list[str] = []
    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 2:
            continue
        if cells[0].startswith("-") or cells[0].lower() in {"blak label"}:
            continue
        labels.append(cells[0])
    return labels


def branding_coverage(root: Path) -> list[dict]:
    """Audit each named Blak product against the portal overlay."""
    tiles = _portal_tiles((root / PORTAL_REL).read_text(encoding="utf-8"))
    by_label = {t.get("label"): t for t in tiles}
    rows = []
    for label in _named_labels((root / NAMING_REL).read_text(encoding="utf-8")):
        tile = by_label.get(label)
        if label in {"Blak Workspace", "Blak Flow"}:
            status = "suite-or-reserved"
        elif tile is None:
            status = "gap"
        elif tile.get("enabled") is False:
            status = "tile-disabled"
        else:
            status = "tile"
        rows.append(
            {
                "label": label,
                "tile_id": None if tile is None else tile.get("id"),
                "status": status,
            }
        )
    return rows


def overlay_locales(root: Path) -> dict[str, str]:
    """Locale strings declared in overlay YAML (key: locale)."""
    found: dict[str, str] = {}
    for rel in LOCALE_RELS:
        text = (root / rel).read_text(encoding="utf-8")
        for raw in text.splitlines():
            stripped = raw.split("#", 1)[0].strip()
            if stripped.startswith("locale:"):
                found[rel] = stripped.split(":", 1)[1].strip().strip('"').strip("'")
    return found


def locale_mismatches(root: Path) -> list[str]:
    return [
        f"{rel}={value}"
        for rel, value in overlay_locales(root).items()
        if value != REQUIRED_LOCALE
    ]


def coverage_gaps(root: Path) -> list[str]:
    return [
        row["label"]
        for row in branding_coverage(root)
        if row["status"] == "gap"
    ]
