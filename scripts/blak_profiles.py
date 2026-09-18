"""Parse Blak deploy profile stubs (stdlib only; no PyYAML)."""

from __future__ import annotations

from pathlib import Path


def _as_bool(raw: str) -> bool:
    value = raw.split("#", 1)[0].strip().lower()
    if value in {"true", "yes", "on"}:
        return True
    if value in {"false", "no", "off"}:
        return False
    raise ValueError(f"not a boolean: {raw!r}")


def parse_profile(text: str) -> dict:
    """Parse the simple profile YAML used in deploy/profiles/*/values.yaml."""
    data: dict = {"knowledge": {}, "optional": {}}
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


def load_profile(path: Path) -> dict:
    return parse_profile(path.read_text(encoding="utf-8"))


def iter_profile_paths(root: Path) -> list[Path]:
    return sorted((root / "deploy" / "profiles").glob("*/values.yaml"))


REQUIRED_PROFILES = ("eval", "staging", "prod")


def validate_profiles(root: Path) -> list[str]:
    """Fail if default profiles are missing or dual-enable Knowledge engines."""
    errors: list[str] = []
    for name in REQUIRED_PROFILES:
        path = root / "deploy" / "profiles" / name / "values.yaml"
        if not path.is_file():
            errors.append(f"missing profile {path.relative_to(root)}")
            continue
        profile = load_profile(path)
        xwiki, docmost = knowledge_flags(profile)
        if xwiki:
            errors.append(f"{name}: knowledge.xwiki must be false in Blak defaults")
        if both_knowledge_enabled(profile):
            errors.append(f"{name}: knowledge.xwiki and knowledge.docmost must not both be true")
        if docmost and xwiki:
            errors.append(f"{name}: Docmost must not be co-enabled with XWiki")
    return errors
