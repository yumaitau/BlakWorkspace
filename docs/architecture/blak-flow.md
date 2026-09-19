# Blak Flow (BW-052)

Blak Flow is **live**. `blak_flow_status` returns `live`.

It is the in-workspace automation product: a signed-in user lists and creates flows. Each flow has a starter (event or schedule) plus ordered steps that call at least two live connectors (Drive and Sites). A flow can be enabled or disabled. A matching trigger writes a persisted run/activity record the user can read.

## Engine

Canonical engine: `services/automation/engine.py` (imported via `scripts/blak_flow.py`). Portal runtime: `apps/portal/flow-engine.js` (same create / enable / trigger / history model). Tests drive the Python engine from an empty store; CI also runs the Node engine demo path.

Connectors are small in-process adapters over Drive (write/read/list files) and Sites (create/list pages). They mutate adapter state so run outcomes are real, not a hardcoded blob.

## UI (Power Automate / Apps Script IA)

Served at `/flow` inside Blak Portal (same waffle, search, account chip, grouped nav):

- **My flows** — list, enable/disable, run
- **Create** — builder: starter + Drive step + Sites step
- **Activity** — run history

Unauthenticated `/flow` redirects to `/login` (Blak ID OIDC). Flow is advertised as live in the waffle and left nav; it is not tagged Soon.

## Non-goals

Desktop/RPA, natural-language authoring, third-party connector marketplace, custom Apps Script, webhook-as-product beyond the engine.
