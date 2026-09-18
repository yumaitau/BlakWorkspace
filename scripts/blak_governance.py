"""Governance overlay policy. Source: deploy/overlays/blak/governance.yaml."""

from __future__ import annotations

from pathlib import Path

from blak_profiles import load_profile

GOV_REL = "deploy/overlays/blak/governance.yaml"


def governance_config(root: Path) -> dict:
    section = load_profile(root / GOV_REL).get("governance") or {}
    return section if isinstance(section, dict) else {}

def policy_controls(root: Path) -> list[str]:
    raw = str(governance_config(root).get('controls') or '')
    return [p.strip() for p in raw.split(',') if p.strip()]

def stewardship_fields(root: Path) -> list[str]:
    raw = str(governance_config(root).get('stewardshipFields') or '')
    return [p.strip() for p in raw.split(',') if p.strip()]

def enforcement_paths(root: Path) -> list[str]:
    raw = str(governance_config(root).get('enforcement') or '')
    return [p.strip() for p in raw.split(',') if p.strip()]

def retention_days(root: Path) -> int:
    return int(governance_config(root).get('retentionDays'))

def data_residency(root: Path) -> str:
    return str(governance_config(root).get('dataResidency') or '')
