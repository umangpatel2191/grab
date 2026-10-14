#!/usr/bin/env bash
# Pull the latest GRAB code and restart the server with it. Settings and HTTPS are kept.
#   bash ~/grab/scripts/oracle/update.sh
set -euo pipefail
DIR="$HOME/grab"
git -C "$DIR" pull --ff-only
sudo docker build -t grab-server -f "$DIR/server/Dockerfile" "$DIR"
MEM_GB=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo)
DEEP=$(( MEM_GB >= 12 ? 4 : MEM_GB >= 4 ? 2 : 1 ))
sudo docker rm -f grab >/dev/null 2>&1 || true
sudo docker run -d --name grab --restart unless-stopped \
  -p 127.0.0.1:8787:8787 --shm-size=1g \
  -e GRAB_SECRET="$(cat "$HOME/.grab-secret")" \
  -e GRAB_DEEP_CONCURRENCY="$DEEP" \
  -e GRAB_CRAWL_CONCURRENCY=6 \
  grab-server
sleep 5
curl -fsS http://127.0.0.1:8787/v1/health && echo && echo "Updated."
