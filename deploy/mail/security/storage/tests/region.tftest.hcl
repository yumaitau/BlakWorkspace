mock_provider "aws" {
  mock_data "aws_region" { defaults = { region = "ap-southeast-2" } }
  mock_data "aws_caller_identity" { defaults = { account_id = "111111111111" } }
}

variables {
  region           = "ap-southeast-2"
  bucket_name      = "blak-mail-synthetic-test"
  retention_days   = 35
  writer_role_arn  = "arn:aws:iam::111111111111:role/synthetic-writer"
  restore_role_arn = "arn:aws:iam::111111111111:role/synthetic-restore"
}

run "regional_archive" {
  command = plan
  assert {
    condition     = aws_kms_key.archive.multi_region == false && aws_kms_key.archive.enable_key_rotation
    error_message = "Archive key must remain independent and rotate."
  }
  assert {
    condition     = aws_s3_bucket_object_lock_configuration.archive.rule[0].default_retention[0].mode == "COMPLIANCE"
    error_message = "Immutable retention is required."
  }
}

run "foreign_region_denied" {
  command = plan
  variables { region = "ap-southeast-1" }
  expect_failures = [var.region]
}

run "provider_mismatch_denied" {
  command = plan
  variables { region = "ap-southeast-4" }
  expect_failures = [aws_kms_key.archive]
}

run "separate_recovery_identity" {
  command = plan
  variables { restore_role_arn = "arn:aws:iam::111111111111:role/synthetic-writer" }
  expect_failures = [aws_kms_key.archive]
}

run "short_retention_denied" {
  command = plan
  variables { retention_days = 1 }
  expect_failures = [var.retention_days]
}
