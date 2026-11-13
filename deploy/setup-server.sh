#!/usr/bin/env bash
# One-time set-up of the Callback demo on a CloudPanel server. Run as root ON
# THE SERVER, from the folder holding this script. Safe to run again.
#   DOMAIN=callback.denishoti.dev bash setup-server.sh
set -euo pipefail
DOMAIN="${DOMAIN:?set DOMAIN, e.g. callback.example.com}"
SITE_USER=callback
APP=/home/$SITE_USER/app
PORT=8090

command -v ffmpeg >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg; }

# The site (nginx vhost proxying to 127.0.0.1:$PORT) and its own Linux user,
# through CloudPanel so its config stays CloudPanel's. The password is random
# and never shown; log in as root and use `sudo -u callback` instead.
if ! id "$SITE_USER" >/dev/null 2>&1; then
  clpctl site:add:reverse-proxy --domainName="$DOMAIN" --reverseProxyUrl="http://127.0.0.1:$PORT" \
    --siteUser="$SITE_USER" --siteUserPassword="$(openssl rand -base64 30 | tr -d '/+=')"
fi

install -d -o "$SITE_USER" -g "$SITE_USER" -m 750 "$APP" "$APP/backend" "$APP/frontend-dist"
[ -x "$APP/backend/.venv/bin/python" ] || sudo -u "$SITE_USER" python3.12 -m venv "$APP/backend/.venv"

install -m 644 callback.service /etc/systemd/system/callback.service
systemctl daemon-reload
systemctl enable callback >/dev/null
nginx -t
echo "Set up. Next: deploy the code (deploy/deploy.sh on the laptop), then:"
echo "  clpctl lets-encrypt:install:certificate --domainName=$DOMAIN   (once DNS points here)"
