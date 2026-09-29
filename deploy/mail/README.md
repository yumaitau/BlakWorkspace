# Australian mail infrastructure increment

Only immutable regional storage is implemented here. No mail service, VPC, database,
SES identity, secret value or DNS record is provisioned. Remaining modules are tracked
in [delivery milestones](../../docs/mail/delivery.md), not empty deployment stubs.

`aws/syd` and `aws/mel` are independent regional entry points. Supply explicit approved
account ID and pre-existing writer/restore role ARNs. Choose separate backup accounts
from production; role trust and caller IAM permissions must also be reviewed. The
roots deliberately omit backend configuration: initialise against approved regional
S3 state using operator configuration, never run production with local state.

The module adds regional rotating KMS encryption, private versioned S3 storage,
compliance-mode Object Lock, TLS/encryption enforcement and separate writer/restore
grants. No multi-region KMS key, public bucket, cross-region destination or secret
value is created. Object Lock does not prevent an account administrator changing
future bucket policy or disabling a KMS key; organisational guardrails, CloudTrail,
key recovery and independent accounts remain required release gates.

**Applying compliance retention creates an irreversible retention period for affected
object versions.** Select approved retention after staging tests. Source validation
and mocked tests do not create AWS resources:

```sh
terraform -chdir=deploy/mail/security/storage init -backend=false
terraform -chdir=deploy/mail/security/storage validate
terraform -chdir=deploy/mail/security/storage test
```

No auto-apply workflow exists. Regional account feature checks and architecture
exceptions must be closed before paid deployment. Do not copy a real plan or state
into this public repository. Upload synthetic test evidence only.
