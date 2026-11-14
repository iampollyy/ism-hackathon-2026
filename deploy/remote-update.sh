#!/usr/bin/env bash
# Runs ON THE SERVER after new files are copied in, piped over ssh:
#   ssh HOST 'bash -s' < deploy/remote-update.sh
# Works as root (deploy.sh) or as the site user `callback` (CI): installs the
# requirements into the venv, restarts the service, waits for health.
set -euo pipefail
APP=/home/callback/app
me="$(id -un)"
as_site() { if [ "$me" = callback ]; then "$@"; else sudo -u callback -H "$@"; fi; }

[ "$me" = root ] && chown -R callback:callback "$APP"
as_site "$APP/backend/.venv/bin/pip" install -q -r "$APP/backend/requirements.txt"
if [ "$me" = root ]; then systemctl restart callback; else sudo -n /usr/bin/systemctl restart callback; fi

for _ in $(seq 1 60); do
  curl -fs http://127.0.0.1:8090/api/health >/dev/null && break
  sleep 0.5
done
curl -fsS http://127.0.0.1:8090/api/health; echo
