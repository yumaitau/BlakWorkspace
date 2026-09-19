"""Blak Flow engine: starters, ordered connector steps, persisted runs.

Pure functions plus in-process Drive/Sites adapters. No HTTP, OIDC, or Kubernetes.
"""

from __future__ import annotations

import time
import uuid
from typing import Any

LIVE_CONNECTORS = ("drive", "sites")
STARTER_TYPES = ("event", "schedule")
DRIVE_ACTIONS = ("write_file", "read_file", "list_files")
SITES_ACTIONS = ("create_page", "list_pages")


class FlowError(ValueError):
    """User-facing Flow validation or run error."""


class DriveAdapter:
    """In-process Drive connector. Mutates `files` so callers can read outcomes."""

    def __init__(self, files: dict[str, str] | None = None) -> None:
        self.files: dict[str, str] = files if files is not None else {}

    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        payload = _payload(context)
        if action == "write_file":
            path = str(params.get("path") or payload.get("path") or "")
            if not path:
                return {"ok": False, "connector": "drive", "action": action, "error": "path required"}
            content = params.get("content")
            if content is None:
                content = payload.get("content", "")
            text = str(content)
            self.files[path] = text
            return {
                "ok": True,
                "connector": "drive",
                "action": action,
                "path": path,
                "bytes": len(text.encode("utf-8")),
            }
        if action == "read_file":
            path = str(params.get("path") or payload.get("path") or "")
            if path not in self.files:
                return {"ok": False, "connector": "drive", "action": action, "error": "not found", "path": path}
            return {
                "ok": True,
                "connector": "drive",
                "action": action,
                "path": path,
                "content": self.files[path],
            }
        if action == "list_files":
            prefix = str(params.get("prefix") or "")
            names = sorted(p for p in self.files if p.startswith(prefix))
            return {"ok": True, "connector": "drive", "action": action, "files": names}
        return {"ok": False, "connector": "drive", "action": action, "error": f"unknown action {action}"}


class SitesAdapter:
    """In-process Sites/Knowledge connector. Mutates `pages` so callers can read outcomes."""

    def __init__(self, pages: list[dict[str, Any]] | None = None) -> None:
        self.pages: list[dict[str, Any]] = pages if pages is not None else []

    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        payload = _payload(context)
        if action == "create_page":
            title = str(params.get("title") or payload.get("path") or "Untitled")
            body = params.get("body")
            if body is None:
                body = payload.get("content", "")
            page = {"id": str(len(self.pages) + 1), "title": title, "body": str(body)}
            self.pages.append(page)
            return {
                "ok": True,
                "connector": "sites",
                "action": action,
                "pageId": page["id"],
                "title": title,
            }
        if action == "list_pages":
            return {"ok": True, "connector": "sites", "action": action, "pages": list(self.pages)}
        return {"ok": False, "connector": "sites", "action": action, "error": f"unknown action {action}"}


def default_connectors() -> dict[str, Any]:
    return {"drive": DriveAdapter(), "sites": SitesAdapter()}


def create_store() -> dict[str, Any]:
    return {"flows": {}, "runs": []}


def create_flow(
    store: dict[str, Any],
    *,
    owner: str,
    name: str,
    starter: dict[str, Any],
    steps: list[dict[str, Any]],
) -> dict[str, Any]:
    owner = str(owner or "").strip()
    name = str(name or "").strip()
    if not owner:
        raise FlowError("owner required")
    if not name:
        raise FlowError("name required")
    starter_obj = _validate_starter(starter)
    step_objs = _validate_steps(steps)
    now = _now()
    flow = {
        "id": uuid.uuid4().hex,
        "owner": owner,
        "name": name,
        "starter": starter_obj,
        "steps": step_objs,
        "enabled": False,
        "createdAt": now,
        "updatedAt": now,
    }
    store["flows"][flow["id"]] = flow
    return flow


def set_enabled(store: dict[str, Any], flow_id: str, enabled: bool) -> dict[str, Any]:
    flow = get_flow(store, flow_id)
    flow["enabled"] = bool(enabled)
    flow["updatedAt"] = _now()
    return flow


def get_flow(store: dict[str, Any], flow_id: str) -> dict[str, Any]:
    flow = store["flows"].get(flow_id)
    if not flow:
        raise FlowError(f"unknown flow {flow_id}")
    return flow


def list_flows(store: dict[str, Any], owner: str | None = None) -> list[dict[str, Any]]:
    flows = list(store["flows"].values())
    if owner is not None:
        flows = [f for f in flows if f["owner"] == owner]
    return sorted(flows, key=lambda f: f["createdAt"])


def match_starter(starter: dict[str, Any], event: dict[str, Any]) -> bool:
    if not event:
        return False
    if starter.get("type") == "schedule":
        return event.get("type") == "schedule" and (
            not starter.get("name") or event.get("name") == starter.get("name") or event.get("name") == "manual"
        )
    if starter.get("type") == "event":
        return event.get("type") == "event" and event.get("name") == starter.get("name")
    return False


def trigger(
    store: dict[str, Any],
    flow_id: str,
    event: dict[str, Any],
    connectors: dict[str, Any] | None = None,
) -> dict[str, Any]:
    flow = get_flow(store, flow_id)
    if not flow["enabled"]:
        raise FlowError("flow is disabled")
    if not match_starter(flow["starter"], event):
        raise FlowError("starter did not match event")
    conns = connectors if connectors is not None else default_connectors()
    context: dict[str, Any] = {"payload": _payload({"payload": event.get("payload")}), "event": event, "last": None}
    step_records: list[dict[str, Any]] = []
    status = "ok"
    for step in flow["steps"]:
        adapter = conns.get(step["connector"])
        if adapter is None or not hasattr(adapter, "execute"):
            outcome = {"ok": False, "error": f"missing connector {step['connector']}"}
        else:
            outcome = adapter.execute(step["action"], step.get("params") or {}, context)
        record = {
            "id": step["id"],
            "connector": step["connector"],
            "action": step["action"],
            "outcome": outcome,
        }
        step_records.append(record)
        context["last"] = outcome
        if not outcome.get("ok"):
            status = "error"
            break
    run = {
        "id": uuid.uuid4().hex,
        "flowId": flow["id"],
        "flowName": flow["name"],
        "owner": flow["owner"],
        "event": {
            "type": event.get("type"),
            "name": event.get("name"),
            "payload": event.get("payload"),
        },
        "status": status,
        "steps": step_records,
        "startedAt": _now(),
    }
    store["runs"].append(run)
    return run


def list_runs(store: dict[str, Any], flow_id: str | None = None) -> list[dict[str, Any]]:
    runs = list(store["runs"])
    if flow_id is not None:
        runs = [r for r in runs if r["flowId"] == flow_id]
    return list(reversed(runs))


def _payload(context: dict[str, Any]) -> dict[str, Any]:
    raw = context.get("payload") if isinstance(context, dict) else None
    return raw if isinstance(raw, dict) else {}


def _validate_starter(starter: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(starter, dict):
        raise FlowError("starter required")
    kind = str(starter.get("type") or "")
    if kind not in STARTER_TYPES:
        raise FlowError("starter type must be event or schedule")
    name = str(starter.get("name") or "").strip()
    if kind == "event" and not name:
        raise FlowError("event starter needs a name")
    if kind == "schedule" and not name:
        name = "manual"
    return {"type": kind, "name": name}


def _validate_steps(steps: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not isinstance(steps, list) or len(steps) < 2:
        raise FlowError("flow needs at least two ordered steps")
    cleaned: list[dict[str, Any]] = []
    connectors: set[str] = set()
    for index, raw in enumerate(steps):
        if not isinstance(raw, dict):
            raise FlowError(f"step {index} invalid")
        connector = str(raw.get("connector") or "").strip()
        action = str(raw.get("action") or "").strip()
        if connector not in LIVE_CONNECTORS:
            raise FlowError(f"step {index}: connector must be drive or sites")
        if connector == "drive" and action not in DRIVE_ACTIONS:
            raise FlowError(f"step {index}: unknown drive action")
        if connector == "sites" and action not in SITES_ACTIONS:
            raise FlowError(f"step {index}: unknown sites action")
        params = raw.get("params") if isinstance(raw.get("params"), dict) else {}
        connectors.add(connector)
        cleaned.append(
            {
                "id": str(raw.get("id") or f"s{index + 1}"),
                "connector": connector,
                "action": action,
                "params": dict(params),
            }
        )
    if "drive" not in connectors:
        raise FlowError("flow must include a Drive step")
    if "sites" not in connectors:
        raise FlowError("flow must include a second live connector (Sites)")
    return cleaned


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
