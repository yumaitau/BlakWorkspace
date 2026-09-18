"""Tests drive shipped validate_manifest / validate_tree / CLI."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from blak_backlog import (  # noqa: E402
    REQUIRED_TASK_IDS,
    load_manifest,
    validate_manifest,
    validate_tree,
)


def _write_issue(root: Path, iid: str, title: str) -> str:
    rel = f"docs/backlog/issues/{iid}.md"
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"<!-- blak-seed:{iid} -->\n# [{iid}] {title}\n",
        encoding="utf-8",
    )
    return rel


def _issue(
    iid: str,
    title: str,
    *,
    typ: str = "task",
    epic: str | None = "BW-E01",
    depends_on: list[str] | None = None,
    children: list[str] | None = None,
    body_path: str | None = None,
) -> dict:
    item = {
        "id": iid,
        "title": title,
        "type": typ,
        "priority": "P0",
        "area": "platform",
        "milestone": "M0",
        "depends_on": depends_on or [],
        "body_path": body_path or f"docs/backlog/issues/{iid}.md",
        "labels": ["priority:P0", "area:platform", f"type:{typ}"],
    }
    if epic:
        item["epic"] = epic
    if children is not None:
        item["children"] = children
    return item


def _full_stub_manifest(root: Path) -> dict:
    """Minimal valid catalog covering required ids, written into root."""
    issues = []
    children = {f"BW-E{n:02d}": [] for n in range(1, 10)}
    epic_of = {}
    # Map tasks onto epics similar to the real catalog.
    mapping = {
        "BW-E01": list(range(1, 7)),
        "BW-E02": list(range(7, 13)),
        "BW-E03": list(range(13, 19)),
        "BW-E04": list(range(19, 25)),
        "BW-E05": list(range(25, 31)),
        "BW-E06": list(range(31, 37)) + [55],
        "BW-E07": list(range(37, 43)),
        "BW-E08": list(range(43, 49)),
        "BW-E09": list(range(49, 55)),
    }
    for epic, nums in mapping.items():
        for n in nums:
            iid = f"BW-{n:03d}"
            epic_of[iid] = epic
            children[epic].append(iid)
    for n in range(1, 10):
        eid = f"BW-E{n:02d}"
        _write_issue(root, eid, f"Epic {eid}")
        issues.append(
            _issue(
                eid,
                f"Epic {eid}",
                typ="epic",
                epic=None,
                children=children[eid],
            )
        )
    for n in range(1, 56):
        iid = f"BW-{n:03d}"
        _write_issue(root, iid, f"Task {iid}")
        issues.append(_issue(iid, f"Task {iid}", epic=epic_of[iid]))
    return {"version": 1, "repo": "yumaitau/BlakWorkspace", "issues": issues}


class TestRealManifest(unittest.TestCase):
    def test_shipped_manifest_validates(self):
        errors = validate_tree(ROOT)
        self.assertEqual(errors, [], msg="\n".join(errors))

    def test_includes_bw_001_through_055(self):
        data = load_manifest(ROOT)
        ids = {item["id"] for item in data["issues"]}
        missing = [iid for iid in REQUIRED_TASK_IDS if iid not in ids]
        self.assertEqual(missing, [])

    def test_includes_bw_055_under_e06(self):
        data = load_manifest(ROOT)
        by_id = {item["id"]: item for item in data["issues"]}
        self.assertIn("BW-055", by_id)
        self.assertIn("BW-055", by_id["BW-E06"]["children"])
        body = (ROOT / by_id["BW-055"]["body_path"]).read_text(encoding="utf-8")
        self.assertIn("<!-- blak-seed:BW-055 -->", body)

    def test_cli_matches_ci_command(self):
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "validate-manifest.py")],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(
            "OK: manifest valid" in proc.stdout
            or "OK: manifest and profiles valid" in proc.stdout,
            proc.stdout,
        )


class TestValidatorRejects(unittest.TestCase):
    def test_duplicate_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = _full_stub_manifest(root)
            data["issues"].append(dict(data["issues"][-1]))
            errors = validate_manifest(data, root)
            self.assertTrue(any("duplicate id" in e for e in errors), errors)

    def test_cycle(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = _full_stub_manifest(root)
            by_id = {item["id"]: item for item in data["issues"]}
            by_id["BW-001"]["depends_on"] = ["BW-002"]
            by_id["BW-002"]["depends_on"] = ["BW-001"]
            errors = validate_manifest(data, root)
            self.assertTrue(any("cycle" in e for e in errors), errors)

    def test_missing_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = _full_stub_manifest(root)
            by_id = {item["id"]: item for item in data["issues"]}
            by_id["BW-001"]["body_path"] = "docs/backlog/issues/does-not-exist.md"
            errors = validate_manifest(data, root)
            self.assertTrue(any("missing path" in e for e in errors), errors)

    def test_missing_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = _full_stub_manifest(root)
            path = root / "docs/backlog/issues/BW-001.md"
            path.write_text("# no marker here\n", encoding="utf-8")
            errors = validate_manifest(data, root)
            self.assertTrue(any("missing marker" in e for e in errors), errors)

    def test_unknown_dependency(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = _full_stub_manifest(root)
            by_id = {item["id"]: item for item in data["issues"]}
            by_id["BW-001"]["depends_on"] = ["BW-999"]
            errors = validate_manifest(data, root)
            self.assertTrue(any("unknown id BW-999" in e for e in errors), errors)


if __name__ == "__main__":
    unittest.main()
