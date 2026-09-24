# Local DNS and HTTPS

The dedicated K3s profile supports two optional DNS modes:

- **Bundled:** a separate CoreDNS 1.14.7 resolver serves the workspace zone on an
  explicitly selected LAN address. It does not replace Kubernetes CoreDNS.
- **External:** export records for an existing router or organisational DNS server;
  no resolver workload is installed.

Neither mode changes DHCP, router settings, application URLs, OIDC identities,
WOPI addresses, Tailscale or the client's resolver. No public domain purchase or
hosted DNS account is required for an isolated deployment. The example below uses
`workspace.internal`; organisations can instead use a subdomain they control.
Do not use `.local`, which is reserved for multicast DNS.

## Prepare a new installation

Prerequisites: the dedicated K3s cluster, Python 3.12+, PyYAML 6.0.3, kubectl,
OpenSSL 3 and a static/reserved LAN address. This is an infrastructure addition,
not a replacement for application, database and identity bootstrap. On macOS,
set `BLAK_OPENSSL=/opt/homebrew/opt/openssl@3/bin/openssl` if needed.

From a clean committed checkout:

```sh
python3 scripts/deploy/prepare-release.py \
  --domain workspace.internal --output /srv/blak-release
cd /srv/blak-release
python3 scripts/deploy/local_network.py prepare \
  --release /srv/blak-release --mode bundled \
  --address 192.168.50.10 --client-network 192.168.50.0/24 \
  --node appliance --output /srv/blak-network
```

Use the actual ingress IP, client CIDRs and Kubernetes node name. `--listen` can
select a different DNS-server address on that node. DNS binds only RFC1918/IPv6 ULA
addresses, requires explicit client CIDRs and rejects unrestricted `/0` policies.
IPv6 addresses generate AAAA records; provision LAN IPv6 routing and resolver
advertisement separately. This initial generator selects one ingress address family.

The bundle contains `network.json`, readable records and zone files, `Corefile`
and a scoped `dns.yaml`. There is no DHCP server, query log, public listener,
ServiceAccount token or automatic public DNS fallback. Unknown names within the
workspace zone never leave the resolver. Without `--upstream`, unrelated zones
return REFUSED immediately; this is suitable for a conditional forwarder or fully
isolated LAN. To also resolve internet names, explicitly add a reachable resolver
IP, for example `--upstream 192.168.50.1`. Do not configure a forwarding cycle
between that resolver and this server.

The image is pinned by digest in `scripts/deploy/local_network.py`. Preload it into
K3s while connected, or transfer an image archive with the offline installation
media. `imagePullPolicy: IfNotPresent` permits cached startup; it does not magically
make an uncached image available during an outage.

Run on the chosen **deployment node**, using that cluster's explicit kubeconfig:

```sh
python3 scripts/deploy/local_network.py check-host --bundle /srv/blak-network
python3 scripts/deploy/local_network.py install \
  --bundle /srv/blak-network --kubeconfig /etc/rancher/k3s/k3s.yaml
```

Use appropriate operator privileges for kubectl and binding port 53. Preflight
binds both TCP and UDP to detect conflicts; it never stops another resolver.
Install verifies the node address, checks ownership of existing resources and
waits for rollout. It only manages `blak-lan-dns` ConfigMap and Deployment in
`blak-micro`. Updates recreate the single replica briefly; multi-server DNS
availability is not implemented. Network/firewall policy should allow TCP/UDP 53
from the selected LANs only. The CoreDNS ACL also rejects other sources; account
for any NAT that changes the source address it sees.

Configure the router's DHCP DNS option to advertise this address, or configure
the existing resolver to forward **only the workspace zone** here. An existing
resolver is preferable when clients also need other organisational zones. Renew
client leases. All DNS servers advertised to a client must know the local zone;
adding a public resolver as a “secondary” can cause intermittent failures.
Check browser/device secure-DNS policies: external DoH may bypass local DNS.

### Existing DNS mode

```sh
python3 scripts/deploy/local_network.py prepare \
  --release /srv/blak-release --mode external --address 192.168.50.10 \
  --output /srv/blak-network-records
```

Import `records.json` entries into the existing DNS zone. `db.workspace` is a
zone-file reference; keep the existing server's NS/SOA authority when adding
records to an established zone. This mode creates no Kubernetes manifest.

## TLS choices

Keep a publicly trusted certificate workflow when available. For an isolated
installation, create a local CA **outside Git**, then install its leaf certificate:

```sh
python3 scripts/deploy/local_tls.py create \
  --domain workspace.internal --output /var/lib/blak-pki/authority
# After application IngressRoutes exist:
python3 scripts/deploy/local_tls.py install \
  --state /var/lib/blak-pki/authority --kubeconfig /etc/rancher/k3s/k3s.yaml
```

The CA lasts ten years; the leaf lasts one year and covers the base domain and
one level of application subdomains. Keys are created with mode 0600 beneath a
0700 directory. The CA private key is never uploaded to Kubernetes. Back it up
encrypted, separately from the appliance, and restrict recovery access.

Install creates the `blak-lan-tls` Secret and public `blak-lan-ca` ConfigMap. It
patches only exact-domain Traefik IngressRoutes, preserving their service routing
and other TLS options. Those routes become HTTPS-only. Routes using another
certificate, a certificate resolver, mixed domains or complex host rules require
an explicit migration. The tool does not replace them silently. Optimistic
resource-version checks protect concurrent edits. A public route snapshot is
stored under `ingress-before.json`; no Secret is written to that snapshot.

**Trust enrollment is required before sign-in.** Distribute only `ca.crt`, verify
its SHA-256 fingerprint through a trusted channel, and add it to each managed
device/browser trust store. Also install that CA in server applications making
HTTPS calls to Blak ID, Drive or Docs. `blak-lan-ca` provides the public certificate
for mounts; each image needs its supported trust-store mechanism (for example
Node's `NODE_EXTRA_CA_CERTS`, or a complete CA bundle for Python requests).
This tool does not automatically modify every upstream application's trust store.
Do not replace standard trust roots with a local-only bundle when public services
are still used. Never turn off TLS verification to make SSO or WOPI pass.

Native OIDC and document editing must pass with normal certificate validation
before switching clients. Keep one canonical URL per application both online and
offline. Local DNS alone does not migrate an existing issuer, callback, cookie
scope, CRM site identity or document endpoint.

### Renew without changing device trust

Monitor certificate expiry and the appliance clock. Provide a reliable local time
source for isolated deployments; DNS alone does not solve time drift.

```sh
python3 scripts/deploy/local_tls.py renew \
  --authority /var/lib/blak-pki/authority --output /var/lib/blak-pki/renewal-2027
python3 scripts/deploy/local_tls.py install \
  --state /var/lib/blak-pki/renewal-2027 --renew-leaf \
  --kubeconfig /etc/rancher/k3s/k3s.yaml
```

Renewal generates a new leaf key signed by the same CA. Replacing a CA is a
separate device/service trust migration and is refused by this command. Schedule
renewal at least 30 days before expiry; automatic renewal is not yet provided.

## Existing installations and tailnet deployments

DNS can be introduced without renaming applications. Supply `--domain` instead
of `--release` for an existing installation. `--apex-only` serves a single existing
hostname without creating application subdomains. A prepared tailnet release
selects its canonical hostname and apex-only mode automatically. `--address` must
be the address where all existing HTTPS ports actually work; choosing a LAN IP
does not create matching listeners or certificates there.

Do not apply a new generic app release to migrate the homelab. Its existing
tailnet listeners and LAN TLS differ. Start with additive DNS, retain canonical
origins, and treat LAN HTTPS publication and server-side trust as separate gates.
Tailscale remains optional for new dedicated deployments.

## Acceptance and rollback

For an operator-run, disposable DNS/TLS rehearsal on a Docker host, pre-cache the
pinned CoreDNS image and a Node 22 image, then run:

```sh
python3 scripts/deploy/test_local_network.py --fixture-image YOUR_CACHED_NODE_IMAGE
```

Use an immutable image reference for repeatability. The rehearsal creates a unique
internal Docker network and synthetic HTTPS service, verifies UDP/TCP DNS, NXDOMAIN,
refused outside queries and clients, trusted TLS, rejection of untrusted TLS, and
cached restart. It removes only its own containers/network. No live app, host DNS,
router or certificate trust is changed. This is component proof, not full-suite
offline acceptance.

From another allowed client, query the deployed resolver with both protocols:

```sh
dig @192.168.50.10 portal.workspace.internal A
dig +tcp @192.168.50.10 id.workspace.internal A
dig @192.168.50.10 absent.workspace.internal A
```

Require correct addresses and NXDOMAIN for the absent local name. Check a client
outside the allowlist receives REFUSED. Verify normal HTTPS using enrolled trust,
then run [offline browser acceptance](offline-readiness.md). In an isolated
rehearsal, disable WAN, restart the resolver with cached images and repeat DNS,
fresh sign-in, Drive editing, Knowledge, Chat and maps. Record DNS/TLS evidence
separately from full-suite LAN or disconnected-device claims.

Before removing bundled DNS, move router/client DNS back to a working resolver
that knows the workspace zone and let leases/cache update. Then delete only the
`blak-lan-dns` Deployment and ConfigMap using an explicit kubeconfig. Keep the
generated bundle for restoration. For TLS rollback, restore only previously
changed route TLS/entry-point fields from the private operator snapshot; retain
the CA and leaf material until no service or client relies on them. Do not delete
Kubernetes CoreDNS, DHCP configuration, application volumes or unrelated TLS.

Upstream: [CoreDNS licence](https://github.com/coredns/coredns/blob/v1.14.7/LICENSE),
[file zones](https://coredns.io/plugins/file/), [ACL](https://coredns.io/plugins/acl/),
[bind](https://coredns.io/plugins/bind/), [forward](https://coredns.io/plugins/forward/).
