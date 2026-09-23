# BlakSmith and BlakEyes

BlakSmith (`yumaitau/BlakSmith`) is the knowledge graph. BlakEyes
(`yumaitau/BlakEyes`) is the on-Country drone imagery appliance. Both stay in
their own repositories. Each repository's CI publishes images to GHCR, and this
suite pulls them into `blak-micro`.

Catalog ids are `smith` and `eyes`. Tailnet ports are 8455 and 8456.
Checked-in manifests use `workspace.example.com`. A tailnet release rewrites
those origins. Do not apply `30-portal.yaml` to publish the new tiles.

## Images

| Deployment / container | Image |
| --- | --- |
| `smith` / `web` | `ghcr.io/yumaitau/blaksmith` |
| `smith-api` / `api`, init `wait-web` | `ghcr.io/yumaitau/blaksmith-api` |
| `smith-postgres` / `postgres` | `ghcr.io/yumaitau/blaksmith-postgres` |
| `eyes` / `eyes`, init `tls` | `ghcr.io/yumaitau/blakeyes` |

Manifests pin `sha-<short commit>` tags. Pushing to `main` in BlakSmith or BlakEyes
publishes `sha-<short>`, `main` and `latest`. To move a pin, change the tag in
`99-smith.yaml` or `99-eyes.yaml`, then patch the live Deployment with
`kubectl set image`. Smith images are multi-arch; Eyes is `linux/amd64`. The Eyes
image does not install torch. Review and classification still run; local model
training needs an image built with the `ml` extra.

The packages are private. Each pod pulls with secret `ghcr-pull`, a
`docker-registry` secret holding a classic GitHub token with only
`read:packages`:

```sh
kubectl -n blak-micro create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io --docker-username=<github user> \
  --docker-password="$(cat ~/.config/ghcr-pull-token)"
```

`deploy-smith-eyes.sh` stops if the secret is missing. Rotate the token before it
expires and replace the secret the same way.

## Deploy

```sh
scripts/deploy/deploy-smith-eyes.sh
```

That creates secrets `blak-smith` and `blak-eyes` when they are missing,
registers the `blaksmith` and `blak-eyes` OIDC clients, reconciles portal
groups, applies `99-smith.yaml` and `99-eyes.yaml`, rebuilds the portal and
shell, and adds the two upstreams to ConfigMap `workspace-shell-nginx` without
removing the others. On a tailnet that is already published, set
`BLAK_TAILNET_HOST` for `publish-smith-eyes.py` and
`BLAK_SMITH_PUBLIC_ORIGIN` / `BLAK_EYES_PUBLIC_ORIGIN` for the provision
scripts so callbacks use `https://host:8455` and `https://host:8456`. Add
Serve listeners for ports 8455 and 8456 to `127.0.0.1:18480`. Publication
refuses to replace an existing app on a port. After the pods are up,
port-forward Smith and Eyes and run
`scripts/deploy/sync-directory.py --from-cluster --push`. The checked-in
manifests stay on `workspace.example.com`; a live tailnet apply has to
rewrite those origins before `kubectl apply`. Do not rebuild the portal
image from a dirty checkout that also contains unrelated portal work. Mount
the catalog files, or publish origins onto the running portal. Mount
`integration.js` with `catalog.js`. A portal that knows a catalog id but has
no integration entry for it answers `/launch/<id>` with "Request failed".

Smith keeps its own Postgres 18 database (`smith-postgres`) with pgvector and
PostGIS. It does not use the shared portal database. The web container migrates,
then runs `bootstrap-workspace.ts`. The OIDC issuer is
`https://id.workspace.example.com/application/o/blaksmith/` until a tailnet
release rewrites it. The callback is
`/api/auth/sso/callback/blak-id`. Key custody is `BLAKSMITH_KEY_PROVIDER=file`
on a mode-0600 file in the pod. That survives a restart on this node. It is not
classified-data custody.

Blak ID sends `blaksmith_role` (`reader`, `writer`, `admin`) and
`blaksmith_clearance` (`internal`) in the `blaksmith` scope. No workspace role
maps to Smith `owner`. Smith still requires a SCIM user before that login
succeeds. The bearer is `<scimProviderId>.<organizationId>.<scimSecret>` from
secret `blak-smith` (`scim-secret`, `organization-id`) and provider id
`blak-id-scim`. `externalId` is the Authentik user UUID. Send one group whose
external id is `reader`, `writer` or `admin`.

BlakEyes uses the same directory contract. Its client id is `blak-eyes`, the
callback is `/api/auth/oidc/callback`, and the scope `blakeyes` carries
`blakeyes_role`. Secret `blak-eyes` holds `oidc-secret`, `scim-secret`, and
`organization-id`. The bearer is `blak-id-scim.<organization-id>.<scim-secret>`.
`scripts/deploy/sync-directory.py` pushes both products. A person can sign in
only after that push. Password sign-in remains on the appliance itself for the
local recovery account.

## BlakEyes sign-in

Opening BlakEyes sends the browser to Blak ID. There is no second password
when the directory account exists. A workspace admin adds the person to
`blak-eyes-reader`, `blak-eyes-writer`, or `blak-eyes-admin`, then runs the
directory sync. Reader can look. Writer can ingest and review. Admin can also
manage the appliance.

First-run setup is still refused unless the client address is loopback. From
the pod, before the directory is required for everyday sign-in:

```sh
kubectl -n blak-micro port-forward deploy/eyes 8766:8766
```

Open `https://127.0.0.1:8766` and finish setup there. Port 8766 is the appliance
itself. The Service on 8765 is a different address, so it cannot bootstrap the
appliance. After that, everyday sign-in is Blak ID.

Survey folders can include GeoJSON, KML, KMZ, GPX, shapefile, GeoPackage, LAS,
LAZ, a ground-control CSV, a VRT index, JPEG 2000, and world files. ECW, MrSID,
E57, PLY, PCD, DXF, and DWG are named in the tools screen with the export to
use instead. A world file, DJI MRK, or SRT beside a photo fills in a position
when the photo has none. MBTiles basemaps stay on the existing map import.

## Access

Run `python3 scripts/deploy/provision-id.py` after the OIDC client exists.
Workspace administrators are placed in `blak-smith-admin` and `blak-eyes-admin`
on that first reconcile. Later role changes stay as assigned.
