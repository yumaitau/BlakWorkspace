"""BW-038: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_governance import stewardship_fields  # noqa: E402


class TestStewardship(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/governance/stewardship-metadata.md"))

    def test_policy(self):
        self.assertEqual(stewardship_fields(ROOT), ['owner', 'classification', 'country'])


if __name__ == "__main__":
    unittest.main()
