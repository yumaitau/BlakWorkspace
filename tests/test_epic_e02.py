"""BW-E02: children with markers, labels, acyclic deps, milestone M1."""

from __future__ import annotations

import sys
import unittest

from epic_assert import assert_epic
from repo import ROOT

sys.path.insert(0, str(ROOT / "scripts"))
from blak_backlog import load_manifest  # noqa: E402


class TestEpicE02(unittest.TestCase):
    def test_epic_contract(self):
        assert_epic(self, "BW-E02")
        by_id = {item["id"]: item for item in load_manifest(ROOT)["issues"]}
        self.assertEqual(by_id["BW-E02"]["milestone"], "M1")
        self.assertEqual(by_id["BW-E02"]["area"], "platform")
        self.assertEqual(by_id["BW-E02"]["priority"], "P0")
        self.assertEqual(
            by_id["BW-E02"]["children"],
            ["BW-007", "BW-008", "BW-009", "BW-010", "BW-011", "BW-012"],
        )


if __name__ == "__main__":
    unittest.main()
