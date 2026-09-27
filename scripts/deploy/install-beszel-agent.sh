#!/usr/bin/env bash
# Run as root on the monitored Linux amd64 host. Argument is the private agent env.
set -euo pipefail
[[ $EUID == 0 && $(uname -m) == x86_64 ]] || { echo 'Requires root on Linux amd64'; exit 1; }
[[ $# == 1 && -f $1 && ! -L $1 ]] || { echo 'Provide the private agent environment file'; exit 1; }
VERSION=0.20.0
SHA256=f03b8ec7349a8133a0329ef50619bc3a97a7bb0a0e423866416ecc818cebc43c
TASK_TMP=$(mktemp -d)
trap 'rm -rf "$TASK_TMP"' EXIT
curl --fail --silent --show-error --location "https://github.com/henrygd/beszel/releases/download/v$VERSION/beszel-agent_linux_amd64.tar.gz" -o "$TASK_TMP/agent.tar.gz"
printf '%s  %s\n' "$SHA256" "$TASK_TMP/agent.tar.gz" | sha256sum --check --status
tar -xzf "$TASK_TMP/agent.tar.gz" -C "$TASK_TMP" beszel-agent
id beszel-agent >/dev/null 2>&1 || useradd --system --home-dir /var/lib/beszel-agent --shell /usr/sbin/nologin beszel-agent
install -d -m 750 -o beszel-agent -g beszel-agent /var/lib/beszel-agent
install -d -m 700 /etc/beszel-agent
install -m 600 "$1" /etc/beszel-agent/agent.env
install -m 755 "$TASK_TMP/beszel-agent" /usr/local/bin/beszel-agent
cat > /etc/systemd/system/beszel-agent.service <<'UNIT'
[Unit]
Description=Beszel host performance agent
After=network-online.target k3s.service
Wants=network-online.target
[Service]
User=beszel-agent
Group=beszel-agent
EnvironmentFile=/etc/beszel-agent/agent.env
ExecStart=/usr/local/bin/beszel-agent
WorkingDirectory=/var/lib/beszel-agent
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/beszel-agent
PrivateTmp=true
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now beszel-agent
systemctl restart beszel-agent
systemctl is-active beszel-agent
