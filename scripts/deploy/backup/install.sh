#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
sudo install -d -m 700 /etc/blak-backup /var/backups/blak-workspace
sudo install -d /opt/blak-backup
sudo install -m 700 workspace-backup.py backup-agent.py vault-snapshot.py /opt/blak-backup/
sudo install -m 600 backup_places.py /opt/blak-backup/backup_places.py
sudo sh -c 'umask 077; test -f /etc/blak-backup/key || openssl rand -base64 48 > /etc/blak-backup/key'
sudo sh -c 'umask 077; test -f /etc/blak-backup/agent-token || openssl rand -hex 32 > /etc/blak-backup/agent-token'
# Blak Home reads the same agent token from a secret. Never print it.
sudo k3s kubectl -n blak-micro create secret generic blak-backup-agent \
  --from-file=token=/etc/blak-backup/agent-token --dry-run=client -o yaml \
  | sudo k3s kubectl apply -f - >/dev/null
# SMB and NFS places need mount helpers. Folder and S3 places do not.
if command -v apt-get >/dev/null && ! { command -v mount.cifs && command -v mount.nfs; } >/dev/null; then
  sudo apt-get install -y --no-install-recommends cifs-utils nfs-common >/dev/null
fi
sudo install -m 644 blak-workspace-backup.service blak-workspace-backup.timer blak-workspace-restore.service blak-workspace-restore.timer blak-workspace-full-restore.service blak-backup-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now blak-workspace-backup.timer blak-workspace-restore.timer
sudo systemctl enable blak-backup-agent.service
sudo systemctl restart blak-backup-agent.service
