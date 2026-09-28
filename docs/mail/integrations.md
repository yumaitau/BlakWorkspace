# Mail and identity integration contracts

## OX / Dovecot

OX handles webmail, calendars, contacts, shared address books, search, signatures
and user rules. Provision through supported OX management APIs; one context per
tenant and immutable context/user mapping. Domains, aliases and distribution lists
are control-plane records reconciled to Postfix; they are not arbitrary UI strings.
Shared mailboxes are distinct principals with explicit delegates, not shared passwords.

Select supported OX release/artifacts and entitlement after comparison with openDesk
pin. OX stores groupware data in its supported MySQL deployment; the new control API
uses PostgreSQL for RLS. Do not assume the OX database itself supports PostgreSQL RLS.
Distribution list membership and forwarding changes require audit and sender policy.

Dovecot provides IMAPS, LMTP delivery, quota, Sieve and shared mailbox ACLs. Disable
unencrypted password logins. Mailbox paths use tenant UUID/mailbox UUID, never raw
email local parts. Validate ACLs on LIST, SELECT, SEARCH, FETCH, COPY, MOVE and FTS.
Use supported FTS implementation; content indexes have the same residency and
encryption requirements as mail. Encryption at rest includes EFS, EBS, databases,
indexes, queues and backups; it does not hide mail from authorised running processes.

[Dovecot's release notes](https://github.com/dovecot/core/releases) remove the CE
replicator in 2.4. Do not implement `mail_replica` examples from old 2.3 docs as a
current supported design. Shared filesystem/replication choice remains subject to
vendor support, concurrency and failover testing. Commercial Dovecot Pro is a
separate licensing and architecture decision, not implicitly available.

## Identity and protocol authentication

Use existing Authentik issuer with native OX OIDC authorization-code flow; map verified
issuer/subject to immutable Blak identity, tenant, OX context and mailbox. Validate
issuer, audience, expiry, nonce/state, signatures and current membership. No email-only
account linking, reverse-proxy impersonation or embedded master credential in browser.
Auth and refresh endpoints must survive Sydney loss under the same issuer URL.

[OX documents OIDC](https://documentation.open-xchange.com/appsuite/security/oidc.html),
but older [SSO guidance](https://documentation.open-xchange.com/8/middleware/login_and_sessions/openid_connect_1.0_sso.html)
is marked deprecated. Qualify current release settings before shipping. OX browser
SSO alone does not prove IMAP authentication. Test OX forwarding/obtaining an access
token accepted by Dovecot with correct audience; prohibit one global mailbox master
password as a shortcut. If token interoperability is unavailable, record supported
server-side credential design and its blast radius as a reviewed exception.

Human users reuse existing phishing-resistant Blak ID sessions; privileged actions
require recent privileged authentication. IMAP/SMTP clients supporting OAuth use
scoped tokens. Other clients use revocable per-device app passwords, not the user's
Blak ID password. Application SMTP credentials are distinct, randomly generated,
tenant/service/sender scoped, hash-only, shown once and never SES credentials.
Revoke sessions/tokens/app passwords on disable and tenancy change; publish invalidation
to OX/Dovecot/Postfix. Cache bounds must not exceed the tested revocation objective.

## Postfix abstraction

All applications use `smtp.blakworkspace.au` on TLS submission, regardless of region.
Ingress 25 and submission 587/465 use separate service policies. Anonymous inbound
mail is accepted only for verified local recipients; unauthenticated external relay
is denied. Submission requires authenticated principal, allowed envelope sender and
authorised header From, with delegated-send-as policy explicitly represented.

No broad VPC CIDR in `mynetworks` to bypass authentication. Limit connections,
recipients, MIME/message size and per-service/tenant send rate. Validate policy at
submission and again before delivery after credential/tenant suspension. Null sender
is permitted for genuine internal DSNs only; reject unknown inbound recipients before
DATA to avoid backscatter. Disable catch-all by default. Apply consistent anti-abuse
policy on secondary MX. Store queue IDs with region/instance generation because they
are not globally unique. Queue expiry and bounce policy are visible to administrators.

## SES Sydney

Initial mature transport: Postfix SMTP client with verified TLS peer to
`email-smtp.ap-southeast-2.amazonaws.com:587` through a regional interface endpoint.
SES SMTP uses a regional derived password; it **does not accept temporary-role SMTP
credentials**. Store only delivery-service credentials in Sydney Secrets Manager,
retrieve with instance role, materialise mode-0600 runtime map, rotate with bounded
overlap and remove old map/credential after proof. Never put values in Terraform
state, images, application env manifests or user-visible settings.
[AWS SMTP credentials](https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html).

Future API transport can use workload roles, but only through a qualified Postfix
transport/service adapter with durable queue semantics; do not reinvent SMTP or
pretend Postfix itself signs SigV4. Global IAM-derived SMTP credential metadata is
part of the explicit residency review. A strict no-global-secret interpretation
may require that API option before release.

For each tenant domain: ownership TXT proof, SES domain identity, DKIM, custom MAIL
FROM `bounce.<domain>` with Sydney feedback MX and SPF, configuration-set binding,
sandbox exit, quota allocation and send tests. Choose MAIL FROM failure behaviour
`RejectMessage` rather than silently abandoning alignment. DMARC begins in monitored
mode during onboarding, then moves to reject after legitimate senders are accounted
for. Do not add tenant-wide SPF to unrelated domain records without review.
[MAIL FROM](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html).

Publish bounce/complaint/delivery/reject/delay events to regional encrypted SNS/SQS.
Use strict source account/ARN policies; verify origin, deduplicate and correlate via
server-owned delivery ID and tenant, never arbitrary supplied SES tags. Strip
user-supplied provider configuration headers and inject trusted values. Suppress hard
bounces and complaints; distinguish tenant opt-out from provider-level suppression.
Shared provider suppression must not reveal another tenant's recipients. Keep AU DR
relay suppression policy reconciled. Disable engagement tracking.
[Event publishing](https://docs.aws.amazon.com/ses/latest/dg/monitor-using-event-publishing.html).

SES delivery success is an MTA acceptance event, not proof of inbox placement.
Uncertain timeout outcomes can duplicate messages; retain correlation/reconciliation
and never promise exactly-once external delivery. Dedicated IP pools require measured
volume, warm-up and abuse isolation; not automatically better for a small service.
