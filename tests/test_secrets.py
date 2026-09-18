"""BW-010: secrets runbook, CI policy, inventory, recovery."""

from __future__ import annotations

import unittest

from repo import exists, read


class TestSecretsManagement(unittest.TestCase):
    def test_runbook_published(self):
        self.assertTrue(exists("docs/runbooks/secrets.md"))
        text = read("docs/runbooks/secrets.md")
        self.assertIn("Secret classes", text)
        self.assertIn("Rotation", text)
        self.assertIn("Recovery", text)

    def test_inventory_lists_classes(self):
        text = read("docs/runbooks/secrets.md")
        for cls in ("Identity", "App DB", "Object storage", "OIDC", "Backup encryption"):
            self.assertIn(cls, text, cls)

    def test_recovery_steps_documented(self):
        text = read("docs/runbooks/secrets.md").lower()
        self.assertIn("rotate", text)
        self.assertIn("if a secret leaks", text)

    def test_ci_has_no_prod_secret_usage(self):
        workflow = read(".github/workflows/validate.yml")
        lowered = workflow.lower()
        self.assertNotIn("secrets.", lowered)
        self.assertNotIn("aws_secret", lowered)
        self.assertNotIn("helmfile apply", lowered)
        self.assertIn("validate-manifest.py", workflow)
        gitignore = read(".gitignore")
        self.assertIn(".env", gitignore)
        self.assertIn("*.secret", gitignore)


if __name__ == "__main__":
    unittest.main()
