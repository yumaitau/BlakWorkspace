# Tenant control plane, portal and DNS

The service is multi-tenant; an organisation's UUID owns every object, operation,
credential, trace and event. Mail supports a fleet of tenant cells rather than
assuming existing one-org portal deployments are already safely shared.

## Isolation contract

API request context is derived from verified OIDC identity and a current membership
lookup. Tenant selection only selects among memberships; it does not confer access.
Database runtime roles are not owners/superusers and have no BYPASSRLS. Use forced
PostgreSQL RLS, tenant-qualified keys/FKs and transaction-local scope; reset/release
pooled connections after transaction errors. Background jobs, pagination, exports,
search and event consumers receive the same explicit scope.

RLS is defence against missing tenant filters, not against a compromised backend
that can change its session tenant. Higher-assurance cells use distinct databases,
credentials, compute and storage keys; never describe a session GUC as an identity
trust root. Domain uniqueness is global to routing, but conflict responses are generic
and must not reveal the owning tenant. Cross-tenant transfers need independent proof,
two approvals and quarantine of stale routing/SES mappings.

OX context IDs and Dovecot mailbox identities are server-owned mappings. No user-set
IMAP usernames/paths, OX context IDs or S3 prefixes. Separate tenant storage roots and
credentials; IAM prefix/access-point policy, mailbox ACLs and index filters enforce
the same scope. Backups may contain multiple tenants only under a privileged backup
boundary; restored data never becomes visible before ACL/membership reconciliation.
Tenant deletion removes active access first, while retained immutable copies expire
under policy. Do not promise instant erasure from locked backups.

## Administration surfaces

Add `/access/admin/mail` only after membership-backed mail permissions exist. Existing
workspace-wide `idp` claim is insufficient for shared mail. Permissions: domain
manager, mailbox manager, sender manager, trace reader, audit reader; platform operator
is separate. Writes use existing same-origin/CSRF pattern plus recent-auth checks,
idempotency keys, optimistic versions and durable audit/outbox transaction.

| Surface | Operations and behaviour |
| --- | --- |
| Domains | Add owned domain; random TXT challenge; show required MX/SPF/DKIM/DMARC/MTA-STS/TLS-RPT; per-check expected/observed/status/time; recheck and suspension policy |
| Mailboxes | Create, disable, delete with retention/hold checks; quota; aliases; shared mailboxes; distribution lists; delegates; revoke sessions |
| SMTP | Issue once, scope by service and allowed senders; rotate/revoke; limit rate/bytes; show last use and security events without secrets |
| Traces | Timestamp, sender/recipient, message ID, status, service, sending region, receiving-provider region if known, bounce class and retry state |
| Audit | Authentication, mailbox/alias/forward/domain changes, SMTP issue/rotate/revoke, retention, privileged access and failover |

Do not invent recipient delivery region from an email domain or SES region. Record
platform processing region and outbound provider region; recipient destination region
is `unknown` unless independently established. Do not expose bodies/subjects or raw
bounce text with embedded content. Bound and sanitise diagnostic strings.

Create/disable/delete APIs return an operation ID and pending/ready/failed state.
Reconciliation updates OX, Dovecot and Postfix with retries and compensating actions;
never show ready before all required systems acknowledge. Disable must immediately
deny new access while cleanup retries. No raw upstream admin APIs reach tenants.

## DNS/security contract

Default domain examples below are proposed, not proof of ownership:

- `MX 10 mx1.blakworkspace.au`, `MX 20 mx2.blakworkspace.au`; A/AAAA point to
  independently reachable AU gateways. Publish IPv6 only after complete testing.
- SES custom MAIL FROM has its own required MX and SPF; do not confuse it with
  inbound MX for user addresses. Only the approved SES sender route belongs in the SPF policy.
- DKIM uses the provisioned SES selectors; no alternate DR sender is enabled. No private signing keys in public DNS.
- DMARC aligned DKIM is required; relaxed alignment may be necessary for bounce
  subdomain. Shared mailbox/delegate sending must preserve authorised identity.
- `_mta-sts.<domain>` TXT version/id and HTTPS policy at the fixed well-known path,
  listing both MX names; start testing mode then enforce after both regions pass.
- `_smtp._tls.<domain>` TLS-RPT reports to tenant-authorised AU ingestion; prevent
  reports becoming an exfiltration or unbounded payload path.
- DNSSEC/DS changes follow registrar-specific tested procedures. Monitor expiration,
  stale DNS, wrong MX, invalid signatures, unexpected SPF expansion and TLS failures.

Verifier performs bounded DNS queries through regional resolvers; DNS errors are
`unknown`, not verified. TXT chunks concatenate within a record, never across separate
records. SPF requires one policy and bounded include evaluation; no substring-based
success. DKIM requires actual selectors from provider provisioning. Ownership challenge
is random, tenant-bound, expiring and rechecked before mutation.

MTA-STS fetcher accepts only HTTPS port 443 at the fixed host/path, no redirects;
resolves and pins public addresses, rejects private/reserved/metadata addresses on
every connection, caps response size/time and verifies certificate hostname. Never
fetch an administrator-supplied URL. DNS verification does not prove domain ownership
without challenge, nor does a correct TXT prove end-to-end mail delivery.
