# Australian service and feature availability

Public documentation verified 2026-09-28. An endpoint listing proves regional service
presence, **not** enabled account access, capacity, quotas, feature parity or residency
of every control-plane operation. Account-level probes and synthetic deployment
evidence remain a release gate. Melbourne is an opt-in region. Do not infer a service
exists by constructing an endpoint hostname.

| Service / required feature | Sydney | Melbourne | Evidence and decision |
| --- | --- | --- | --- |
| EC2 / regional compute, VPC, EBS | Yes | Yes | [EC2 endpoints](https://docs.aws.amazon.com/ec2/latest/devguide/ec2-endpoints.html); instance/AZ offerings, encrypted gp3 capacity, port-25 restriction and quotas require account probes |
| ALB/NLB | Yes | Yes | [ELB endpoints](https://docs.aws.amazon.com/general/latest/gr/elb.html); regional TLS/web and TCP mail ingress; test AZ removal and source IP handling |
| EFS Regional | Yes | Yes | [Endpoints](https://docs.aws.amazon.com/general/latest/gr/elasticfilesystem.html); [replication](https://docs.aws.amazon.com/efs/latest/ug/efs-replication.html) supported wherever EFS exists, including opted-in regions; asynchronous and not a zero-loss guarantee |
| RDS MySQL/PostgreSQL | Yes, service | Yes, service | [Endpoints](https://docs.aws.amazon.com/general/latest/gr/rds-service.html), [replica constraints](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.XRgn.html); exact engine version, Multi-AZ instance class and encrypted cross-region replica combination must pass `describe-db-engine-versions` / orderable-option and restore tests before selection |
| S3 standard, versioning, Object Lock | Yes | Yes | [Endpoints](https://docs.aws.amazon.com/general/latest/gr/s3.html), [Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html); use regional buckets, independent KMS keys; no multi-region access points or Transfer Acceleration |
| KMS regional symmetric keys | Yes | Yes | [Endpoints](https://docs.aws.amazon.com/general/latest/gr/kms.html); separate keys and policies; DR cannot require Sydney decrypt |
| Secrets Manager | Yes | Yes | [Endpoints](https://docs.aws.amazon.com/general/latest/gr/asm.html); separate AU secrets; replication only explicit AU destinations; rotations must work during isolation |
| CloudWatch metrics/alarms | Yes | Yes | [Endpoints](https://docs.aws.amazon.com/general/latest/gr/cw_region.html); independent regional alarms; no mail-only alert channel |
| CloudWatch Logs | Yes | Yes | [Endpoints](https://docs.aws.amazon.com/general/latest/gr/cwl_region.html); KMS encryption, retention, regional collectors; redact sensitive headers |
| CloudTrail regional trails | Yes | Yes | [Endpoints](https://docs.aws.amazon.com/general/latest/gr/ct.html); trail storage regional; do not assume CloudTrail Lake/data APIs share regional parity |
| GuardDuty | Yes | Yes, feature differences | [Regions](https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_regions.html); foundational threat detection selected; validate each optional protection plan before enabling |
| Security Hub CSPM | Yes, controls vary | Yes, controls vary | [Regional control limits](https://docs.aws.amazon.com/securityhub/latest/userguide/regions-controls.html); Melbourne lacks some controls, including Backup.1 on review date; implement equivalent backup-encryption tests. Do not substitute Security Hub V2 parity without checking |
| AWS Backup | Yes | Yes, opt-in | [Endpoints](https://docs.aws.amazon.com/general/latest/gr/bk.html), [feature matrix](https://docs.aws.amazon.com/aws-backup/latest/devguide/backup-feature-availability.html); cross-region/account copy and restore testing listed for Melbourne. Qualify selected EFS/EBS/RDS resource combination and Vault Lock |
| ECR private registry | Yes | Yes | [Endpoints](https://docs.aws.amazon.com/general/latest/gr/ecr.html); explicit AU replication and pre-staged image digests; no runtime dependency on public registry |
| SNS / SQS | Yes | Yes | [SNS](https://docs.aws.amazon.com/general/latest/gr/sns.html), [SQS](https://docs.aws.amazon.com/general/latest/gr/sqs-service.html); KMS-encrypted feedback and regional alarm queues; no foreign subscriptions |
| Systems Manager | Yes | Yes | [Endpoints](https://docs.aws.amazon.com/general/latest/gr/ssm.html); regional management/session logs; exact required VPC endpoints tested |
| ACM regional certificates | Yes | Yes | [Endpoints](https://docs.aws.amazon.com/general/latest/gr/acm.html); regional load balancers; Postfix certificate distribution separately qualified, no assumed export rights |
| Regional STS | Yes | Yes | [Endpoints](https://docs.aws.amazon.com/general/latest/gr/sts.html); force explicit regional endpoint, never global fallback |
| SES API / SMTP / receiving | Yes | **Not listed** | [Official endpoint tables](https://docs.aws.amazon.com/general/latest/gr/ses.html); no SES Melbourne resources, no guessed endpoint, no Singapore fallback |
| SES DKIM, MAIL FROM, events, suppression, quotas | Sydney design | Unavailable with absent service | [Regional scope](https://docs.aws.amazon.com/ses/latest/dg/regions.html); independently provision and test each Sydney feature; do not treat Sydney identities as portable |
| SES private SMTP connectivity | Sydney supported by service docs | No SES endpoint | [PrivateLink](https://docs.aws.amazon.com/ses/latest/dg/send-email-set-up-vpc-endpoints.html); verify actual service/AZ offerings; do not equate private connectivity with residency certification |
| SES dedicated IPs | Optional; qualify selected pool type | No SES endpoint | Not a day-one dependency. Volume/reputation case and regional feature/quota evidence required before enablement |
| SES multi-region/global endpoints | Not selected | Not selected | Would not solve missing independent AU secondary; no automatic region selection |
| IAM / Organizations | Global | Global | [IAM architecture](https://docs.aws.amazon.com/IAM/latest/UserGuide/disaster-recovery-resiliency.html); opaque control metadata exception needs explicit acceptance |
| Route 53 / CloudFront / global health checks | Not runtime dependencies | Not runtime dependencies | Use AU DNS/probes, regional ALB; see residency analysis |
| ECS/EKS, WAF, Inspector, Config, Security Lake, Aurora Global Database | Not selected | Not selected | Require separate feature/residency review if added; no implied feature availability |

## Reverification procedure

Before every regional release, record source URLs/dates and run read-only probes in
the explicitly selected account: enabled regions/AZs, EC2 offerings, VPC endpoint
service availability, RDS versions/options, service quotas and SES `get-account` in
Sydney. Never log credentials or raw customer inventories. Check SES endpoint tables
for Melbourne again; availability changes require an ADR update, independent domain
verification and sandbox exit, not merely switching a flag.

Feature qualification includes actual private connection, KMS-encrypted write/read,
cross-region copy, restore under the destination key and loss of Sydney. Unverified
features remain disabled. A document matrix must not be interpreted as proof that
AWS resources have been created or that a particular account has production access.
