"""Shared checks for epic acceptance criteria against the shipped manifest."""

from __future__ import annotations

import sys
from pathlib import Path

from repo import ROOT, read

sys.path.insert(0, str(ROOT / "scripts"))

from blak_backlog import load_manifest, validate_tree  # noqa: E402


def assert_epic(test, epic_id: str) -> None:
    errors = validate_tree(ROOT)
    test.assertEqual(errors, [], msg="\n".join(errors))
    data = load_manifest(ROOT)
    by_id = {item["id"]: item for item in data["issues"]}
    test.assertIn(epic_id, by_id)
    epic = by_id[epic_id]
    test.assertEqual(epic["type"], "epic")
    test.assertIn("type:epic", epic["labels"])
    test.assertIn(f"priority:{epic['priority']}", epic["labels"])
    test.assertIn(f"area:{epic['area']}", epic["labels"])
    test.assertTrue(epic.get("milestone"))
    children = epic.get("children") or []
    test.assertTrue(children, f"{epic_id} missing children")
    body = read(epic["body_path"])
    test.assertIn(f"<!-- blak-seed:{epic_id} -->", body)
    for child_id in children:
        test.assertIn(child_id, by_id, child_id)
        child = by_id[child_id]
        test.assertEqual(child.get("epic"), epic_id, child_id)
        child_body = read(child["body_path"])
        test.assertIn(f"<!-- blak-seed:{child_id} -->", child_body)
        test.assertTrue(child.get("labels"))
