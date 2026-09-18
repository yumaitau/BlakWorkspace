"""BW-E05: children with markers, labels, acyclic deps, milestone M2."""

from __future__ import annotations

import sys
import unittest

from epic_assert import assert_epic
from repo import ROOT

sys.path.insert(0, str(ROOT / "scripts"))
from blak_backlog import load_manifest  # noqa: E402


class TestEpicE05(unittest.TestCase):
    def test_epic_contract(self):
        assert_epic(self, "BW-E05")
        by_id = {item["id"]: item for item in load_manifest(ROOT)["issues"]}
        self.assertEqual(by_id["BW-E05"]["milestone"], "M2")
        self.assertEqual(by_id["BW-E05"]["area"], "drive")
        self.assertEqual(by_id["BW-E05"]["priority"], "P0")
        self.assertEqual(
            by_id["BW-E05"]["children"],
            ["BW-025", "BW-026", "BW-027", "BW-028", "BW-029", "BW-030"],
        )


if __name__ == "__main__":
    unittest.main()
