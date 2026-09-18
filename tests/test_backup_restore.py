"""BW-012: backup inventory, restore order, rehearsal checklist, RPO/RTO stub."""

from __future__ import annotations

import unittest

from repo import exists, read


class TestBackupRestorePlan(unittest.TestCase):
    def test_runbook_lists_stores(self):
        self.assertTrue(exists("docs/runbooks/backup-restore.md"))
        text = read("docs/runbooks/backup-restore.md")
        for store in ("PostgreSQL", "S3", "LDAP", "encryption keys"):
            self.assertIn(store, text, store)

    def test_restore_order_defined(self):
        text = read("docs/runbooks/backup-restore.md")
        self.assertIn("## Restore order", text)
        self.assertIn("abort if keys missing", text.lower())
        self.assertIn("Identity", text)

    def test_rehearsal_checklist_exists(self):
        text = read("docs/runbooks/backup-restore.md")
        self.assertIn("## Rehearsal checklist", text)
        self.assertIn("- [ ]", text)
        self.assertIn("BW-045", text)
        self.assertIn("BW-055", text)

    def test_rpo_rto_not_faked_as_accepted(self):
        text = read("docs/runbooks/backup-restore.md")
        self.assertIn("pending owner accept", text)
        log = read("docs/governance/decision-log.md")
        self.assertIn("RPO/RTO", log)
        self.assertIn("pending", log.lower())
        self.assertNotIn("Owner accepts RPO/RTO assumptions: yes", text)


if __name__ == "__main__":
    unittest.main()
