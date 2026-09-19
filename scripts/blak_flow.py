"""Blak Flow: live automation engine re-export plus policy helper."""

from __future__ import annotations

import sys
from pathlib import Path

_ENGINE_DIR = Path(__file__).resolve().parents[1] / "services" / "automation"
if str(_ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(_ENGINE_DIR))

from engine import (  # noqa: E402
    DRIVE_ACTIONS,
    LIVE_CONNECTORS,
    SITES_ACTIONS,
    STARTER_TYPES,
    DriveAdapter,
    FlowError,
    SitesAdapter,
    create_flow,
    create_store,
    default_connectors,
    get_flow,
    list_flows,
    list_runs,
    match_starter,
    set_enabled,
    trigger,
)

__all__ = [
    "DRIVE_ACTIONS",
    "LIVE_CONNECTORS",
    "SITES_ACTIONS",
    "STARTER_TYPES",
    "DriveAdapter",
    "FlowError",
    "SitesAdapter",
    "create_flow",
    "create_store",
    "default_connectors",
    "get_flow",
    "list_flows",
    "list_runs",
    "match_starter",
    "set_enabled",
    "trigger",
]
