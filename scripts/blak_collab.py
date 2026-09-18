"""Collaboration overlay policy. Source: deploy/overlays/blak/collab.yaml."""

from __future__ import annotations

from pathlib import Path

from blak_profiles import load_profile

COLLAB_REL = "deploy/overlays/blak/collab.yaml"


def collab_config(root: Path) -> dict:
    section = load_profile(root / COLLAB_REL).get("collab") or {}
    return section if isinstance(section, dict) else {}

def chat_backend(root: Path) -> str:
    return str(collab_config(root).get('chat') or '')

def meet_backend(root: Path) -> str:
    return str(collab_config(root).get('meet') or '')

def ox_enabled(root: Path) -> bool:
    return bool(collab_config(root).get('oxMailCalendar'))

def notes_backend(root: Path) -> str:
    return str(collab_config(root).get('notes') or '')

def projects_backend(root: Path) -> str:
    return str(collab_config(root).get('projects') or '')

def pilot_journeys(root: Path) -> list[str]:
    raw = str(collab_config(root).get('pilotJourneys') or '')
    return [p.strip() for p in raw.split(',') if p.strip()]
