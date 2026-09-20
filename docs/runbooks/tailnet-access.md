# Tailnet demo access

A prepared release can use one existing Tailscale node name with valid HTTPS.
Portal uses port 443. Native applications use separate HTTPS origins:
ID 8444, Drive 8445, Docs 8446, Knowledge 8447, Projects 8448, Forms 8449,
CRM 8450, Chat 8451, and Hermes 8452. Port 8443 is reserved for existing services.
Users connect through Tailscale; this does not enable Funnel or public access.

Prepare from a clean committed checkout, using the existing installation domain
so database site identities remain intact:

```sh
python3 scripts/deploy/prepare-release.py --domain "$EXISTING_DOMAIN" --output "$RELEASE"
python3 scripts/deploy/prepare-tailnet.py --release "$RELEASE" --host "$TAILNET_HOST" --address "$TAILNET_IP"
```

Transfer the release to the deployment node, then run `scripts/deploy/deploy-micro.sh`
there. Deployment reconciles Serve listeners, native OAuth callbacks, existing
Forms issuer-qualified identities and Chat's saved OAuth settings. Subjects,
client secrets, existing callbacks and database site directories are preserved.
Private rollback inventories are written under `/var/backups/blak-workspace/`.
Do not reapply the adapter to an already adapted release.
After the first URL change, sign in to Chat as the existing administrator. If
“Unique ID change detected” appears, select **Configuration update** to retain
the existing workspace; do not select **New workspace**. The modal traps focus
until acknowledged, so complete this before keyboard and accessibility tests.

The node needs Tailscale HTTPS enabled, an authenticated tailnet identity, sudo,
Python with PyYAML, Docker and kubectl access. Serve sends each origin to the
workspace gateway through a persistent systemd loopback socket on port 18480.
Publication refuses to overwrite a different app on any requested Serve port.

## Verify from another tailnet client

Check certificate validation without disabling TLS checks. Sign in to the portal,
then verify native app login, CRM edits, forms, document editing and Hermes sync.
Kubernetes ServiceLB can intercept the node's own port 443, so browsers must run
on another tailnet client. `PLAYWRIGHT_WS_ENDPOINT` supports a browser reached
through a private SSH tunnel; the controller and Kubernetes credentials remain
on the deployment node. Set `BLAK_E2E_NATIVE=1` to use that endpoint with
`scripts/deploy/test-e2e.sh`. The Hermes enrolment script uses the same endpoint.
Alternatively, run the pinned Linux browser in an isolated Docker network
and route public origins through an SSH reverse SOCKS tunnel from another tailnet
client (`ssh -N -R 127.0.0.1:3109 "$NODE"`). Set
`BLAK_E2E_PROXY` to a SOCKS endpoint reachable from that browser; cluster API
fixtures stay direct. A loopback tunnel needs a temporary, private bridge relay
and a narrowly scoped firewall rule for the test container. Remove both afterward.
Avoid host networking because CNI changes can interrupt Chromium requests.
Run test invocations sequentially because the runner installs shared dependencies.

Use the pinned Linux Playwright image for visual baseline comparisons. A browser
on another operating system can exercise functional and accessibility tests with
`--ignore-snapshots`; retain screenshots for review and report that limitation.

## Rollback

Use the private pre-change resource and identity inventories plus the prior
release to restore canonical origins and issuer-qualified Forms identities.
Restore only the listeners changed by this deployment, preserving unrelated
Serve configuration. Do not publish inventory files: they contain credentials.
