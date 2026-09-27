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

## Host monitoring

Workspace admins can open **Home → Monitoring** (`/monitoring`). The existing
admin-only API (`/api/monitoring`) reports Kubernetes host readiness, CPU usage and
capacity, memory usage and capacity, and sample time. It refreshes every 15 seconds
and shows unavailable readings when samples are stale. This is a live view, not a
historical metrics or alerting service.

For history, disk/network graphs and alerts, the preferred next monitoring layer
is [Beszel](https://beszel.dev/). Run its native agent as a systemd service on each
Linux host so it measures the machine outside Kubernetes. Keep the hub private,
with native Blak ID OIDC and access restricted to workspace operators. Install
agents on additional machines as those machines join the deployment. Beszel's
Docker statistics do not imply K3s/containerd workload monitoring; retain the
Kubernetes metrics view. EDR and performance monitoring have separate jobs.
