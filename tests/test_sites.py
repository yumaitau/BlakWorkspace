"""BW-E10: Sites foundation — RBAC, templates, pages, lists, search trim, Helm, OpenAPI."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists, read

sys.path.insert(0, str(ROOT / "scripts"))

from blak_profiles import load_profile, parse_profile, validate_profiles  # noqa: E402
from blak_sites import (  # noqa: E402
    DEEP_LINKS,
    FILE_PROVIDER,
    SSO_IDP,
    SitesStore,
    api_denies,
    can,
    deep_link,
    dispatch,
    file_provider,
    helm_platforms,
    identity_provider,
    mandatory_egress,
    openapi_operations,
    validate_sites_profile,
)


class TestSitesRbacAndSso(unittest.TestCase):
    def test_owner_creates_templated_site_reader_cannot(self):
        store = SitesStore()
        site = store.create_site("site-owner", "caring-for-country", "Caring for Country", "program", "ada")
        self.assertEqual(site.template, "program")
        self.assertIn("home", site.pages)
        self.assertEqual(site.members["ada"], "site-owner")
        with self.assertRaises(PermissionError):
            store.create_site("reader", "finance", "Finance", "department", "bob")

    def test_sso_nubus_and_api_denies_hidden_controls(self):
        self.assertEqual(identity_provider(ROOT), SSO_IDP)
        self.assertEqual(SSO_IDP, "nubus")
        self.assertTrue(api_denies("reader", "site.pages.edit"))
        self.assertTrue(api_denies("reader", "site.pages.publish"))
        self.assertTrue(api_denies("contributor", "site.members.manage"))
        self.assertFalse(can("reader", "site.lists.write"))
        store = SitesStore()
        store.create_site("site-admin", "hr", "HR", "team", "ada")
        with self.assertRaises(PermissionError):
            store.save_page("reader", "hr", "home", "Home", [{"type": "heading", "text": "x"}])


class TestSitesPagesLibraryLists(unittest.TestCase):
    def test_draft_publish_restore_readers_see_published(self):
        store = SitesStore()
        store.create_site("site-owner", "alpha", "Alpha", "project", "ada")
        v1 = [{"type": "heading", "text": "Brief v1"}]
        v2 = [{"type": "heading", "text": "Brief v2"}]
        store.save_page("site-owner", "alpha", "brief", "Brief", v1)
        store.publish_page("site-owner", "alpha", "brief")
        self.assertEqual(store.reader_view("alpha", "brief")["blocks"], v1)
        store.save_page("site-owner", "alpha", "brief", "Brief", v2)
        seen = store.reader_view("alpha", "brief")
        self.assertEqual(seen["state"], "published")
        self.assertEqual(seen["blocks"], v1)
        store.publish_page("site-owner", "alpha", "brief")
        self.assertEqual(store.reader_view("alpha", "brief")["blocks"], v2)
        store.restore_page("site-owner", "alpha", "brief", 0)
        self.assertEqual(store.reader_view("alpha", "brief")["blocks"], v1)

    def test_library_nextcloud_metadata_independent_collabora_open(self):
        store = SitesStore()
        store.create_site("site-owner", "docs", "Docs", "team", "ada")
        self.assertEqual(file_provider(ROOT), FILE_PROVIDER)
        self.assertEqual(store.sites["docs"].library.file_provider, FILE_PROVIDER)
        store.put_document_metadata(
            "site-owner",
            "docs",
            "file-1",
            {"title": "Policy", "classification": "official", "owner": "ada"},
        )
        meta = store.sites["docs"].library.metadata["file-1"]
        self.assertEqual(meta["storage"], FILE_PROVIDER)
        self.assertEqual(meta["title"], "Policy")
        opened = store.collabora_open("reader", "docs", "file-1")
        self.assertEqual(opened["editor"], "collabora")
        self.assertEqual(opened["storage"], FILE_PROVIDER)
        self.assertEqual(opened["metadata"]["classification"], "official")
        self.assertNotIn("bytes", opened)
        with self.assertRaises(PermissionError):
            store.put_document_metadata("reader", "docs", "file-2", {"title": "x"})

    def test_list_schema_preserves_rows_lookup_blocks_delete(self):
        store = SitesStore()
        store.create_site("site-owner", "ops", "Ops", "team", "ada")
        store.add_list("member", "ops", "contacts", {"name": "text"})
        row = store.add_row("member", "ops", "contacts", {"name": "Kim"})
        store.change_schema("member", "ops", "contacts", {"name": "text", "status": "choice"})
        kept = store.sites["ops"].lists["contacts"].rows[0]
        self.assertEqual(kept["name"], "Kim")
        self.assertIsNone(kept["status"])
        store.add_list("member", "ops", "actions", {"title": "text", "contact": "lookup"})
        store.add_lookup("ops", "actions", "contact", "contacts")
        store.add_row("member", "ops", "actions", {"title": "Call", "contact": row["_id"]})
        with self.assertRaises(ValueError):
            store.delete_row("ops", "contacts", row["_id"])
        self.assertEqual(len(store.sites["ops"].lists["contacts"].rows), 1)


class TestSitesSearchAuditProviders(unittest.TestCase):
    def test_search_never_returns_unreadable(self):
        store = SitesStore()
        store.create_site("site-owner", "board", "Board", "department", "ada")
        store.save_page("site-owner", "board", "home", "Secret page", [{"type": "richtext", "text": "x"}])
        store.publish_page("site-owner", "board", "home")
        store.put_document_metadata("site-owner", "board", "doc-9", {"title": "Secret doc"})
        store.add_list("site-owner", "board", "secret-list", {"n": "text"})
        self.assertTrue(store.search("reader", "board", "secret"))
        self.assertEqual(store.search("anonymous", "board", "secret"), [])
        self.assertEqual(store.search("stranger", "board", "home"), [])

    def test_provider_deep_links(self):
        self.assertEqual(deep_link("knowledge"), "docmost")
        self.assertEqual(deep_link("project"), "openproject")
        self.assertEqual(deep_link("chat"), "element")
        self.assertEqual(deep_link("meet"), "jitsi")
        self.assertEqual(set(DEEP_LINKS), {"knowledge", "project", "chat", "meet"})

    def test_audit_export_membership_omits_body(self):
        store = SitesStore()
        store.create_site("site-owner", "finance", "Finance", "department", "ada")
        store.set_member("site-admin", "finance", "bob", "reader")
        store.sites["finance"].audit.append(
            {"type": "document.write", "subject": "file-1", "body": "classified text"}
        )
        events = store.audit_export("finance")
        kinds = {e["type"] for e in events}
        self.assertIn("member.add", kinds)
        self.assertIn("role.change", kinds)
        for event in events:
            self.assertNotIn("body", event)


class TestSitesHelmOpenApiProfiles(unittest.TestCase):
    def test_helm_multi_arch_no_mandatory_egress(self):
        platforms = helm_platforms(ROOT)
        self.assertIn("linux/amd64", platforms)
        self.assertIn("linux/arm64", platforms)
        self.assertFalse(mandatory_egress(ROOT))
        values = read("deploy/sites/chart/values.yaml")
        self.assertIn("imageTag: TBD", values)
        self.assertNotIn("sha256:", values)
        self.assertTrue(exists("deploy/sites/chart/Chart.yaml"))
        self.assertTrue(exists("deploy/sites/chart/templates/deployment.yaml"))

    def test_openapi_non_ui_client_same_ops(self):
        ops = openapi_operations(ROOT)
        for name in ("createSite", "addMember", "createList", "createListItem"):
            self.assertIn(name, ops, name)
        store = SitesStore()
        dispatch(
            store,
            "site-owner",
            "createSite",
            slug="client",
            title="Client",
            template="blank",
            owner="ada",
        )
        dispatch(
            store,
            "site-admin",
            "addMember",
            slug="client",
            user="bob",
            memberRole="member",
        )
        dispatch(
            store,
            "member",
            "createList",
            slug="client",
            name="risks",
            fields={"title": "text"},
        )
        item = dispatch(
            store,
            "member",
            "createListItem",
            slug="client",
            name="risks",
            row={"title": "Flood"},
        )
        self.assertEqual(item["title"], "Flood")
        self.assertEqual(store.sites["client"].members["bob"], "member")
        with self.assertRaises(PermissionError):
            dispatch(
                store,
                "reader",
                "createList",
                slug="client",
                name="nope",
                fields={"title": "text"},
            )

    def test_default_profiles_sites_off(self):
        self.assertEqual(validate_profiles(ROOT), [])
        for name in ("eval", "staging", "prod"):
            profile = load_profile(ROOT / "deploy/profiles" / name / "values.yaml")
            self.assertFalse(profile["sites"]["enabled"], name)
            self.assertFalse(profile["sites"]["allowPublicForms"], name)
            self.assertEqual(profile["sites"]["identityProvider"], SSO_IDP, name)
            self.assertEqual(profile["sites"]["fileProvider"], FILE_PROVIDER, name)
            self.assertNotEqual(profile["sites"]["knowledgeProvider"], "xwiki", name)

    def test_public_forms_and_xwiki_fail_validation(self):
        public = parse_profile("sites:\n  enabled: true\n  allowPublicForms: true\n")
        errors = validate_sites_profile("x", public, require_deny=False)
        self.assertTrue(any("public" in e for e in errors), errors)
        xwiki = parse_profile(
            "sites:\n  enabled: true\n  allowPublicForms: false\n  knowledgeProvider: xwiki\n"
        )
        errors = validate_sites_profile("x", xwiki, require_deny=False)
        self.assertTrue(any("xwiki" in e for e in errors), errors)

    def test_adr_overlay_and_docs(self):
        adr = read("docs/adr/ADR-012.md")
        self.assertIn("Status: Accepted", adr)
        self.assertIn("Nubus", adr)
        self.assertIn("Nextcloud", adr)
        self.assertIn("Docmost", adr)
        self.assertIn("provider", adr.lower())
        self.assertTrue(exists("docs/architecture/sites.md"))
        self.assertTrue(exists("deploy/overlays/blak/sites.yaml"))
        overlay = read("deploy/overlays/blak/sites.yaml")
        self.assertIn("identityProvider: nubus", overlay)
        self.assertIn("fileProvider: nextcloud", overlay)
        self.assertIn("enabled: false", overlay)
        portal = read("deploy/overlays/blak/portal-labels.example.yaml")
        self.assertIn("id: sites", portal)
        self.assertIn("Blak Sites", portal)


if __name__ == "__main__":
    unittest.main()
