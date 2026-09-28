terraform {
  required_version = ">= 1.7.0, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.66.0"
    }
  }
  backend "s3" {}
}
variable "account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "An explicit approved account ID is required."
  }
}
variable "bucket_name" { type = string }
variable "retention_days" { type = number }
variable "writer_role_arn" { type = string }
variable "restore_role_arn" { type = string }
provider "aws" {
  region              = "ap-southeast-2"
  allowed_account_ids = [var.account_id]
}
module "archive" {
  source           = "../../security/storage"
  region           = "ap-southeast-2"
  bucket_name      = var.bucket_name
  retention_days   = var.retention_days
  writer_role_arn  = var.writer_role_arn
  restore_role_arn = var.restore_role_arn
}
output "archive_bucket_arn" { value = module.archive.bucket_arn }
output "archive_key_arn" { value = module.archive.key_arn }
