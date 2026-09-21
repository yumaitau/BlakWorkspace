# Blak Vault

Vaultwarden 1.37.3 with a pinned upstream image and static Blak branding. Build
from the repository root with `docker build -f services/vault/Dockerfile .` on the
deployment host. No shared workspace JavaScript runs in the vault. The native
client handles encryption, master-password unlock, attachments and sharing.

`brand.css` is generated from the existing palette and bundled Inter font. The
build fails if the upstream HTML anchor changes, requiring an explicit branding
review when upgrading. Retain upstream notices and licenses.

The group role contract lives in `docs/identity/app-role-contract.md`. Native OIDC
login alone is not evidence that group roles or collection permissions are wired.
