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
