"""BW-017: en-AU locale defaults from shipped overlay files."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_brand import REQUIRED_LOCALE, locale_mismatches, overlay_locales  # noqa: E402


class TestEnAuLocale(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/brand/locale.md"))

    def test_overlays_are_en_au(self):
        locales = overlay_locales(ROOT)
        self.assertGreaterEqual(len(locales), 2)
        self.assertEqual(locale_mismatches(ROOT), [])
        for rel, value in locales.items():
            self.assertEqual(value, REQUIRED_LOCALE, rel)


if __name__ == "__main__":
    unittest.main()
