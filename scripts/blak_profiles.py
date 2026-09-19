"""Parse Blak deploy profile stubs (stdlib only; no PyYAML)."""

from __future__ import annotations

from pathlib import Path

from blak_hermes import validate_hermes
from blak_sites import validate_sites_profile


def _as_bool(raw: str) -> bool:
    value = raw.split("#", 1)[0].strip().lower()
    if value in {"true", "yes", "on"}:
        return True
    if value in {"false", "no", "off"}:
        return False
    raise ValueError(f"not a boolean: {raw!r}")


def parse_profile(text: str) -> dict:
    """Parse the simple profile YAML used in deploy/profiles/*/values.yaml."""
    data: dict = {"knowledge": {}, "optional": {}, "hermes": {}, "sites": {}}
    section = None
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        line = raw.split("#", 1)[0].rstrip()
        if indent == 0 and line.endswith(":") and ":" != line.strip()[-1:]:
            section = line[:-1].strip()
            data.setdefault(section, {})
            continue
        if indent == 0 and ":" in line:
            key, val = line.split(":", 1)
            key, val = key.strip(), val.strip()
            section = None
            if val == "":
                section = key
                data.setdefault(section, {})
            else:
                data[key] = _maybe(val)
            continue
        if indent > 0 and ":" in line:
            key, val = line.split(":", 1)
            key, val = key.strip(), val.strip()
            target = section or "knowledge"
            data.setdefault(target, {})
            if isinstance(data[target], dict):
                data[target][key] = _maybe(val)
    return data


def _maybe(val: str):
    try:
        return _as_bool(val)
    except ValueError:
        return val.strip().strip('"').strip("'")


def knowledge_flags(profile: dict) -> tuple[bool, bool]:
    knowledge = profile.get("knowledge") or {}
    return bool(knowledge.get("xwiki")), bool(knowledge.get("docmost"))


def both_knowledge_enabled(profile: dict) -> bool:
    xwiki, docmost = knowledge_flags(profile)
    return xwiki and docmost


def public_unauthenticated_knowledge(profile: dict) -> bool:
    knowledge = profile.get("knowledge") or {}
    return bool(knowledge.get("allowPublicUnauthenticated"))


def load_profile(path: Path) -> dict:
    return parse_profile(path.read_text(encoding="utf-8"))


def iter_profile_paths(root: Path) -> list[Path]:
    return sorted((root / "deploy" / "profiles").glob("*/values.yaml"))


REQUIRED_PROFILES = ("eval", "staging", "prod")


def validate_profiles(root: Path) -> list[str]:
    """Fail if default profiles are missing, dual-enable Knowledge, or public-unauth."""
    errors: list[str] = []
    for name in REQUIRED_PROFILES:
        path = root / "deploy" / "profiles" / name / "values.yaml"
        if not path.is_file():
            errors.append(f"missing profile {path.relative_to(root)}")
            continue
        errors.extend(_check_profile(name, load_profile(path), require_deny=True))
    profiles_root = root / "deploy" / "profiles"
    if profiles_root.is_dir():
        for path in sorted(profiles_root.rglob("*.yaml")):
            rel = path.relative_to(root).as_posix()
            if path.name == "values.yaml" and path.parent.name in REQUIRED_PROFILES:
                continue
            errors.extend(_check_profile(rel, load_profile(path), require_deny=False))
    return errors


def _check_profile(name: str, profile: dict, *, require_deny: bool) -> list[str]:
    errors: list[str] = []
    knowledge = profile.get("knowledge") or {}
    xwiki, docmost = knowledge_flags(profile)
    if xwiki:
        errors.append(f"{name}: knowledge.xwiki must be false in Blak defaults")
    if both_knowledge_enabled(profile):
        errors.append(f"{name}: knowledge.xwiki and knowledge.docmost must not both be true")
    if public_unauthenticated_knowledge(profile):
        errors.append(
            f"{name}: public unauthenticated Knowledge is forbidden (default-deny)"
        )
    if require_deny and "allowPublicUnauthenticated" not in knowledge:
        errors.append(f"{name}: knowledge.allowPublicUnauthenticated must be explicit false")
    if docmost and xwiki:
        errors.append(f"{name}: Docmost must not be co-enabled with XWiki")
    errors.extend(validate_hermes(name, profile, require_deny=require_deny))
    errors.extend(validate_sites_profile(name, profile, require_deny=require_deny))
    return errors
