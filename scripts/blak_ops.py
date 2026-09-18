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

def observability_signals(root: Path) -> list[str]:
    raw = str(ops_config(root).get('signals') or '')
    return [p.strip() for p in raw.split(',') if p.strip()]

def restore_rehearsal_status(root: Path) -> str:
    return str(ops_config(root).get('restoreRehearsal') or '')
