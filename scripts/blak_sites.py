"""Sites platform seed: RBAC, templates, pages, lists, search trim, providers."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROLES = ("site-owner", "site-admin", "member", "contributor", "reader")
SSO_IDP = "nubus"
FILE_PROVIDER = "nextcloud"
KNOWLEDGE_PROVIDER = "docmost"

PERMISSIONS = {
    "site-owner": {
        "site.create",
        "site.pages.read",
        "site.pages.create",
        "site.pages.edit",
        "site.pages.delete",
        "site.pages.publish",
        "site.documents.read",
        "site.documents.write",
        "site.lists.read",
        "site.lists.write",
        "site.members.manage",
        "site.settings.manage",
    },
    "site-admin": {
        "site.create",
        "site.pages.read",
        "site.pages.create",
        "site.pages.edit",
        "site.pages.delete",
        "site.pages.publish",
        "site.documents.read",
        "site.documents.write",
        "site.lists.read",
        "site.lists.write",
        "site.members.manage",
    },
    "contributor": {
        "site.pages.read",
        "site.pages.create",
        "site.pages.edit",
        "site.documents.read",
        "site.documents.write",
        "site.lists.read",
        "site.lists.write",
    },
    "member": {
        "site.pages.read",
        "site.documents.read",
        "site.lists.read",
        "site.lists.write",
    },
    "reader": {
        "site.pages.read",
        "site.documents.read",
        "site.lists.read",
    },
}

TEMPLATES = {
    "blank": {"nav": ["home", "pages"], "pages": []},
    "team": {"nav": ["home", "pages", "documents", "lists", "team"], "pages": ["Home"]},
    "project": {
        "nav": ["home", "pages", "documents", "lists", "tasks", "team"],
        "pages": ["Home", "Brief"],
    },
    "department": {
        "nav": ["home", "pages", "documents", "lists", "knowledge"],
        "pages": ["Home"],
    },
    "knowledge": {
        "nav": ["home", "pages", "knowledge", "documents"],
        "pages": ["Home"],
    },
    "program": {
        "nav": ["home", "pages", "documents", "lists", "tasks"],
        "pages": ["Home"],
    },
}

DEEP_LINKS = {
    "knowledge": "docmost",
    "project": "openproject",
    "chat": "element",
    "meet": "jitsi",
}

SITES_REL = "deploy/overlays/blak/sites.yaml"
OPENAPI_REL = "deploy/sites/openapi.yaml"
CHART_VALUES_REL = "deploy/sites/chart/values.yaml"


def can(role: str, perm: str) -> bool:
    return perm in PERMISSIONS.get(role, set())


def api_denies(role: str, perm: str) -> bool:
    """Frontend-hidden controls are still denied by the API."""
    return not can(role, perm)


@dataclass
class Page:
    title: str
    blocks: list[dict] = field(default_factory=list)
    state: str = "draft"
    revisions: list[dict] = field(default_factory=list)


@dataclass
class Library:
    title: str
    file_provider: str = FILE_PROVIDER
    metadata: dict[str, dict] = field(default_factory=dict)


@dataclass
class ListStore:
    name: str
    fields: dict[str, str]
    rows: list[dict] = field(default_factory=list)
    lookups: dict[str, str] = field(default_factory=dict)
    next_id: int = 1


@dataclass
class Site:
    slug: str
    title: str
    template: str
    members: dict[str, str]
    pages: dict[str, Page] = field(default_factory=dict)
    library: Library = field(default_factory=lambda: Library(title="Documents"))
    lists: dict[str, ListStore] = field(default_factory=dict)
    audit: list[dict] = field(default_factory=list)


class SitesStore:
    def __init__(self) -> None:
        self.sites: dict[str, Site] = {}

    def create_site(
        self, actor_role: str, slug: str, title: str, template: str, owner: str
    ) -> Site:
        if not can(actor_role, "site.create"):
            raise PermissionError("unauthorized")
        if template not in TEMPLATES:
            raise ValueError("unknown template")
        if slug in self.sites:
            raise ValueError("slug taken")
        site = Site(slug=slug, title=title, template=template, members={owner: "site-owner"})
        for page_title in TEMPLATES[template]["pages"]:
            site.pages[page_title.lower()] = Page(title=page_title, state="published")
        site.audit.append(
            {
                "type": "member.add",
                "actor": owner,
                "subject": owner,
                "role": "site-owner",
            }
        )
        self.sites[slug] = site
        return site

    def set_member(self, actor_role: str, slug: str, user: str, role: str) -> None:
        if not can(actor_role, "site.members.manage"):
            raise PermissionError("unauthorized")
        site = self.sites[slug]
        site.members[user] = role
        site.audit.append({"type": "role.change", "subject": user, "role": role})

    def save_page(
        self, role: str, slug: str, key: str, title: str, blocks: list[dict]
    ) -> Page:
        if not (can(role, "site.pages.edit") or can(role, "site.pages.create")):
            raise PermissionError("unauthorized")
        site = self.sites[slug]
        page = site.pages.get(key) or Page(title=title)
        page.title = title
        page.blocks = deepcopy(blocks)
        page.state = "draft"
        site.pages[key] = page
        return page

    def publish_page(self, role: str, slug: str, key: str) -> Page:
        if not can(role, "site.pages.publish"):
            raise PermissionError("unauthorized")
        page = self.sites[slug].pages[key]
        page.revisions.append({"blocks": deepcopy(page.blocks), "title": page.title})
        page.state = "published"
        return page

    def restore_page(self, role: str, slug: str, key: str, index: int) -> Page:
        if not can(role, "site.pages.publish"):
            raise PermissionError("unauthorized")
        page = self.sites[slug].pages[key]
        snapshot = page.revisions[index]
        page.blocks = deepcopy(snapshot["blocks"])
        page.title = snapshot["title"]
        page.state = "published"
        return page

    def reader_view(self, slug: str, key: str) -> dict:
        page = self.sites[slug].pages[key]
        if page.state == "published":
            return {"state": "published", "blocks": deepcopy(page.blocks)}
        if page.revisions:
            latest = page.revisions[-1]
            return {"state": "published", "blocks": deepcopy(latest["blocks"])}
        return {"state": page.state, "blocks": []}

    def collabora_open(self, role: str, slug: str, file_id: str) -> dict:
        if not can(role, "site.documents.read"):
            raise PermissionError("unauthorized")
        lib = self.sites[slug].library
        meta = lib.metadata[file_id]
        return {
            "editor": "collabora",
            "storage": lib.file_provider,
            "fileId": file_id,
            "metadata": dict(meta),
        }

    def put_document_metadata(
        self, role: str, slug: str, file_id: str, meta: dict
    ) -> None:
        if not can(role, "site.documents.write"):
            raise PermissionError("unauthorized")
        lib = self.sites[slug].library
        if lib.file_provider != FILE_PROVIDER:
            raise ValueError("FileProvider must be nextcloud")
        stored = dict(meta)
        stored["storage"] = FILE_PROVIDER
        lib.metadata[file_id] = stored

    def add_list(self, role: str, slug: str, name: str, fields: dict[str, str]) -> ListStore:
        if not can(role, "site.lists.write"):
            raise PermissionError("unauthorized")
        store = ListStore(name=name, fields=dict(fields))
        self.sites[slug].lists[name] = store
        return store

    def add_row(self, role: str, slug: str, name: str, row: dict) -> dict:
        if not can(role, "site.lists.write"):
            raise PermissionError("unauthorized")
        store = self.sites[slug].lists[name]
        stored = {k: row.get(k) for k in store.fields}
        stored["_id"] = store.next_id
        store.next_id += 1
        store.rows.append(stored)
        return stored

    def change_schema(self, role: str, slug: str, name: str, fields: dict[str, str]) -> None:
        if not can(role, "site.lists.write"):
            raise PermissionError("unauthorized")
        store = self.sites[slug].lists[name]
        store.fields = dict(fields)
        for row in store.rows:
            for key in store.fields:
                row.setdefault(key, None)

    def add_lookup(self, slug: str, list_name: str, field: str, target: str) -> None:
        self.sites[slug].lists[list_name].lookups[field] = target

    def delete_row(self, slug: str, list_name: str, row_id: int) -> None:
        store = self.sites[slug].lists[list_name]
        for other in self.sites[slug].lists.values():
            for field, target in other.lookups.items():
                if target != list_name:
                    continue
                for existing in other.rows:
                    if existing.get(field) == row_id:
                        raise ValueError("lookup would break")
        store.rows = [row for row in store.rows if row.get("_id") != row_id]

    def search(self, actor: str, slug: str, query: str) -> list[dict]:
        site = self.sites[slug]
        role = site.members.get(actor)
        if not role:
            return []
        hits: list[dict] = []
        needle = query.lower()
        if can(role, "site.pages.read"):
            for key, page in site.pages.items():
                if page.state == "published" and needle in page.title.lower():
                    hits.append({"type": "page", "id": key})
        if can(role, "site.documents.read"):
            for file_id, meta in site.library.metadata.items():
                title = str(meta.get("title") or file_id)
                if needle in title.lower():
                    hits.append({"type": "document", "id": file_id})
        if can(role, "site.lists.read"):
            for name in site.lists:
                if needle in name.lower():
                    hits.append({"type": "list", "id": name})
        return hits

    def audit_export(self, slug: str) -> list[dict]:
        events = []
        for event in self.sites[slug].audit:
            events.append({k: v for k, v in event.items() if k != "body"})
        return events


def deep_link(kind: str) -> str:
    if kind not in DEEP_LINKS:
        raise KeyError(kind)
    return DEEP_LINKS[kind]


def _load(path: Path) -> dict:
    from blak_profiles import load_profile

    return load_profile(path)


def helm_platforms(root: Path) -> list[str]:
    values = _load(root / CHART_VALUES_REL)
    raw = str(values.get("platforms") or "")
    return [part.strip() for part in raw.split(",") if part.strip()]


def mandatory_egress(root: Path) -> bool:
    values = _load(root / CHART_VALUES_REL)
    egress = values.get("egress") or {}
    if isinstance(egress, dict):
        return bool(egress.get("mandatory"))
    return True


def openapi_operations(root: Path) -> set[str]:
    text = (root / OPENAPI_REL).read_text(encoding="utf-8")
    ops_set: set[str] = set()
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("operationId:"):
            ops_set.add(stripped.split(":", 1)[1].strip())
    return ops_set


def dispatch(store: SitesStore, role: str, operation_id: str, **kwargs: Any) -> Any:
    """Non-UI client uses the same operations as the UI."""
    if operation_id == "createSite":
        return store.create_site(role, kwargs["slug"], kwargs["title"], kwargs["template"], kwargs["owner"])
    if operation_id == "addMember":
        return store.set_member(role, kwargs["slug"], kwargs["user"], kwargs["memberRole"])
    if operation_id == "createList":
        return store.add_list(role, kwargs["slug"], kwargs["name"], kwargs["fields"])
    if operation_id == "createListItem":
        return store.add_row(role, kwargs["slug"], kwargs["name"], kwargs["row"])
    raise KeyError(operation_id)


def sites_config(root: Path) -> dict:
    section = _load(root / SITES_REL).get("sites") or {}
    return section if isinstance(section, dict) else {}


def identity_provider(root: Path) -> str:
    return str(sites_config(root).get("identityProvider") or "")


def file_provider(root: Path) -> str:
    return str(sites_config(root).get("fileProvider") or "")


def validate_sites_profile(name: str, profile: dict, *, require_deny: bool) -> list[str]:
    errors: list[str] = []
    sites = profile.get("sites") or {}
    if not isinstance(sites, dict):
        return [f"{name}: sites must be a mapping"]
    idp = str(sites.get("identityProvider") or "")
    fp = str(sites.get("fileProvider") or "")
    if require_deny:
        if sites.get("enabled"):
            errors.append(f"{name}: Sites must stay off on default Blak profiles")
        if "enabled" not in sites:
            errors.append(f"{name}: sites.enabled must be explicit false")
        if idp != SSO_IDP:
            errors.append(f"{name}: Sites IdentityProvider must be {SSO_IDP}")
        if fp != FILE_PROVIDER:
            errors.append(f"{name}: Sites FileProvider must be {FILE_PROVIDER}")
    if sites.get("allowPublicForms"):
        errors.append(f"{name}: public/anonymous Sites forms are forbidden by default")
    if idp and idp != SSO_IDP:
        errors.append(f"{name}: Sites IdentityProvider must be {SSO_IDP}")
    if fp and fp != FILE_PROVIDER:
        errors.append(f"{name}: Sites FileProvider must be {FILE_PROVIDER}")
    if sites.get("knowledgeProvider") == "xwiki":
        errors.append(f"{name}: Sites KnowledgeProvider must not be xwiki")
    return errors
