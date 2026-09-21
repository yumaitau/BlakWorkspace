# Blak Vault

Blak Vault uses Vaultwarden 1.37.3 and the native Bitwarden Web Vault. Encryption,
master-password derivation, encrypted attachments and organisation key sharing
remain upstream functionality. The image is pinned by digest. The shared portal
script is not injected into Vault.

## Sign in and unlock

Open Blak Vault from the workspace launcher. Sign in with Blak ID and complete
MFA. A first visit asks you to create a unique master password of at least 14
characters and sufficient strength. This password unlocks your encryption keys;
it is separate from your Blak ID password and is never provided to the role
controller. Store recovery information offline. Losing the master password can
make personal data unrecoverable.

For Bitwarden browser extensions and mobile/desktop clients, select a self-hosted
server and use the same Vault HTTPS origin. Choose single sign-on. Vaultwarden's
native SSO identifier is `00000000-01DC-01DC-01DC-000000000000`; the launcher supplies
it automatically. Use the native app's Lock or Log out when finished. Portal
sign-out cannot erase unlocked tabs, cached decrypted content or offline clients.

## Group storage

Use login items for passwords, secure notes/custom fields for API keys, and
attachments for certificates or sensitive files. Put group items in the group's
organisation and shared collections. Personal vault items remain private.

Blak ID groups are `blak-vault-reader`, `blak-vault-writer`, and
`blak-vault-admin`. Highest matching role wins for Vault only. No matching role
blocks new Blak ID login and revokes managed organisation membership. Inactive
or deleted directory accounts also lose membership.

- Reader: decrypt/read assigned shared collections; cannot edit or manage members.
- Writer: create/edit assigned shared collections; cannot manage members.
- Admin: administer the organisation, not Blak ID or the Vault server operator UI.

An owner must confirm new members in Vault before their clients receive the
organisation key. The controller does not perform this cryptographic handoff.
Previously downloaded secrets remain known after revocation; rotate sensitive
credentials when a former member must no longer know them.

The controller exclusively manages membership and permissions in its configured
organisation. It removes direct collection grants and unmanaged group grants for
managed members, preventing a stale writer grant from defeating a reader role.
Choose a dedicated group organisation; do not point it at an unrelated existing
organisation with independently managed members. The explicitly configured
controller owner is protected. Human administrators are not protected from
revocation. Native account linkage is verified against the immutable Blak ID UUID
and provider issuer, never inferred from email.

## Provisioning and owner setup

Prepare a clean committed release for the actual domain/tailnet, then run
`scripts/deploy/deploy-vault.sh` on the deployment host. This builds Vault and the
gateway, provisions a native OIDC provider and MFA stages, and applies only those
resources. It preserves existing Serve ports, including unrelated port 8443.
This deployment path currently requires a tailnet-prepared release. Non-tailnet
deployments need an explicit, verified Blak ID HTTPS egress rule and are not yet
supported by the deploy script; it refuses them before building or changing resources.

The initial operator is seeded into the Vault admin group once. Removing that
membership later is respected. Existing provider client credentials are retained.
The app-local email scope follows Authentik's documented Vaultwarden integration:
the managed directory asserts email ownership. Email auto-linking is disabled.
Treat directory email assignments as administrator-controlled identity data.

The real owner must sign in, choose their own master password, and create the
production organisation. Do not substitute a generated password or a test account
for this step. Create a dedicated native controller owner, keep its API key in
`blak-app-roles`, and remove its unlock password/encryption key from controller
runtime access. Configure only organisation/collection IDs that the owner selected.
The controller needs owner API authority to grant/revoke native administrator
roles; it never needs the master password. Its native operator credential is used
only to read the existing SSO association and is kept in a separate Secret.

`97-app-roles.yaml` defaults to zero replicas. Enable one replica only after the
production controller account and managed organisation are enrolled and verified.
The reconciliation loop runs every 60 seconds. Native ACL changes apply to
existing requests after reconciliation; readiness becomes false after failed or
stale reconciliation. Failures must be investigated, not treated as applied.

## Backups and recovery

The existing encrypted workspace backup includes `vault-data`. It quiesces writers
before copying data, so SQLite and attachments belong to one consistent snapshot.
The restore drill checks SQLite integrity, foreign keys and every attachment path.
`scripts/deploy/backup/vault-snapshot.py` performs a Vault-only encrypted snapshot
using the existing protected backup key and recovery journal. It briefly stops
only Vault, restores its previous replica count, and never stops other apps.
After a successful Vault-only snapshot, the newest seven Vault archives are kept.

Back up the encrypted archive, protected backup key and deployment Secrets
separately. A backup is not a replacement for users' master passwords. Restore to
an isolated instance first and prove that a native client can decrypt an item and
its attachment. Do not overwrite production data to test recovery.

Vault contents and attachments are excluded from Hermes and Blak Search.

## Repeat native permission acceptance

Use two disposable `e2e-vault-*` accounts with `@example.invalid` addresses. Enrol
both through native SSO/MFA, create an acceptance organisation and collection,
and confirm the member through the owner's native client. Create an encrypted
shared item and attachment. Keep account metadata/API keys in mode-0600 JSON
files; never commit them. The owner fixture needs `username`, `email`, `itemId`
and `organizationId`; the member needs `username`, `email`, `userId` and `apiKey`.

Run `scripts/test/vault-native-roles.py --origin <vault-origin>
--owner-fixture <private-owner-json> --member-fixture <private-member-json>
--role-setter <executable>`. The executable receives `reader`, `writer`, `admin`,
`none`, `cross-app` or `disabled` and must change only the disposable member's
directory membership/active state. `cross-app` grants another app but no Vault
role. Run against the continuous controller, not a manually triggered reconcile.

The test keeps one native access token through every transition, checks that the
same token still reads the account profile after ACL denials, measures convergence
and restores reader membership on exit. Separately run `e2e/tests/vault.spec.js`
with `BLAK_VAULT_FIXTURE_FILE` pointing to the disposable owner credentials to prove
native MFA, unlock, onboarding and item editor behavior. Encryption/decryption and
isolated restore acceptance require the native Bitwarden client and master
password; the controller itself never receives them.

## Upstream references

- https://github.com/dani-garcia/vaultwarden/releases/tag/1.37.3
- https://integrations.goauthentik.io/security/vaultwarden/
- https://github.com/dani-garcia/vaultwarden/wiki/Backing-up-your-vault
- https://bitwarden.com/help/cli/
