"""Operations overlay policy. Source: deploy/overlays/blak/ops.yaml."""

from __future__ import annotations

from pathlib import Path

from blak_profiles import load_profile

OPS_REL = "deploy/overlays/blak/ops.yaml"


def ops_config(root: Path) -> dict:
    section = load_profile(root / OPS_REL).get("ops") or {}
    return section if isinstance(section, dict) else {}

def sbom_required(root: Path) -> bool:
    return bool(ops_config(root).get('sbom'))
