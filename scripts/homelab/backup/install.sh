#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
sudo install -d -m 700 /etc/blak-backup /var/backups/blak-workspace
sudo install -d /opt/blak-backup
sudo install -m 700 workspace-backup.py /opt/blak-backup/workspace-backup.py
sudo sh -c 'umask 077; test -f /etc/blak-backup/key || openssl rand -base64 48 > /etc/blak-backup/key'
sudo install -m 644 blak-workspace-backup.service blak-workspace-backup.timer blak-workspace-restore.service blak-workspace-restore.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now blak-workspace-backup.timer blak-workspace-restore.timer
