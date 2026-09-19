# Homelab Micro runbook (k3s single-node)

Deployed 2026-09-19 on `homelab` (Ubuntu 26.04, x86_64), namespace `blak-micro`.
Manifests: `deploy/k3s/micro/`. Portal image built on-host (`blak-portal:micro`).
Opaque secrets stay in the cluster (`scripts/homelab/ensure-secrets.sh`); applying
these YAML files must not recreate Secret objects from git.

All user-facing copy follows Australian English
(see `australian-english` skill; code identifiers keep original spelling).

## Access (LAN)

Add to client `/etc/hosts`:

```
192.168.1.19 portal.homelab.local id.homelab.local drive.homelab.local docs.homelab.local sites.homelab.local
192.168.1.19 chat.homelab.local projects.homelab.local hermes.homelab.local
```

## Access (Tailscale, TLS)

Traefik serves the mkcert wildcard (`*.homelab.local`) on both LAN and tailnet.
Port 443 on the tailnet address is Traefik's (Rakazo's Tailscale Serve moved to
`:8443` to free it). On the client, point the same names at the tailnet IP and
trust the Blak homelab CA (`/tmp/blak-homelab-ca.pem`, staged on the MacBook):

```
100.95.43.17 portal.homelab.local id.homelab.local drive.homelab.local docs.homelab.local sites.homelab.local
100.95.43.17 chat.homelab.local projects.homelab.local hermes.homelab.local
```

```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/blak-homelab-ca.pem
```

Works on and off LAN (WireGuard transport + valid TLS, no warnings).

| Surface | URL | Backend |
| --- | --- | --- |
| Blak Portal | http://portal.homelab.local | portal, OIDC-gated, Blak theme + banner |
| Blak ID | http://id.homelab.local | Authentik, branded "Blak ID", default app → portal |
| Blak Drive | https://drive.homelab.local (accept test cert) | OpenCloud 7.5.0, external OIDC to Blak ID |
| Collabora | http://docs.homelab.local/hosting/discovery | CODE, `COLLABORA_DOMAIN` wired (`/` redirects to Drive; admin console is CODE basic-auth at `/browser/dist/admin/admin.html`) |
| Blak Sites | http://sites.homelab.local | Outline, OIDC-only login via Blak ID |
| Blak Flow | https://portal.homelab.local/flow | Portal-owned; Blak ID session; My flows / Create / Activity |
| Blak Chat | (not live) | Mattermost Team cannot do OIDC without Enterprise licence — demoted from waffle |
| Blak Projects | (not live) | OpenProject CE SSO plugins are Enterprise-licenced — demoted from waffle |
| Blak Hermes | http://hermes.homelab.local | Open WebUI + Ollama (qwen2.5:1.5b), OIDC via Blak ID |

White-label rule: Blak names up front, "Powered by X" underneath.
No Indigenous cultural artwork or motifs are used anywhere (colour palette is
landscape-inspired only), per `brand/PROVENANCE.md`. Portal follows the banner-driven
Blak visual system (dark-first charcoal foundations, burnt-orange primary, water-teal
secondary, warm cream type, Inter, sentence case, full Blak names in navigation,
"Your work. Your workspace." tagline, "Sovereign · Open · Together" strap).

Shared brand assets are served by the portal and referenced by each product:

| Asset | URL | Used by |
| --- | --- | --- |
| Logo (burnt-orange B mark) | `http://portal.homelab.local/brand/logo.svg` | Blak ID login, Drive theme |
| Flow background (earth/teal dusk) | `http://portal.homelab.local/brand/flow-bg.svg` | Blak ID login background |
| Drive theme (`Blak Drive`, Blak Dark tokens) | served same-origin at `/themes/blak/theme.json` | Drive web UI (`50-drive-theme.yaml`, `WEB_UI_THEME_PATH`) |
| Banner artwork (user-supplied, `brand/banner.png`) | `http://portal.homelab.local/brand/banner.png` | Portal sign-in art + home hero (gradient-mask blended) + README lead |
| Product icons (carved from user-supplied sheet, `apps/portal/brand-icons/`) | `http://portal.homelab.local/brand/icons/<app>.png` | Portal sidebar, tiles, launcher drawer |

Portal visual system is the dark-first Blak token set (charcoal foundations,
burnt-orange primary `#D65B2E`, water-teal secondary, warm cream type, Inter):
top bar + grouped sidebar (Workspace / Organise / Platform), waffle launcher with
per-product accents, split sign-in with abstract landscape hero, dot motif held to
brand surfaces, light theme toggle, honest empty states. Planned (unshipped) apps
render greyed with "Soon" tags — never fake functionality.

K8s API: `https://homelab:6443` (UFW allows LAN + Tailscale). From this Mac use
`~/.kube/blak-homelab-ts.yaml` (Tailscale IP; Homebrew kubectl lacks macOS Local
Network permission for LAN IP — grant in System Settings → Privacy → Local Network,
or keep using the `-ts` kubeconfig).

## Credentials (DEV-ONLY — rotate before any real use)

Passwords live in cluster secrets, not git. Create missing secrets with
`scripts/homelab/ensure-secrets.sh`. Read with `kubectl -n blak-micro get secret <name>`.

- Portal/Blak ID login: Authentik `akadmin` (`blak-idp` / `bootstrap-password`)
- Blak Drive admin: `admin` (`blak-drive` / `admin-password`)
- Blak Sites: Outline, OIDC-only (no local accounts exist); first login enrols `akadmin`
- Blak Chat: Mattermost local accounts (SSO needs Enterprise licence) — not advertised live
- Blak Projects: OpenProject local accounts (SSO plugins Enterprise-licenced) — not advertised live
- Collabora admin console: `admin` (`blak-docs` / `admin-password`)

## Verified end-to-end (2026-09-19)

- 15/15 pods Running; Traefik routes correct HTTP+HTTPS (portal/idp/idp-oauth/drive/docs/sites/chat/projects/hermes)
- Portal: anonymous visitors get the Blak sign-in page; `/login` → Blak ID;
  scripted full loop (login → callback → session → `/api/me` → launcher with user chip)
- Blak ID → Blak Drive: provider `opencloud` (public client `web`, implicit consent);
  OIDC code issued to Drive callback (scripted PKCE proof)
- Drive files: WebDAV upload 201 → password-protected public link → anonymous
  download byte-identical (`/dav/public-files/{token}/`)
- Docs engine discovery live; `COLLABORA_DOMAIN=http://docs.homelab.local`
- Sites: Outline workspace, login verified (OIDC session + landing 200)
- Blak Cloud (Floci): bucket create → put → get round-trip identical bytes
- Portal: M365-style shell (top bar search, left rail with full Blak names, waffle
  app launcher, greeting, status pills) in brand v0.1 light theme (Paper/Forest/Clay,
  Inter, sentence case); sign-in page carries the "Your work. Your workspace." tagline

## SSO architecture notes

- Authentik is the single OIDC IdP (Blak ID). Portal, Drive, Sites all point at it.
- OpenCloud runs with `OC_EXCLUDE_RUN_SERVICES=idp` (built-in IdP off),
  `OC_OIDC_ISSUER=http://id.homelab.local/application/o/opencloud/`,
  autoprovisioning to built-in idm LDAP (`GRAPH_LDAP_SERVER_WRITE_ENABLED=true`).
  First browser login as `akadmin` creates the user (role `user`); promote to admin
  via Graph API with Drive admin basic creds afterwards.
- **Traefik slug bypass** (`idp-oauth` route + `strip-provider-slug` middleware):
  the Authentik Go front door 404s per-provider slug paths (`.../o/<slug>/authorize|token|userinfo`)
  for providers it hasn't mapped, while Django's bare routes work. The middleware
  rewrites slug paths to bare paths at the edge. This restored all SSO after an
  Authentik restart and covers every future provider. Root cause in Authentik's
  router sync not isolated; the bypass is the documented adapter.
- Portal keeps `hostAliases` for `id.homelab.local` → Traefik ClusterIP
  (currently 10.43.169.184; re-check after Traefik reinstall). Same for Drive/OpenCloud.
- Drive runtime config via occ-equivalent? No — OpenCloud is env-only; no occ layer.

## Resources

Every workload sets requests + limits (node: 12 CPU / 30 GiB; ~5.7 CPU / 11.6 GiB
reserved, burstable limits overcommit by design on this dev box):

| Workload | Request | Limit |
| --- | --- | --- |
| OpenCloud | 1 CPU / 2 GiB | 4 CPU / 8 GiB |
| Collabora | 1 CPU / 2 GiB | 4 CPU / 6 GiB |
| Outline | 500m / 1 GiB | 2 CPU / 4 GiB |
| Authentik server / worker | 500m / 1 GiB each | 2 CPU / 4 GiB each |
| Postgres | 500m / 2 GiB | 2 CPU / 6 GiB |
| Meilisearch | 500m / 1 GiB | 2 CPU / 4 GiB |
| Portal | 250m / 256 MiB | 1 CPU / 1 GiB |
| Valkey / NATS | 250m / 256 MiB each | 1 CPU / 1 GiB each |
| Floci | 250m / 512 MiB | 2 CPU / 2 GiB |

## Known limits / next

- Drive CSP: browsers are only allowed to talk to Blak ID + Blak Docs origins via
  `drive-csp` ConfigMap (`PROXY_CSP_CONFIG_FILE_LOCATION`). Adding origins means
  editing `deploy/k3s/micro/50-opencloud-csp.yaml`.
- Docmost was replaced by Outline (Docmost SSO is enterprise-licence-gated;
  manifest parked at `adapters/docmost/k3s-reference.yaml`).
- OpenCloud `akadmin` needs role promotion after first login (see above).
- Collabora edit session still needs a browser click-through test.
- Blak Cloud (Floci) runs in-process services only (no docker.sock under k3s);
  S3 primary storage for Drive not yet wired.
- Forms, search indexing connectors, backups, secret rotation, HA profiles.
  Blak Meet and Blak Mail are dropped from the product (no release planned).
- Drive backend: OpenCloud (`opencloudeu/opencloud-rolling:7.5.0`,
  `opencloud init || true`, only `IDM_ADMIN_PASSWORD` set). No other file-sync
  backend is deployed.
