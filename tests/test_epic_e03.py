"""BW-E03: children with markers, labels, acyclic deps, milestone M1."""

from __future__ import annotations

import sys
import unittest

from epic_assert import assert_epic
from repo import ROOT

sys.path.insert(0, str(ROOT / "scripts"))
from blak_backlog import load_manifest  # noqa: E402


class TestEpicE03(unittest.TestCase):
    def test_epic_contract(self):
        assert_epic(self, "BW-E03")
        by_id = {item["id"]: item for item in load_manifest(ROOT)["issues"]}
        self.assertEqual(by_id["BW-E03"]["milestone"], "M1")
        self.assertEqual(by_id["BW-E03"]["area"], "brand")
        self.assertEqual(by_id["BW-E03"]["priority"], "P0")
        self.assertEqual(
            by_id["BW-E03"]["children"],
            ["BW-013", "BW-014", "BW-015", "BW-016", "BW-017", "BW-018"],
        )


if __name__ == "__main__":
    unittest.main()
