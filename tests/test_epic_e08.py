"""BW-E08: children with markers, labels, acyclic deps, milestone M4."""

from __future__ import annotations

import sys
import unittest

from epic_assert import assert_epic
from repo import ROOT

sys.path.insert(0, str(ROOT / "scripts"))
from blak_backlog import load_manifest  # noqa: E402


class TestEpicE08(unittest.TestCase):
    def test_epic_contract(self):
        assert_epic(self, "BW-E08")
        by_id = {item["id"]: item for item in load_manifest(ROOT)["issues"]}
        self.assertEqual(by_id["BW-E08"]["milestone"], "M4")
        self.assertEqual(by_id["BW-E08"]["area"], "operations")
        self.assertEqual(by_id["BW-E08"]["priority"], "P1")
        self.assertEqual(
            by_id["BW-E08"]["children"],
            ["BW-043", "BW-044", "BW-045", "BW-046", "BW-047", "BW-048"],
        )


if __name__ == "__main__":
    unittest.main()
