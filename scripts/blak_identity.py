"""Identity overlay policy. Source: deploy/overlays/blak/identity.yaml."""

from __future__ import annotations

from pathlib import Path

from blak_profiles import load_profile

IDENTITY_REL = "deploy/overlays/blak/identity.yaml"
REQUIRED_IDP = "nubus"
REQUIRED_PROTOCOL = "oidc"


def identity_config(root: Path) -> dict:
    profile = load_profile(root / IDENTITY_REL)
    section = profile.get("identity") or {}
    return section if isinstance(section, dict) else {}


def baseline_idp(root: Path) -> str:
    return str(identity_config(root).get("idp") or "")


def idp_failures(root: Path) -> list[str]:
    cfg = identity_config(root)
    failed: list[str] = []
    if cfg.get("idp") != REQUIRED_IDP:
        failed.append("idp")
    if cfg.get("protocol") != REQUIRED_PROTOCOL:
        failed.append("protocol")
    return failed
