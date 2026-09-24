# Offline readiness acceptance

## Browser dependency gate

Run against a prepared deployment from an operator machine with a local browser.
An allowlisted loopback proxy blocks browser HTTP, HTTPS and WebSocket traffic to
external destinations, including redirects. It cannot chain through another proxy
or serve a remote browser. Test the gate itself with
`npx playwright test local-network-guard.spec.js` from `e2e`.
Service workers are disabled and TLS validation stays enabled. Credentials stay
in memory; traces, video and automatic screenshots are disabled. The document
test captures only its synthetic editor document and deletes its owned fixture.

This is **not** a server egress firewall, DNS test, power-cycle test or fully
disconnected-device test. Direct API calls used to prepare/check the owned document
fixture are outside the browser gate. WebRTC is not covered. Run the separate LAN
and device gates below before describing the deployment as offline-ready.

```sh
cd e2e
# Prepare dependencies/browser while connected, before outage rehearsal.
npm ci --ignore-scripts
npx playwright install chromium
export KUBECONFIG=/path/to/the/intended-cluster.yaml
export BLAK_E2E_BASE_URL=https://portal.community.example
export BLAK_E2E_IDP_URL=https://id.community.example
export BLAK_E2E_DRIVE_URL=https://drive.community.example
export BLAK_E2E_LOCAL_ORIGINS='["https://portal.community.example","https://id.community.example","https://drive.community.example","https://docs.community.example","https://knowledge.community.example","https://chat.community.example","https://smith.community.example","https://eyes.community.example"]'
export BLAK_E2E_SERVICE_ORIGINS='{"drive":"https://drive.community.example"}'
# Supply BLAK_E2E_USER and BLAK_E2E_PASSWORD through the operator's secret workflow.
# On the homelab only, BLAK_E2E_BOOTSTRAP=1 explicitly opts into in-memory retrieval.
npm run test:local-only
```

The test identity needs the seeded Knowledge Policies page and access to Drive,
Chat, Smith and Eyes. The document fixture uses the existing private Hermes-sync Drive
account: the browser identity must be that same account. No new source grant is
created. `BLAK_SYNC_ACCOUNT` selects its configured mapping when needed.

Assertions cover cold sign-in, the single Drive entry, expiry/renewal without
another login, real ODT editing and saved-content readback, a Knowledge page,
native Chat sign-in, the Eyes locally bundled map, and Smith's rejection of malformed
field imports through its signed-in API. Reports list blocked origins
and attempt counts only, never URL paths/query strings or credential values.
Blocked optional update checks are evidence to review, not an automatic failure;
the required application operations must still pass.

### Homelab observation — 24 September 2026

All four browser tests passed against the deployed tailnet origins in 48.8 seconds.
The only blocked origin was `https://update.opencloud.eu`; document editing and
session renewal still worked. Knowledge, Chat and Eyes attempted no external origin
in the tested paths. This proves those browser operations can avoid public services
while the local application servers remain reachable.
Smith web/API ran `sha-8680f30`, including the consent and field-import fixes from
[BlakSmith PR #131](https://github.com/yumaitau/BlakSmith/pull/131). Native malformed
imports returned 400; consent expiry and shared-device sanitisation also have unit
regressions in Smith. These checks do not establish suite-wide cultural protection.

The LAN gate has **not passed**: a direct request to the node's LAN address using
the current portal hostname failed certificate verification. The LAN listener
presented a development certificate for `*.homelab.local`, while current SSO/app
origins use the tailnet hostname. Current app listeners
are on the Tailscale address. Existing tailnet sessions are not evidence that a
fresh device can resolve and reach every application with WAN unavailable.

## Community LAN gate

Use an isolated rehearsal environment or an onsite-controlled outage. Do not cut
the network carrying the operator's only management connection.

1. Record the deployment domain, local resolver, LAN addresses, trusted CA/chain,
   certificate expiry/renewal plan and local time source. Preserve canonical OIDC
   issuers, app origins, callbacks and WOPI URLs. A hosts-file override alone is not
   a deployed local DNS service.
2. Prepare a fresh client with no browser cache or active session. Disable WAN at
   the rehearsal boundary while retaining LAN routing. Verify DNS and TLS normally;
   never use `ignoreHTTPSErrors`, `curl -k` or an insecure-login workaround.
3. Restart the rehearsal node with cached images, then run the browser gate using
   LAN origins. Check supporting databases, key access, maps and office assets.
4. Exercise native role withdrawal while WAN is down. A removed user or grant must
   fail on backend APIs as well as disappear from the portal.
5. Restore WAN, verify reconciliation, record results and rehearse backup restore.
   Record server-originated external dependencies separately from browser traffic.

## Disconnected-device and reconnect gates

- Prepare selected Drive files and a local office editor; deliberately disconnect
  from both WAN and LAN. Open and edit a downloaded document, spreadsheet and slide
  deck. Browser Collabora availability does not satisfy this gate.
- Restart the device. Verify intended files remain readable, encrypted storage is
  enabled, shared-device restrictions hold, and access expires as agreed.
- For field capture, persist a synthetic draft locally; restart; resume it; then
  reconnect. Interrupt an upload, retry the same capture, and verify one record.
- Edit the same file from two clients before reconnect. Require a visible conflict
  and preserve both versions. Do not accept silent replacement as successful sync.
- Withdraw authority while a device is disconnected. Record the actual maximum
  exposure window; verify expiry locally and refusal on reconnect. Confirm derived
  copies and queued automation follow the same withdrawal decision.

Store only synthetic content in test artifacts. Results must state which of the
three gates passed and which remain unverified.
