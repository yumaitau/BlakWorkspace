"""BW-018: accessibility baseline from shipped YAML via a11y_failures."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_brand import A11Y_REQUIRED, a11y_baseline, a11y_failures  # noqa: E402


class TestAccessibilityBaseline(unittest.TestCase):
    def test_doc_and_yaml(self):
        self.assertTrue(exists("docs/brand/accessibility.md"))
        self.assertTrue(exists("docs/brand/accessibility.yaml"))

    def test_required_flags_true(self):
        baseline = a11y_baseline(ROOT)
        for key in A11Y_REQUIRED:
            self.assertIs(baseline.get(key), True, key)
        self.assertEqual(a11y_failures(ROOT), [])


if __name__ == "__main__":
    unittest.main()
