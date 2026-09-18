"""BW-E07: children with markers, labels, acyclic deps, milestone M4."""

from __future__ import annotations

import sys
import unittest

from epic_assert import assert_epic
from repo import ROOT

sys.path.insert(0, str(ROOT / "scripts"))
from blak_backlog import load_manifest  # noqa: E402


class TestEpicE07(unittest.TestCase):
    def test_epic_contract(self):
        assert_epic(self, "BW-E07")
        by_id = {item["id"]: item for item in load_manifest(ROOT)["issues"]}
        self.assertEqual(by_id["BW-E07"]["milestone"], "M4")
        self.assertEqual(by_id["BW-E07"]["area"], "governance")
        self.assertEqual(by_id["BW-E07"]["priority"], "P0")
        self.assertEqual(
            by_id["BW-E07"]["children"],
            ["BW-037", "BW-038", "BW-039", "BW-040", "BW-041", "BW-042"],
        )


if __name__ == "__main__":
    unittest.main()
