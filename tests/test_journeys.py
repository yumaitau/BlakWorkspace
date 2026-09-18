"""BW-036: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_collab import pilot_journeys  # noqa: E402


class TestJourneys(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/pilot/journeys.md"))

    def test_policy(self):
        self.assertEqual(pilot_journeys(ROOT), ['drive-docs', 'chat-meet', 'knowledge'])


if __name__ == "__main__":
    unittest.main()
