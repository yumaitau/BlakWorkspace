# Blak Flow: Node-RED, roles and opt-in connections

## Decision and implementation status

Node-RED is selected as the Blak Flow engine. Access to existing documents and
other systems must be opt-in. The role, workspace-isolation and opt-in connection model below was accepted
on 2026-09-24. It is an implementation contract, not a claim that every control
is deployed. The existing portal Flow prototype remains in place during migration.

## Accepted trust boundary

Use a separate runtime for each personal automation workspace. Give a team its
own runtime only when its members explicitly share responsibility for its flows
and connections. Keep production service automations in a separate operator
runtime. Do not put unrelated people's private credentials into one shared editor.

Node-RED's Admin API permissions cover operations such as `flows.read` and
`flows.write`; they do not provide our existing per-owner flow isolation.
Read-only editor access can expose the runtime's flow definitions and operational
data. Tabs, projects and hidden buttons must not be treated as tenant boundaries.
An editor able to deploy flows must be trusted to use the runtime's available
credentials, files and network access. Encrypting stored credentials does not
prevent a deployed flow from using them.

For every runtime, keep separate storage and credential encryption keys, enforce
network policy, and avoid host filesystem/Docker socket mounts and Kubernetes
service-account tokens. Node installation is operator-controlled. These controls
reduce exposure; they do not turn an editor into an untrusted code sandbox.

## Accepted roles

Keep existing Blak ID groups, with every permission scoped to a workspace:

| Group / role | Access |
| --- | --- |
| `blak-flow-reader` | Portal list and redacted history of approved flows. No editor access by default. |
| Runner grant | Execute specifically assigned published flows through the portal; cannot choose arbitrary URLs, credentials or source paths. Separate from reader permission. |
| `blak-flow-writer` | Build and deploy flows in their personal workspace, or a team workspace where explicitly assigned. Can use connections available to that workspace. |
| `blak-flow-admin` | Manage workspace membership and publication policy. Does not grant source-system permissions or automatically expose personal documents. |
| Platform operator | Deploy runtimes, manage keys and approved node packages. Infrastructure administrators remain privileged; do not promise cryptographic privacy from them. |

The native editor uses Blak ID OIDC with explicit group mapping and no anonymous
fallback. Do not copy Authentik's example that gives every successful login full
editor permissions. Protect HTTP In/webhook endpoints separately: `adminAuth`
protects the editor/Admin API, not every HTTP endpoint created by a flow.

Removing a role must invalidate relevant sessions and future execution grants.
Changing IdP groups alone is not proof that a previously issued Node-RED token
has stopped working. Choose a session lifetime and explicit revocation mechanism
and test existing sessions as part of delivery.

## Connection consent

Signing in, holding a Flow role, or already having Hermes connected grants no
source access to Node-RED. Do not copy Hermes tokens or share an administrator's
source credentials across users.

A connection consent screen must identify:

1. The source system and account acting on the user's behalf.
   Drive remains the document store; see [office editing direction](office-editing-direction.md).
2. Allowed resources: selected Drive files/folders or spaces, Outline collections,
   project boards, or other source-specific resources.
3. Allowed actions. Default to read; request create/update, delete, or sending
   messages as separate capabilities where supported.
4. Destination workspace and the people who can edit its automations.
5. Which published flows may use the connection, duration, background/scheduled
   access, and allowed destinations for document contents.

Suggested user flow: **Connect a system → choose account → choose resources and
permissions → review who can use it → Connect**. No system is preselected. The
Connections page shows grants, expiry, last use, dependent flows and Disconnect.

Folder grants must state whether future children are included. Moving an item
outside the permitted tree removes access. Using stable resource identifiers
avoids relying on a display path. Sharing a personal connection into a team
workspace requires new consent; adding team editors may broaden who can use it
and needs an explicit policy.

Use delegated source OAuth where it supports the required grant. Otherwise use
an explicit source service account or app password with the narrowest permissions.
If a source offers only a broad token, a folder picker alone does not constrain
that token. Enforce the selected resources/actions in a credential broker, keep
the broad token out of Node-RED, and authenticate each runtime to the broker.
Do not claim unsupported fine-grained scopes.

A broker grant should bind the source account, workspace/runtime identity,
resource scope, permitted actions, expiry and revocation state. Source ACLs and
connection consent both apply on every operation. An editor-supplied flow ID is
not proof of execution identity. Per-flow grants in a shared runtime require a
trusted execution boundary or isolated workers; otherwise the enforceable
boundary is the whole runtime and all its trusted editors.

Reads do not automatically authorize exporting document contents to arbitrary
external services. Connections and outbound destinations are separately granted.
Keep credentials out of flow JSON, exports, logs and debug messages; redact run
history. Use network restrictions to support the destination policy, not just UI
controls.

Disconnect blocks new source calls and scheduled/queued work using that grant,
revokes or removes its credential, and marks dependent flows as needing a new
connection. It cannot undo completed writes or recover data already sent to an
external system. Retention and deletion of cached copies need a visible policy.

## Acceptance before migration

- Existing Blak ID session opens the native editor without a second login.
- No grant means no source API access, even through direct endpoint calls.
- Read-only connections cannot write; out-of-scope files and collections are denied.
- One person's runtime cannot access another person's flows or credentials.
- A runner cannot change flow logic, runtime identity, account or resource scope.
- A revoked connection and a revoked user fail with an existing browser session
  and in queued/scheduled runs, not only after signing in again.
- Source permission removal takes effect independently of Flow membership.
- Real documents can be read from an explicitly connected test folder; writes
  occur only after a separate grant and only in the selected destination.
- Home navigation, readable styling, consent, disconnect and role denial tested
  in Playwright, with native API checks for the actual enforcement boundaries.
- Preserve old Flow definitions/history; migration is explicit and reversible.

## Delivery order

Personal isolated workspaces first; explicitly assigned team workspaces follow
the same isolation boundary. Readers and runners use the portal. Begin with
read-only, selected Drive documents and Outline resources; expand actions only
through explicit grants. Keep Node-RED source access disabled until enforcement
and revocation tests pass.

## Sources

- [Node-RED authentication and permissions](https://nodered.org/docs/user-guide/runtime/securing-node-red)
- [Node-RED Admin API operations](https://nodered.org/docs/api/admin/methods/)
- [Runtime, HTTP middleware and module configuration](https://nodered.org/docs/user-guide/runtime/configuration)
- [Authentik Node-RED integration](https://integrations.goauthentik.io/development/node-red/)
