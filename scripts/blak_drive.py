"""Drive overlay policy. Source: deploy/overlays/blak/drive.yaml."""

from __future__ import annotations

from pathlib import Path

from blak_profiles import load_profile

DRIVE_REL = "deploy/overlays/blak/drive.yaml"


def drive_config(root: Path) -> dict:
    section = load_profile(root / DRIVE_REL).get("drive") or {}
    return section if isinstance(section, dict) else {}

def drive_quota_gb(root: Path) -> int:
    return int(drive_config(root).get('quotasGb'))

def share_link_default(root: Path) -> str:
    return str(drive_config(root).get('shareLinkDefault') or '')
