# Mail deployment policy foundation

`example.json` is a synthetic, intentionally blocked deployment inventory. It has no credentials and does not create infrastructure.

Run `python3 scripts/mail/check-deployment.py deploy/mail/policy/example.json` from the repository root. Exit 1 is expected until all production gates have genuine evidence. Do not mark gates passed to suppress failures. A hash is an evidence reference, not proof of its content or approval; release automation must retrieve, hash and verify the associated signed AU evidence bundle and live resource inventory.

The validator checks this explicit intent format only. It is not a generic Terraform plan scanner, SCP, network guard or proof of service availability. In particular, S3 bucket ARNs do not contain a region; the region must come from authenticated inventory. Missing/unknown fields, foreign regional ARNs, multi-region KMS keys, unsupported outbound paths and incomplete regional resources fail closed.

Both regions must declare `on_unavailable: hold`, SMTP port 587 and `require_starttls: true`. Sydney uses `ses_smtp`. Melbourne uses `queue_until_ses` with the explicit Sydney SES endpoint; direct-MX and alternate relay routes are rejected. Separate `outage_queue_recovery` and `event_delivery` evidence gates replace the former independent-Melbourne-delivery assumption. These declarations do not install Postfix HOLD or SNS/SQS consumers.

Target reusable AWS/mail/security/DR modules are specified in `docs/mail/architecture.md`; no placeholder module here claims to deploy them.
