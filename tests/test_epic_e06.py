"""BW-E06: children with markers, labels, acyclic deps, milestone M3."""

from __future__ import annotations

import sys
import unittest

from epic_assert import assert_epic
from repo import ROOT

sys.path.insert(0, str(ROOT / "scripts"))
from blak_backlog import load_manifest  # noqa: E402


class TestEpicE06(unittest.TestCase):
    def test_epic_contract(self):
        assert_epic(self, "BW-E06")
        by_id = {item["id"]: item for item in load_manifest(ROOT)["issues"]}
        self.assertEqual(by_id["BW-E06"]["milestone"], "M3")
        self.assertEqual(by_id["BW-E06"]["area"], "collaboration")
        self.assertEqual(by_id["BW-E06"]["priority"], "P1")
        self.assertEqual(
            by_id["BW-E06"]["children"],
            ["BW-031", "BW-032", "BW-033", "BW-034", "BW-035", "BW-036", "BW-055"],
        )


if __name__ == "__main__":
    unittest.main()
