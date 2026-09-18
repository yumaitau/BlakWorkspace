"""BW-020: pilot personas from shipped identity overlay."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_identity import REQUIRED_PERSONAS, persona_failures, personas  # noqa: E402


class TestPilotPersonas(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/identity/pilot-personas.md"))

    def test_required_personas_present(self):
        got = personas(ROOT)
        for name in REQUIRED_PERSONAS:
            self.assertIn(name, got)
        self.assertEqual(persona_failures(ROOT), [])


if __name__ == "__main__":
    unittest.main()
