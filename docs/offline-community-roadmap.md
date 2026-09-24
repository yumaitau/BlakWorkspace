# Offline community deployment roadmap

Accepted delivery order, 24 September 2026. These are delivery gates, not claims
that the homelab already provides every capability. Keep one Drive entry in the
portal; open documents, spreadsheets and slides from Drive in Collabora.

## 1. Offline foundation and community authority

Start with the [offline acceptance runbook](runbooks/offline-readiness.md).
The [local network setup](runbooks/local-network.md) supplies optional bundled DNS,
existing-DNS record export and local certificate tooling. It does not by itself
establish application trust, LAN-only access or complete offline readiness.
Record three independent results: internet unavailable on the community LAN,
device completely disconnected, and reconnect reconciliation. Browser-only
traffic restriction is an early dependency check, not the LAN outage result.

Required before promoting a community deployment:

- Local DNS, trusted TLS, accurate local time, local identity and recovery.
  Cold-start sign-in and expired-session renewal must work without public DNS,
  certificate issuance, an external identity provider or a tailnet control plane.
- Locally available application images, fonts, maps, office assets and models.
  Backups include databases, documents, identity, encryption keys and configuration;
  restore is rehearsed on an isolated node.
- Explicit device preparation: selected downloaded files, device encryption,
  shared-device restrictions and an agreed maximum offline-access period.
  Collabora in a browser still needs the local server. Desktop offline editing
  uses a local office editor and downloaded/synchronised Drive files.
- Community-appointed custodians control culturally governed records. Operator
  administrator status alone must not grant cultural access. Purpose, expiry,
  withdrawal, sharing and export decisions must be enforced by each source.
- Search, Hermes and Flow receive separate, explicit grants. No inherited right
  to ingest a resource merely because someone can open its application.
  Derived text, thumbnails, embeddings and exports are part of withdrawal testing.

Reuse BlakSmith's existing classification, custodianship and consent model. Its
code and unit tests are a starting point; they do not establish equivalent
enforcement in Drive, Knowledge, Eyes or downloaded files. Do not import governed
material into a source until its enforcement path has passed the negative tests.
Do not infer community protocols, custodians or authority from identity groups.
Community configuration and deployment trust must be supplied by the community.

Offline revocation has a real limit: a disconnected device cannot receive an
immediate withdrawal. Agree the offline lease and device controls first. Expiry
must deny access locally; reconnect must apply current authority before new reads
or queued uploads. Plain exported copies cannot be remotely recalled.

## 2. Field capture and registers

Extend Smith and Eyes where existing capture, registers and maps fit. Keep
ordinary online surveys in HeyForm; HeyForm remains excluded from Hermes ingestion.

Acceptance: capture notes, photos, coordinates and multilingual/audio content
without connectivity; close/reopen the device; show saved-locally and pending-sync
states; resume interrupted transfers; replay the same capture without duplicates;
preserve both conflicting edits for a person to resolve. Recheck authority at sync.
Shared devices must not retain restricted names, coordinates or media.

Evaluate ODK Collect/Central only for gaps the existing tools cannot cover.
[ODK's installation documentation](https://docs.getodk.org/central-install-digital-ocean/)
warns that enabling OIDC SSO disables API access; its
[API authentication documentation](https://docs.getodk.org/central-api-authentication/)
specifically excludes Basic and session-login authentication when SSO is enabled.
Prove supported automation authentication before selecting it for Node-RED.
QField remains a candidate for specialised offline GIS, not a deployed suite app.

## 3. Mail, calendar and bookings

Select free, open-source components only after proving native Blak ID sign-in,
shared calendar permissions and resource booking. Existing licensed OX notes do
not select a free replacement. Keep mail, calendars, address books and room/vehicle
bookings coherent; avoid duplicate portal entries for the same work.

Acceptance: local calendar and booking reads/writes during a WAN outage; queued
outbound mail with an honest unsent state; recurrence, time zones, shared calendars,
double-booking prevention and revoked access. External mail delivery still needs
connectivity and a configured domain/relay. Do not promise internet mail offline.

## 4. Meetings and reporting

Add local meetings and reporting after identity, permissions and data sources are
proven. Test calls wholly within the LAN, microphone/camera permissions, accessible
captions where available, bandwidth limits and an explicit recording consent flow.
External participants need a separately tested connectivity path.

Reporting must retain source permissions, purpose and withdrawal controls in
charts, exports and caches. Display data freshness and avoid exposing precise
restricted locations through aggregate or map views. Prefer reports inside
existing applications before adding another dashboard product.

## Cross-cutting automation

Node-RED remains selected under the accepted
[RBAC and opt-in connection model](node-red-rbac-and-connections.md). The portal
Flow prototype is not the Node-RED deployment. Isolate runtimes, keep source
credentials in an enforcing broker, and prove revocation and resource/action scope
before enabling connections. Offline notes and approvals should use these same
storage, audit and reconciliation rules rather than a separate identity system.
