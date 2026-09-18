"""Blak Hermes: opt-in sovereign AI runtime and document-search control plane."""

from __future__ import annotations

import json
from pathlib import Path

HERMES_INTERNAL_ID = "hermes"
HERMES_LABEL = "Blak Hermes"
CONTROL_PLANE_REL = "deploy/control-plane/hermes.json"

# Public cloud inference is not the Blak default. Owner may opt in explicitly.
EXTERNAL_INFERENCE = frozenset(
    {"openai", "openai-codex", "anthropic", "gemini", "azure-openai"}
)
SOVEREIGN_INFERENCE = frozenset({"owner-chosen", "local", "au-local"})

CORPUS = {
    "drive": {"flag": "corpusDrive", "label": "Blak Drive", "upstream": "Nextcloud"},
    "docs": {"flag": "corpusDocs", "label": "Blak Docs", "upstream": "Collabora"},
    "knowledge": {
        "flag": "corpusKnowledge",
        "label": "Blak Knowledge",
        "upstream": "Docmost",
    },
}


def hermes_section(profile: dict) -> dict:
    section = profile.get("hermes")
    return section if isinstance(section, dict) else {}


def hermes_enabled(profile: dict) -> bool:
    return bool(hermes_section(profile).get("enabled"))


def document_search_enabled(profile: dict) -> bool:
    return bool(hermes_section(profile).get("documentSearch"))


def public_unauthenticated_hermes(profile: dict) -> bool:
    return bool(hermes_section(profile).get("allowPublicUnauthenticated"))


def publish_gateway(profile: dict) -> bool:
    return bool(hermes_section(profile).get("publishGateway"))


def corpus_sources(profile: dict) -> list[str]:
    hermes = hermes_section(profile)
    return [name for name, spec in CORPUS.items() if hermes.get(spec["flag"])]


def inference_provider(profile: dict) -> str:
    raw = hermes_section(profile).get("inferenceProvider") or ""
    return str(raw).strip().lower()


def allow_external_inference(profile: dict) -> bool:
    return bool(hermes_section(profile).get("allowExternalInference"))


def load_control_plane(root: Path) -> dict:
    path = root / CONTROL_PLANE_REL
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("control plane registration must be an object")
    return data


def validate_control_plane(data: dict) -> list[str]:
    errors: list[str] = []
    if data.get("id") != HERMES_INTERNAL_ID:
        errors.append("control plane id must be hermes")
    if data.get("label") != HERMES_LABEL:
        errors.append("control plane label must be Blak Hermes")
    if data.get("defaultEnabled") is not False:
        errors.append("Hermes must default to disabled")
    gateway = data.get("gateway") or {}
    if gateway.get("publish") is not False:
        errors.append("Hermes gateway must not be published")
    if data.get("controlPlane") != "nubus":
        errors.append("Hermes control plane must be nubus")
    corpus = data.get("corpus") or []
    for name in CORPUS:
        if name not in corpus:
            errors.append(f"control plane corpus missing {name}")
    return errors


def validate_hermes(name: str, profile: dict, *, require_deny: bool) -> list[str]:
    """Fail closed: default off, no public gateway, document search is opt-in."""
    errors: list[str] = []
    hermes = hermes_section(profile)
    if require_deny:
        if "enabled" not in hermes:
            errors.append(f"{name}: hermes.enabled must be explicit false")
        if "allowPublicUnauthenticated" not in hermes:
            errors.append(f"{name}: hermes.allowPublicUnauthenticated must be explicit false")
        if "documentSearch" not in hermes:
            errors.append(f"{name}: hermes.documentSearch must be explicit false")
        if "publishGateway" not in hermes:
            errors.append(f"{name}: hermes.publishGateway must be explicit false")
        if hermes.get("enabled"):
            errors.append(f"{name}: Hermes must stay off on default Blak profiles")
        if hermes.get("documentSearch"):
            errors.append(f"{name}: document search must stay off on default Blak profiles")
    if public_unauthenticated_hermes(profile):
        errors.append(f"{name}: public unauthenticated Hermes is forbidden (default-deny)")
    if publish_gateway(profile):
        errors.append(f"{name}: Hermes gateway must stay cluster-local (publishGateway false)")
    if document_search_enabled(profile) and not hermes_enabled(profile):
        errors.append(f"{name}: hermes.documentSearch requires hermes.enabled")
    sources = corpus_sources(profile)
    if sources and not document_search_enabled(profile):
        errors.append(
            f"{name}: Hermes corpus flags require hermes.documentSearch"
        )
    if "knowledge" in sources:
        knowledge = profile.get("knowledge") or {}
        if knowledge.get("xwiki"):
            errors.append(
                f"{name}: Hermes Knowledge corpus is Docmost only; xwiki must be false"
            )
    provider = inference_provider(profile)
    if hermes_enabled(profile) and provider in EXTERNAL_INFERENCE:
        if not allow_external_inference(profile):
            errors.append(
                f"{name}: external inference {provider} needs hermes.allowExternalInference"
            )
    optional = profile.get("optional") or {}
    if "hermes" in optional and bool(optional.get("hermes")) != hermes_enabled(profile):
        errors.append(f"{name}: optional.hermes must match hermes.enabled")
    return errors
