# Eval tool prerequisites

Match upstream openDesk operations requirements for the pin in [docs/upstream-baseline.md](../docs/upstream-baseline.md). Source: https://docs.opendesk.eu/operations/

| Tool | Requirement (upstream evidence, 2026-09-18) |
| --- | --- |
| Kubernetes | >= 1.24 |
| Helm | >= 3.17.3, and **not** 3.18.0 or 3.20.1 |
| Helmfile | >= 1.0.0 |

Do not apply production from this seed. Eval may use bundled services; production must replace them. Exact cluster distro is an owner choice (BW-009) and is not purchased here.
