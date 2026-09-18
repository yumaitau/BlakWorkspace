"""BW-053: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_pilot import ai_default  # noqa: E402
from blak_hermes import hermes_enabled, document_search_enabled  # noqa: E402
from blak_profiles import load_profile  # noqa: E402


class TestAiPolicy(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/architecture/ai-policy.md"))

    def test_policy(self):
        self.assertEqual(ai_default(ROOT), 'disabled')
        for name in ('eval', 'staging', 'prod'):
            profile = load_profile(ROOT / 'deploy/profiles' / name / 'values.yaml')
            self.assertFalse(hermes_enabled(profile), name)
            self.assertFalse(document_search_enabled(profile), name)


if __name__ == "__main__":
    unittest.main()
