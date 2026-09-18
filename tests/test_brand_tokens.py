"""BW-013: brand token placeholder, provenance register, no fake assets."""

from __future__ import annotations

import json
import unittest

from repo import exists, read


class TestBrandTokens(unittest.TestCase):
    def test_tokens_file_present(self):
        self.assertTrue(exists("brand/tokens.json"))
        tokens = json.loads(read("brand/tokens.json"))
        self.assertEqual(tokens["status"], "placeholder")
        self.assertTrue(all(v is None for v in tokens["color"].values()))
        self.assertTrue(all(v is None for v in tokens["logo"].values()))

    def test_provenance_explains_empty_state(self):
        self.assertTrue(exists("brand/PROVENANCE.md"))
        text = read("brand/PROVENANCE.md")
        self.assertIn("_none yet_", text)
        self.assertIn("placeholder", text.lower())
        self.assertIn("needs:cultural-review", text)

    def test_contributing_references_cultural_review(self):
        text = read("CONTRIBUTING.md")
        self.assertIn("needs:cultural-review", text)
        self.assertIn("Do not invent community endorsements or cultural assets", text)

    def test_no_fake_assets_committed(self):
        from repo import ROOT

        names = {p.name for p in (ROOT / "brand").iterdir() if p.is_file()}
        self.assertEqual(names, {"tokens.json", "PROVENANCE.md"})
        for path in (ROOT / "brand").rglob("*"):
            if path.suffix.lower() in {".png", ".svg", ".jpg", ".ai"}:
                self.fail(f"unexpected asset {path}")


if __name__ == "__main__":
    unittest.main()
