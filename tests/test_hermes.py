"""BW-056 / ADR-011: Hermes opt-in, control plane, document corpus, default-deny."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists, read

sys.path.insert(0, str(ROOT / "scripts"))

from blak_hermes import (  # noqa: E402
    CORPUS,
    HERMES_INTERNAL_ID,
    HERMES_LABEL,
    corpus_sources,
    document_search_enabled,
    hermes_enabled,
    load_control_plane,
    validate_control_plane,
    validate_hermes,
)
from blak_profiles import load_profile, parse_profile, validate_profiles  # noqa: E402


def _profile_text(**hermes: object) -> str:
    lines = ["hermes:"]
    for key, val in hermes.items():
        if isinstance(val, bool):
            rendered = "true" if val else "false"
        else:
            rendered = str(val)
        lines.append(f"  {key}: {rendered}")
    return "\n".join(lines) + "\n"


class TestHermesControlPlane(unittest.TestCase):
    def test_registration_file(self):
        data = load_control_plane(ROOT)
        self.assertEqual(validate_control_plane(data), [])
        self.assertEqual(data["id"], HERMES_INTERNAL_ID)
        self.assertEqual(data["label"], HERMES_LABEL)
        self.assertIs(data["defaultEnabled"], False)
        self.assertIs(data["gateway"]["publish"], False)
        self.assertEqual(data["controlPlane"], "nubus")
        self.assertEqual(data["mcpPath"], "/api/hermes/mcp")
        for name in CORPUS:
            self.assertIn(name, data["corpus"])

    def test_cli_loads_control_plane(self):
        errors = validate_control_plane(load_control_plane(ROOT))
        self.assertEqual(errors, [])


class TestHermesProfiles(unittest.TestCase):
    def test_defaults_off(self):
        for name in ("eval", "staging", "prod"):
            profile = load_profile(ROOT / "deploy/profiles" / name / "values.yaml")
            self.assertFalse(hermes_enabled(profile), name)
            self.assertFalse(document_search_enabled(profile), name)
            self.assertEqual(corpus_sources(profile), [])
            self.assertFalse(profile["hermes"]["publishGateway"], name)
            self.assertEqual(profile["hermes"]["inferenceProvider"], "owner-chosen")
        self.assertEqual(validate_profiles(ROOT), [])

    def test_eval_sketch_searches_all_corpus(self):
        profile = load_profile(ROOT / "deploy/profiles/eval/hermes.example.yaml")
        self.assertTrue(hermes_enabled(profile))
        self.assertTrue(document_search_enabled(profile))
        self.assertEqual(corpus_sources(profile), ["drive", "docs", "knowledge"])
        self.assertFalse(profile["knowledge"]["xwiki"])
        self.assertEqual(
            validate_hermes("eval-hermes", profile, require_deny=False), []
        )

    def test_public_unauth_fails(self):
        profile = parse_profile(
            _profile_text(
                enabled=True,
                allowPublicUnauthenticated=True,
                documentSearch=False,
                publishGateway=False,
            )
        )
        errors = validate_hermes("x", profile, require_deny=False)
        self.assertTrue(any("public unauthenticated" in e for e in errors), errors)

    def test_published_gateway_fails(self):
        profile = parse_profile(
            _profile_text(
                enabled=True,
                allowPublicUnauthenticated=False,
                documentSearch=False,
                publishGateway=True,
            )
        )
        errors = validate_hermes("x", profile, require_deny=False)
        self.assertTrue(any("cluster-local" in e for e in errors), errors)

    def test_document_search_requires_enabled(self):
        profile = parse_profile(
            _profile_text(
                enabled=False,
                allowPublicUnauthenticated=False,
                documentSearch=True,
                publishGateway=False,
            )
        )
        errors = validate_hermes("x", profile, require_deny=False)
        self.assertTrue(any("documentSearch requires" in e for e in errors), errors)

    def test_corpus_requires_document_search(self):
        profile = parse_profile(
            _profile_text(
                enabled=True,
                allowPublicUnauthenticated=False,
                documentSearch=False,
                publishGateway=False,
                corpusDrive=True,
            )
        )
        errors = validate_hermes("x", profile, require_deny=False)
        self.assertTrue(any("corpus flags require" in e for e in errors), errors)

    def test_external_inference_needs_opt_in(self):
        profile = parse_profile(
            _profile_text(
                enabled=True,
                allowPublicUnauthenticated=False,
                documentSearch=False,
                publishGateway=False,
                inferenceProvider="openai",
            )
        )
        errors = validate_hermes("x", profile, require_deny=False)
        self.assertTrue(any("allowExternalInference" in e for e in errors), errors)

    def test_knowledge_corpus_rejects_xwiki(self):
        text = (
            "knowledge:\n  xwiki: true\n  docmost: false\n"
            + _profile_text(
                enabled=True,
                allowPublicUnauthenticated=False,
                documentSearch=True,
                publishGateway=False,
                corpusKnowledge=True,
            )
        )
        profile = parse_profile(text)
        errors = validate_hermes("x", profile, require_deny=False)
        self.assertTrue(any("Docmost only" in e for e in errors), errors)


class TestHermesDocs(unittest.TestCase):
    def test_adr_and_runbook(self):
        adr = read("docs/adr/ADR-011.md")
        self.assertIn("Status: Accepted", adr)
        self.assertIn("Nubus", adr)
        self.assertIn("owner-chosen", adr)
        self.assertIn("Docmost", adr)
        self.assertTrue(exists("docs/runbooks/hermes.md"))
        self.assertTrue(exists("docs/architecture/hermes.md"))

    def test_portal_tile_default_off(self):
        portal = read("deploy/overlays/blak/portal-labels.example.yaml")
        self.assertIn("id: hermes", portal)
        self.assertIn("Blak Hermes", portal)
        self.assertIn("enabled: false", portal)

    def test_shipped_cli_includes_control_plane(self):
        text = read("scripts/validate-manifest.py")
        self.assertIn("load_control_plane", text)
        self.assertIn("validate_control_plane", text)


if __name__ == "__main__":
    unittest.main()
