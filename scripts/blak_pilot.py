"""Pilot overlay policy. Source: deploy/overlays/blak/pilot.yaml."""

from __future__ import annotations

from pathlib import Path

from blak_profiles import load_profile

PILOT_REL = "deploy/overlays/blak/pilot.yaml"


def pilot_config(root: Path) -> dict:
    section = load_profile(root / PILOT_REL).get("pilot") or {}
    return section if isinstance(section, dict) else {}

def pilot_status(root: Path) -> str:
    return str(pilot_config(root).get('status') or '')

def operator_docs(root: Path) -> list[str]:
    raw = str(pilot_config(root).get('operatorDocs') or '')
    return [p.strip() for p in raw.split(',') if p.strip()]

def oss_package_files(root: Path) -> list[str]:
    raw = str(pilot_config(root).get('ossFiles') or '')
    return [p.strip() for p in raw.split(',') if p.strip()]

def blak_flow_status(root: Path) -> str:
    return str(pilot_config(root).get('blakFlow') or '')

def ai_default(root: Path) -> str:
    return str(pilot_config(root).get('aiDefault') or '')
