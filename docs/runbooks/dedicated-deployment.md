# Dedicated infrastructure deployment

Blak Workspace is intended for production deployment on dedicated infrastructure.
The checked-in `workspace.example.com` addresses are documentation templates, not
live endpoints. Namespace and volume names remain stable to preserve existing data.

## Prepare a release

Using Python 3.12 or newer from a clean, committed checkout, choose the actual base domain:

```sh
python3 scripts/deploy/prepare-release.py --domain workspace.yourcompany.com --output /srv/blak-release
```

The command exports the current commit into a new directory and configures app
URLs, OIDC callbacks, shared-cookie scope, proxy routing and browser tests together.
It records the source revision and domain in `.deployment.json`. It does not
change DNS, certificates, a cluster or existing account mappings. Build images
from this prepared directory; keep it outside the source checkout.

Use DNS records for `portal`, `id`, `drive`, `docs`, `sites`, `projects`, `forms`,
`crm`, `chat` and `hermes` beneath the chosen domain. Provision trusted TLS for
these names and configure the ingress certificate before exposing the service.
Operator commands use the selected Kubernetes context or `KUBECONFIG`.

## Dedicated single-node K3s

The current `deploy/k3s/micro/` manifests and `scripts/deploy/deploy-micro.sh`
implement the verified single-node K3s deployment. They require existing cluster
prerequisites, storage, identity and source-account configuration; the application
release script is not a complete infrastructure bootstrap.

On the deployment host, from the prepared release:

```sh
scripts/deploy/deploy-micro.sh
scripts/deploy/test-e2e.sh
```

The release script builds and imports images into K3s, reconciles selected app
resources, verifies rollouts and runs a private Hermes sync. The browser runner
uses normal DNS. Set `BLAK_DEPLOYMENT_ADDRESS` only when an explicit ingress IP
override is needed. Tests create and remove synthetic records using operator
credentials from Kubernetes; run during a controlled acceptance window.

## Existing installations

A naming update is not a domain migration. Existing installations retain their
current DNS, certificates, database site names, secrets and private sync owners.
Before changing domains, back up data and coordinate DNS/TLS, identity callbacks,
Frappe site configuration, application public URLs and refreshed source credentials.
Set `BLAK_SYNC_ACCOUNT` to the existing mapping name when running enrolment, task
configuration or tests. New installations use `workspace-admin` by default.
Never rename or reassign a private owner mapping through a text replacement.

## Production readiness

Dedicated hosting does not automatically provide high availability. The current
single-node profile uses single-replica databases. Define capacity, monitoring,
restore objectives, external backup storage and failover requirements before release.

For EKS, prepare an infrastructure-specific overlay: registry images, supported
storage classes, ingress/TLS, IAM and cloud-compatible backups. The K3s image-import
and local-volume backup scripts are not EKS deployment automation.

Secrets stay in Kubernetes or the chosen secrets manager, never source control.
`scripts/deploy/ensure-secrets.sh` creates only missing values. Restrict bootstrap
accounts, provision real users through Blak ID and rotate bootstrap credentials.
Use [recovery procedures](ecosystem-polish.md), [app setup](forms-draw-crm.md) and
[Hermes sync](hermes-sync.md) for operational details.
