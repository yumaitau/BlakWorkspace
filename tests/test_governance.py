"""BW-005: governance process doc, label, ADR-007, no fabricated assets."""

from __future__ import annotations

import json
import unittest

from repo import exists, read


class TestIndigenousGovernance(unittest.TestCase):
    def test_process_doc_present(self):
        self.assertTrue(exists("docs/governance/indigenous-governance.md"))
        text = read("docs/governance/indigenous-governance.md")
        self.assertIn("needs:cultural-review", text)
        self.assertIn("Who can approve", text)
        self.assertIn("Escalation", text)
        self.assertIn("ADR-007", text)
        self.assertNotIn("we are endorsed", text.lower())

    def test_label_documented(self):
        contrib = read("CONTRIBUTING.md")
        self.assertIn("needs:cultural-review", contrib)
        self.assertIn("docs/governance/indigenous-governance.md", contrib)

    def test_adr_007_proposed(self):
        adr = read("docs/adr/ADR-007.md")
        self.assertIn("Status: Proposed", adr)
        self.assertIn("## Context", adr)
        self.assertIn("## Decision", adr)
        self.assertIn("## Consequences", adr)
        self.assertIn("needs:cultural-review", adr)

    def test_no_fabricated_cultural_assets(self):
        tokens = json.loads(read("brand/tokens.json"))
        self.assertEqual(tokens.get("status"), "placeholder")
        for group in ("color", "typography", "logo"):
            for value in tokens[group].values():
                self.assertIsNone(value)
        provenance = read("brand/PROVENANCE.md")
        self.assertIn("_none yet_", provenance)
        self.assertIn("Do not invent community endorsements", provenance)

    def test_decision_log_stub(self):
        self.assertTrue(exists("docs/governance/decision-log.md"))
        log = read("docs/governance/decision-log.md")
        self.assertIn("pending", log.lower())
        self.assertNotRegex(log, r"(?i)owner accepted on 20")


if __name__ == "__main__":
    unittest.main()
