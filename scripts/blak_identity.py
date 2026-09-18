"""Identity overlay policy. Source: deploy/overlays/blak/identity.yaml."""

from __future__ import annotations

from pathlib import Path

from blak_profiles import load_profile

IDENTITY_REL = "deploy/overlays/blak/identity.yaml"
REQUIRED_IDP = "nubus"
REQUIRED_PROTOCOL = "oidc"
REQUIRED_PERSONAS = (
    "site-owner",
    "site-admin",
    "member",
    "contributor",
    "reader",
)


def identity_config(root: Path) -> dict:
    profile = load_profile(root / IDENTITY_REL)
    section = profile.get("identity") or {}
    return section if isinstance(section, dict) else {}


def baseline_idp(root: Path) -> str:
    return str(identity_config(root).get("idp") or "")


def personas(root: Path) -> list[str]:
    raw = str(identity_config(root).get("personas") or "")
    return [part.strip() for part in raw.split(",") if part.strip()]


def persona_failures(root: Path) -> list[str]:
    got = personas(root)
    return [name for name in REQUIRED_PERSONAS if name not in got]


def idp_failures(root: Path) -> list[str]:
    cfg = identity_config(root)
    failed: list[str] = []
    if cfg.get("idp") != REQUIRED_IDP:
        failed.append("idp")
    if cfg.get("protocol") != REQUIRED_PROTOCOL:
        failed.append("protocol")
    return failed

def entra_federation_enabled(root: Path) -> bool:
    return bool(identity_config(root).get("entraFederation"))

REQUIRED_LIFECYCLE = ("join", "move", "leave")


def identity_lifecycle(root: Path) -> list[str]:
    raw = str(identity_config(root).get("lifecycle") or "")
    return [part.strip() for part in raw.split(",") if part.strip()]


def lifecycle_failures(root: Path) -> list[str]:
    got = identity_lifecycle(root)
    return [step for step in REQUIRED_LIFECYCLE if step not in got]

def guest_default(root: Path) -> str:
    return str(identity_config(root).get("guestDefault") or "")

REQUIRED_AUDIT_EVENTS = (
    "authn.success",
    "authn.failure",
    "member.add",
    "member.remove",
    "role.change",
)


def identity_audit_events(root: Path) -> list[str]:
    raw = str(identity_config(root).get("auditEvents") or "")
    return [part.strip() for part in raw.split(",") if part.strip()]


def audit_event_failures(root: Path) -> list[str]:
    got = identity_audit_events(root)
    return [name for name in REQUIRED_AUDIT_EVENTS if name not in got]
