"""BW-E01: children with markers, labels, acyclic deps, milestone M0."""

from __future__ import annotations

import sys
import unittest

from epic_assert import assert_epic
from repo import ROOT

sys.path.insert(0, str(ROOT / "scripts"))
from blak_backlog import load_manifest  # noqa: E402


class TestEpicE01(unittest.TestCase):
    def test_epic_contract(self):
        assert_epic(self, "BW-E01")
        by_id = {item["id"]: item for item in load_manifest(ROOT)["issues"]}
        self.assertEqual(by_id["BW-E01"]["milestone"], "M0")
        self.assertEqual(by_id["BW-E01"]["area"], "platform")
        self.assertEqual(by_id["BW-E01"]["priority"], "P0")
        self.assertEqual(
            by_id["BW-E01"]["children"],
            ["BW-001", "BW-002", "BW-003", "BW-004", "BW-005", "BW-006"],
        )


if __name__ == "__main__":
    unittest.main()
