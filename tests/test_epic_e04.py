"""BW-E04: children with markers, labels, acyclic deps, milestone M2."""

from __future__ import annotations

import sys
import unittest

from epic_assert import assert_epic
from repo import ROOT

sys.path.insert(0, str(ROOT / "scripts"))
from blak_backlog import load_manifest  # noqa: E402


class TestEpicE04(unittest.TestCase):
    def test_epic_contract(self):
        assert_epic(self, "BW-E04")
        by_id = {item["id"]: item for item in load_manifest(ROOT)["issues"]}
        self.assertEqual(by_id["BW-E04"]["milestone"], "M2")
        self.assertEqual(by_id["BW-E04"]["area"], "identity")
        self.assertEqual(by_id["BW-E04"]["priority"], "P0")
        self.assertEqual(
            by_id["BW-E04"]["children"],
            ["BW-019", "BW-020", "BW-021", "BW-022", "BW-023", "BW-024"],
        )


if __name__ == "__main__":
    unittest.main()
