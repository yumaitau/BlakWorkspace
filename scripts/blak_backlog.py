"""Load and validate docs/backlog/manifest.json."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

MARKER_RE = re.compile(r"<!--\s*blak-seed:([A-Z0-9-]+)\s*-->")
ID_RE = re.compile(r"^BW-(?:E)?\d{2,3}$")
REQUIRED_TASK_IDS = [f"BW-{n:03d}" for n in range(1, 56)]
REQUIRED_EPIC_IDS = [f"BW-E{n:02d}" for n in range(1, 10)]
REQUIRED_FIELDS = (
    "id",
    "title",
    "type",
    "priority",
    "area",
    "milestone",
    "depends_on",
    "body_path",
    "labels",
)


def repo_root(start: Path | None = None) -> Path:
    cur = (start or Path(__file__).resolve()).parent
    for candidate in [cur, *cur.parents]:
        if (candidate / "docs" / "backlog").is_dir() or (
            candidate / ".github" / "workflows" / "validate.yml"
        ).is_file():
            return candidate
    raise FileNotFoundError("cannot locate repository root")


def manifest_path(root: Path) -> Path:
    return root / "docs" / "backlog" / "manifest.json"


def seed_map_path(root: Path) -> Path:
    return root / "docs" / "backlog" / "seed-map.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_manifest(root: Path) -> dict:
    data = load_json(manifest_path(root))
    if not isinstance(data, dict) or not isinstance(data.get("issues"), list):
        raise ValueError("manifest must be an object with an issues array")
    return data


def extract_markers(text: str) -> list[str]:
    return MARKER_RE.findall(text or "")


def _index(issues: list[dict]) -> dict[str, dict]:
    return {item["id"]: item for item in issues if "id" in item}


def _cycles(issues: list[dict]) -> list[str]:
    graph = {
        item["id"]: list(item.get("depends_on") or [])
        for item in issues
        if "id" in item
    }
    visiting: set[str] = set()
    seen: set[str] = set()
    found: list[list[str]] = []

    def dfs(node: str, stack: list[str]) -> None:
        if node in visiting:
            loop_at = stack.index(node)
            found.append(stack[loop_at:] + [node])
            return
        if node in seen:
            return
        visiting.add(node)
        stack.append(node)
        for nxt in graph.get(node, []):
            if nxt in graph:
                dfs(nxt, stack)
        stack.pop()
        visiting.remove(node)
        seen.add(node)

    for node in graph:
        dfs(node, [])
    return [" -> ".join(path) for path in found]


def validate_manifest(data: dict, root: Path) -> list[str]:
    """Return human-readable errors. Empty list means the manifest is valid."""
    errors: list[str] = []
    issues = data.get("issues")
    if not isinstance(issues, list) or not issues:
        return ["manifest issues must be a non-empty array"]

    ids: list[str] = []
    for i, item in enumerate(issues):
        prefix = f"issues[{i}]"
        if not isinstance(item, dict):
            errors.append(f"{prefix}: not an object")
            continue
        for field in REQUIRED_FIELDS:
            if field not in item:
                errors.append(f"{prefix}: missing {field}")
        iid = item.get("id")
        if not isinstance(iid, str) or not ID_RE.match(iid):
            errors.append(f"{prefix}: invalid id {iid!r}")
            continue
        ids.append(iid)
        if not isinstance(item.get("title"), str) or not item["title"].strip():
            errors.append(f"{iid}: empty title")
        if not isinstance(item.get("depends_on"), list):
            errors.append(f"{iid}: depends_on must be a list")
        if not isinstance(item.get("labels"), list) or not item["labels"]:
            errors.append(f"{iid}: labels must be a non-empty list")
        body_path = item.get("body_path")
        if not isinstance(body_path, str) or not body_path:
            errors.append(f"{iid}: body_path required")
            continue
        full = root / body_path
        if not full.is_file():
            errors.append(f"{iid}: missing path {body_path}")
            continue
        text = full.read_text(encoding="utf-8")
        markers = extract_markers(text)
        if iid not in markers:
            errors.append(f"{iid}: {body_path} missing marker <!-- blak-seed:{iid} -->")

    seen: set[str] = set()
    for iid in ids:
        if iid in seen:
            errors.append(f"duplicate id {iid}")
        seen.add(iid)

    by_id = _index(issues)
    for item in issues:
        if not isinstance(item, dict) or "id" not in item:
            continue
        iid = item["id"]
        for dep in item.get("depends_on") or []:
            if dep not in by_id:
                errors.append(f"{iid}: depends_on unknown id {dep}")
        if item.get("type") == "epic":
            children = item.get("children") or []
            if not children:
                errors.append(f"{iid}: epic missing children")
            for child in children:
                if child not in by_id:
                    errors.append(f"{iid}: child {child} not in manifest")
                else:
                    child_epic = by_id[child].get("epic")
                    if child_epic != iid:
                        errors.append(f"{child}: epic {child_epic!r} does not match {iid}")

    for required in REQUIRED_TASK_IDS:
        if required not in by_id:
            errors.append(f"manifest missing required id {required}")
    for required in REQUIRED_EPIC_IDS:
        if required not in by_id:
            errors.append(f"manifest missing required id {required}")

    e06 = by_id.get("BW-E06")
    if e06 and "BW-055" not in (e06.get("children") or []):
        errors.append("BW-E06 must list BW-055 as a child")

    errors.extend(f"dependency cycle: {c}" for c in _cycles(issues))
    return errors


def validate_tree(root: Path | None = None) -> list[str]:
    root = root or repo_root()
    try:
        data = load_manifest(root)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return [f"cannot load manifest: {exc}"]
    return validate_manifest(data, root)


def main_validate(argv: list[str] | None = None) -> int:
    del argv
    root = repo_root()
    errors = validate_tree(root)
    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1
    data = load_manifest(root)
    print(f"OK: manifest valid ({len(data['issues'])} issues)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main_validate())
