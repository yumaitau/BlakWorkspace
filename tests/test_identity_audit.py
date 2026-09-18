"""BW-024: identity audit events from overlay."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_identity import REQUIRED_AUDIT_EVENTS, audit_event_failures  # noqa: E402


class TestIdentityAudit(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/identity/audit-evidence.md"))

    def test_required_events(self):
        self.assertEqual(audit_event_failures(ROOT), [])
        for name in REQUIRED_AUDIT_EVENTS:
            self.assertTrue(name)


if __name__ == "__main__":
    unittest.main()
