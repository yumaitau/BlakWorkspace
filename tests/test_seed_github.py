"""Tests drive shipped plan_seed / apply_seed / seed CLI."""

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

from blak_backlog import load_manifest, seed_map_path  # noqa: E402
from blak_seed import (  # noqa: E402
    MemoryGitHub,
    RemoteIssue,
    format_plan,
    load_seed_map,
    plan_seed,
    run_seed,
)
from test_validate_manifest import _full_stub_manifest  # noqa: E402


class TestSeedGithub(unittest.TestCase):
    def test_dry_run_prints_creates_and_does_not_write_seed_map(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = _full_stub_manifest(root)
            (root / "docs/backlog").mkdir(parents=True, exist_ok=True)
            (root / "docs/backlog/manifest.json").write_text(
                json.dumps(data), encoding="utf-8"
            )
            map_path = seed_map_path(root)
            self.assertFalse(map_path.exists())
            existing = RemoteIssue(
                number=2,
                title="[BW-055] Replace XWiki with Docmost for Blak Knowledge",
                body="<!-- blak-seed:BW-055 -->\n",
            )
            client = MemoryGitHub(issues=[existing])
            code, text, seed_map = run_seed(
                root=root, dry_run=True, client=client
            )
            self.assertEqual(code, 0, text)
            self.assertIn("DRY-RUN: planned creates:", text)
            self.assertIn("CREATE BW-001:", text)
            self.assertIn("SKIP BW-055: marker present on #2", text)
            self.assertIn("seed-map not written (dry-run)", text)
            self.assertIsNone(seed_map)
            self.assertFalse(map_path.exists())

    def test_apply_creates_only_missing_and_records_real_numbers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = _full_stub_manifest(root)
            (root / "docs/backlog/manifest.json").write_text(
                json.dumps(data), encoding="utf-8"
            )
            existing = RemoteIssue(
                number=7,
                title="[BW-055] already seeded",
                body="<!-- blak-seed:BW-055 -->\n",
            )
            client = MemoryGitHub(issues=[existing])
            code, text, seed_map = run_seed(
                root=root, dry_run=False, client=client
            )
            self.assertEqual(code, 0, text)
            self.assertIsNotNone(seed_map)
            issues = seed_map["issues"]
            self.assertEqual(issues["BW-055"], 7)
            self.assertNotIn(7, [c.number for c in client.created])
            created_ids = {
                extract_id(c.body): c.number for c in client.created
            }
            self.assertNotIn("BW-055", created_ids)
            self.assertIn("BW-001", created_ids)
            self.assertEqual(issues["BW-001"], created_ids["BW-001"])
            # Second apply creates nothing new.
            before = list(client.created)
            code2, text2, seed_map2 = run_seed(
                root=root, dry_run=False, client=client
            )
            self.assertEqual(code2, 0, text2)
            self.assertEqual(len(client.created), len(before))
            self.assertIn("planned creates: 0", text2)
            self.assertEqual(seed_map2["issues"]["BW-055"], 7)

    def test_apply_does_not_assign_people(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = _full_stub_manifest(root)
            (root / "docs/backlog/manifest.json").write_text(
                json.dumps(data), encoding="utf-8"
            )
            client = MemoryGitHub()
            run_seed(root=root, dry_run=False, client=client)
            self.assertTrue(client.created)
            for issue in client.created:
                self.assertEqual(issue.assignees, [])

    def test_seed_map_load_empty_when_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "seed-map.json"
            self.assertEqual(load_seed_map(path), {"issues": {}})

    def test_format_plan_mentions_skip_and_create(self):
        data = load_manifest(ROOT)
        remote = [
            RemoteIssue(number=2, title="x", body="<!-- blak-seed:BW-055 -->\n")
        ]
        plan = plan_seed(data, ROOT, remote)
        text = format_plan(plan, dry_run=True)
        self.assertIn("SKIP BW-055", text)
        self.assertTrue(plan.creates or plan.skips)

    def test_committed_seed_map_has_no_invented_numbers(self):
        committed_map = json.loads(
            (ROOT / "docs/backlog/seed-map.json").read_text(encoding="utf-8")
        )
        issues = committed_map.get("issues") or {}
        for iid, number in issues.items():
            self.assertIsInstance(number, int, iid)
            self.assertGreater(number, 0, iid)

    def test_cli_rejects_dry_run_and_apply_together(self):
        proc = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "seed-github.py"),
                "--dry-run",
                "--apply",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 2)
        self.assertIn("choose either --dry-run or --apply", proc.stderr)


def extract_id(body: str) -> str:
    from blak_backlog import extract_markers

    markers = extract_markers(body)
    return markers[0]


if __name__ == "__main__":
    unittest.main()
