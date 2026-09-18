"""BW-E09: children with markers, labels, acyclic deps, milestone M5."""

from __future__ import annotations

import sys
import unittest

from epic_assert import assert_epic
from repo import ROOT

sys.path.insert(0, str(ROOT / "scripts"))
from blak_backlog import load_manifest  # noqa: E402


class TestEpicE09(unittest.TestCase):
    def test_epic_contract(self):
        assert_epic(self, "BW-E09")
        by_id = {item["id"]: item for item in load_manifest(ROOT)["issues"]}
        self.assertEqual(by_id["BW-E09"]["milestone"], "M5")
        self.assertEqual(by_id["BW-E09"]["area"], "platform")
        self.assertEqual(by_id["BW-E09"]["priority"], "P1")
        self.assertEqual(
            by_id["BW-E09"]["children"],
            ["BW-049", "BW-050", "BW-051", "BW-052", "BW-053", "BW-054"],
        )


if __name__ == "__main__":
    unittest.main()
