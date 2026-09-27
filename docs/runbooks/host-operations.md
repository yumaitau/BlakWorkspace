# Host protection and performance

ClamAV and the Drive file-checker sidecar are retired. Endpoint protection is
operator-managed EDR installed on each machine hosting the workspace. This
repository does not install, configure or attest to the health of an EDR agent.

## Existing-installation migration

Select the intended Kubernetes context explicitly, then run:

```sh
KUBECONFIG=/path/to/workspace-kubeconfig python3 scripts/deploy/retire-file-guard.py
```

This removes the scanner sidecar, scanner environment, Drive port 8092, daemon,
Service and scanner-only code ConfigMap. It patches only scanner-owned fields
and refuses concurrent resource changes. App origins and Drive data stay intact.
Deploy the updated portal to remove Held files navigation and routes.

Both `file-guard-data` and `clamav-data` PVCs remain. Existing held bytes and notes
are not automatically released or deleted. Before removing either volume, inspect
and back up its contents. A workspace administrator must review retained records;
recover a selected held file only when its original path is free, then remove its
corresponding note. Never move OpenCloud `.oc-nodes` blobs. Scanner credentials
may be removed after checking that no old pod references them.

## Host monitoring: Beszel

**Home → Monitoring** opens Blak Monitoring, powered by Beszel 0.20.0. Beszel stores
host CPU, memory, disk/I/O, network and temperature history. The custom portal
metrics page, `/api/monitoring`, node-reading RBAC and service account are removed.
The portal endpoint only checks administrator access and redirects to Beszel.

The hub runs in K3s with its own `beszel-data` PVC. The native agent runs as the
unprivileged `beszel-agent` systemd service on each Linux host, outside containers.
The shipped installer supports Linux amd64 and verifies the pinned release SHA-256.
Other host architectures need their matching upstream binary and checksum.
No Docker socket is mounted; host metrics do not imply K3s workload-level metrics.

Native Blak ID OIDC uses implicit consent and the stable `beszel` client ID.
Access requires an active workspace administrator or `blak-drive-admin` membership.
Beszel password login is disabled. Its separate PocketBase recovery credential
stays in Kubernetes Secret `blak-beszel`; use a private port-forward for recovery.
All authorized operators can see the monitored hosts. This is an operator console,
not tenant-private monitoring. Existing Beszel sessions are separate from portal logout.

### Install and provision

Use the explicit target KUBECONFIG throughout. Set `BLAK_MONITORING_URL` to the
real HTTPS monitoring origin; templates and plain HTTP are rejected by provisioning.

1. Run `python3 scripts/deploy/provision-beszel.py`. It preserves existing credentials.
2. Prepare `deploy/k3s/micro/31-beszel.yaml` with that real `APP_URL`, and any required
   identity DNS host alias, then apply the prepared file. Never deploy example URLs.
3. Wait for `deploy/beszel`, then forward its API privately:
   `kubectl -n blak-micro port-forward --address 127.0.0.1 service/beszel 18790:8090`.
4. Configure OIDC and register a host:

   ```sh
   python3 scripts/deploy/configure-beszel.py \
     --issuer "$BLAK_ID_ISSUER" --host "$AGENT_ADDRESS" --name "$HOST_NAME" \
     --agent-env /private/path/agent.env
   ```

   The issuer is the HTTPS Blak ID `/application/o/beszel` URL. Choose an agent
   address reachable only by the hub, such as the single-node K3s bridge address.
   The agent listens on that address at TCP 45876. Remote hosts need explicit private
   routing and narrowly scoped firewall access from the hub. The env file is mode
   600 and is created exclusively; keep it private and remove the transfer copy.
5. On that host, run `sudo bash scripts/deploy/install-beszel-agent.sh /private/path/agent.env`.
   Public key and token authenticate the hub; no agent port needs public exposure.
6. On an existing ConfigMap-overlay deployment, run
   `python3 scripts/deploy/publish-beszel.py --origin "$BLAK_MONITORING_URL"`.
   It preserves existing app origins/routes, updates the maintained portal/shell
   overlays, rolls both consumers, then removes the old monitoring RBAC and ConfigMap.
   Image-based installations build the updated portal/shell sources instead and
   set `BLAK_MONITORING_URL`; the checked-in manifests already omit the old RBAC.
7. For optional tailnet publication, port 8457 forwards through the existing workspace
   gateway on loopback 18480. Confirm the port is unused before adding its Serve rule.
   `prepare-tailnet.py` includes this port for future releases. Keep Funnel disabled.

Verify native SSO from Home without another credential prompt, host status **Up**,
new historical records, visible charts and the Home link. Check non-admin denial.
Notifications are available in Beszel but need an operator-selected destination;
installation does not enable outbound notifications. Since the hub runs on this
single node, external outage detection needs a separate receiver/hub.

### Persistence and upgrades

Back up Beszel using its PocketBase backup UI/API and retain `beszel-data`, along
with Secret `blak-beszel`, before upgrades. Do not copy a live SQLite database file
as a backup. Pin hub and agent versions together; verify release checksums. The
hub public key and registered host tokens survive restarts in persistent storage.
The agent's state is `/var/lib/beszel-agent`; config is `/etc/beszel-agent/agent.env`.
Automatic agent updates are not enabled.
