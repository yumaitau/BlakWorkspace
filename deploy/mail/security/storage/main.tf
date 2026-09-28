terraform {
  required_version = ">= 1.7.0, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.66.0"
    }
  }
}

variable "region" {
  type = string
  validation {
    condition     = contains(["ap-southeast-2", "ap-southeast-4"], var.region)
    error_message = "Mail storage is restricted to Sydney and Melbourne."
  }
}

variable "bucket_name" {
  type = string
  validation {
    condition     = can(regex("^blak-mail-[a-z0-9][a-z0-9-]{3,48}[a-z0-9]$", var.bucket_name))
    error_message = "Use an opaque blak-mail- bucket name without customer identifiers."
  }
}

variable "retention_days" {
  type = number
  validation {
    condition     = var.retention_days >= 35 && var.retention_days <= 3650 && floor(var.retention_days) == var.retention_days
    error_message = "Select an approved whole-day immutable retention from 35 to 3650 days."
  }
}

variable "writer_role_arn" {
  type = string
  validation {
    condition     = can(regex("^arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9_+=,.@/-]+$", var.writer_role_arn))
    error_message = "An explicit backup writer role is required."
  }
}

variable "restore_role_arn" {
  type = string
  validation {
    condition     = can(regex("^arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9_+=,.@/-]+$", var.restore_role_arn))
    error_message = "An independent restore role is required."
  }
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

resource "aws_kms_key" "archive" {
  description             = "Blak mail regional immutable archive"
  enable_key_rotation     = true
  multi_region            = false
  deletion_window_in_days = 30
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "AccountKeyAdministration", Effect = "Allow", Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }, Action = "kms:*", Resource = "*" },
      { Sid = "ArchiveWrite", Effect = "Allow", Principal = { AWS = var.writer_role_arn }, Action = ["kms:GenerateDataKey", "kms:Decrypt"], Resource = "*",
      Condition = { StringEquals = { "kms:ViaService" = "s3.${var.region}.amazonaws.com" }, ArnLike = { "kms:EncryptionContext:aws:s3:arn" = "arn:aws:s3:::${var.bucket_name}/records/*" } } },
      { Sid = "ArchiveRestore", Effect = "Allow", Principal = { AWS = var.restore_role_arn }, Action = ["kms:Decrypt"], Resource = "*",
      Condition = { StringEquals = { "kms:ViaService" = "s3.${var.region}.amazonaws.com" }, ArnLike = { "kms:EncryptionContext:aws:s3:arn" = "arn:aws:s3:::${var.bucket_name}/records/*" } } }
    ]
  })
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = data.aws_region.current.region == var.region
      error_message = "Provider region does not match the approved archive region."
    }
    precondition {
      condition     = var.writer_role_arn != var.restore_role_arn
      error_message = "Archive writer and restore identities must be separate."
    }
  }
}

resource "aws_s3_bucket" "archive" {
  bucket              = var.bucket_name
  object_lock_enabled = true
  force_destroy       = false
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_public_access_block" "archive" {
  bucket                  = aws_s3_bucket.archive.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "archive" {
  bucket = aws_s3_bucket.archive.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_versioning" "archive" {
  bucket = aws_s3_bucket.archive.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "archive" {
  bucket = aws_s3_bucket.archive.id
  rule {
    # Preserve object ARN encryption context for prefix-scoped KMS permissions.
    bucket_key_enabled = false
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.archive.arn
    }
  }
}

resource "aws_s3_bucket_object_lock_configuration" "archive" {
  bucket = aws_s3_bucket.archive.id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.retention_days
    }
  }
  depends_on = [aws_s3_bucket_versioning.archive]
}

resource "aws_s3_bucket_policy" "archive" {
  bucket = aws_s3_bucket.archive.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "DenyPlaintextTransport", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.archive.arn, "${aws_s3_bucket.archive.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } },
      { Sid = "RequireKMS", Effect = "Deny", Principal = "*", Action = "s3:PutObject", Resource = "${aws_s3_bucket.archive.arn}/*", Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption" = "aws:kms" } } },
      { Sid = "RequireRegionalKey", Effect = "Deny", Principal = "*", Action = "s3:PutObject", Resource = "${aws_s3_bucket.archive.arn}/*", Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption-aws-kms-key-id" = aws_kms_key.archive.arn } } },
      { Sid = "WriterCannotReadOrChangeRetention", Effect = "Deny", Principal = "*", Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:PutObjectRetention", "s3:PutObjectLegalHold", "s3:BypassGovernanceRetention"], Resource = "${aws_s3_bucket.archive.arn}/*", Condition = { ArnEquals = { "aws:PrincipalArn" = var.writer_role_arn } } },
      { Sid = "Writer", Effect = "Allow", Principal = { AWS = var.writer_role_arn }, Action = ["s3:PutObject", "s3:AbortMultipartUpload"], Resource = "${aws_s3_bucket.archive.arn}/records/*" },
      { Sid = "Restore", Effect = "Allow", Principal = { AWS = var.restore_role_arn }, Action = ["s3:GetObject", "s3:GetObjectVersion"], Resource = "${aws_s3_bucket.archive.arn}/records/*" },
      { Sid = "RestoreInventory", Effect = "Allow", Principal = { AWS = var.restore_role_arn }, Action = ["s3:ListBucket", "s3:ListBucketVersions"], Resource = aws_s3_bucket.archive.arn, Condition = { StringLike = { "s3:prefix" = "records/*" } } }
    ]
  })
}

output "bucket_arn" { value = aws_s3_bucket.archive.arn }
output "key_arn" { value = aws_kms_key.archive.arn }
