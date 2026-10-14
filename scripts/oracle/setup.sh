#!/usr/bin/env bash
# GRAB server on an Oracle Cloud "Always Free" Ubuntu VM (ARM or x86).
# Installs Docker, builds the server, runs it with automatic restarts and free HTTPS (Caddy).
#
#   curl -fsSL https://raw.githubusercontent.com/umangpatel2191/grab/main/scripts/oracle/setup.sh | bash
#   # or with your own domain:  ... | bash -s -- grab.example.com
#
# Without a domain it uses <your-ip>.sslip.io, a free name that points at your IP.
set -euo pipefail

REPO="https://github.com/umangpatel2191/grab.git"
DIR="$HOME/grab"

echo "==> Installing Docker and tools"
sudo apt-get update -y
sudo apt-get install -y docker.io git curl iptables-persistent
sudo systemctl enable --now docker

echo "==> Opening ports 80 and 443 in the VM firewall (Oracle images block them by default)"
for p in 80 443; do
  sudo iptables -C INPUT -p tcp -m state --state NEW --dport "$p" -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 6 -p tcp -m state --state NEW --dport "$p" -j ACCEPT
done
sudo netfilter-persistent save

echo "==> Getting the code"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO" "$DIR"; fi

echo "==> Building the server image (first time: 5-10 minutes)"
sudo docker build -t grab-server -f "$DIR/server/Dockerfile" "$DIR"

# A stable secret so saved scans can be restored after restarts.
SECRET_FILE="$HOME/.grab-secret"
[ -f "$SECRET_FILE" ] || head -c 32 /dev/urandom | base64 | tr -d '/+=' > "$SECRET_FILE"
chmod 600 "$SECRET_FILE"

# Use the machine: more memory means more browser pages at once.
MEM_GB=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo)
DEEP=$(( MEM_GB >= 12 ? 4 : MEM_GB >= 4 ? 2 : 1 ))

echo "==> Starting GRAB (memory ${MEM_GB} GB, ${DEEP} browser pages at once)"
sudo docker rm -f grab >/dev/null 2>&1 || true
sudo docker run -d --name grab --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  --shm-size=1g \
  -e GRAB_SECRET="$(cat "$SECRET_FILE")" \
  -e GRAB_DEEP_CONCURRENCY="$DEEP" \
  -e GRAB_CRAWL_CONCURRENCY=6 \
  grab-server

DOMAIN="${1:-$(curl -fsS https://api.ipify.org | tr . -).sslip.io}"
echo "==> HTTPS for https://$DOMAIN"
sudo mkdir -p /etc/grab-caddy
printf '%s {\n  encode gzip\n  reverse_proxy 127.0.0.1:8787\n}\n' "$DOMAIN" | sudo tee /etc/grab-caddy/Caddyfile >/dev/null
sudo docker rm -f grab-caddy >/dev/null 2>&1 || true
sudo docker run -d --name grab-caddy --restart unless-stopped --network host \
  -v /etc/grab-caddy/Caddyfile:/etc/caddy/Caddyfile:ro \
  -v grab-caddy-data:/data -v grab-caddy-config:/config \
  caddy:2

echo "==> Waiting for the server and the certificate"
for i in $(seq 1 60); do
  if curl -fsS "https://$DOMAIN/v1/health" >/dev/null 2>&1; then
    echo
    echo "GRAB is live:  https://$DOMAIN"
    curl -fsS "https://$DOMAIN/v1/health"; echo
    echo
    echo "Send this address so the plugin can be pointed at it."
    exit 0
  fi
  sleep 5
done
echo "Not reachable over HTTPS yet. Check the Oracle 'Ingress rules' step (ports 80 and 443) and run:"
echo "  sudo docker logs grab-caddy --tail 50"
exit 1
