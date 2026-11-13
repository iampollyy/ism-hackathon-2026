#!/usr/bin/env bash
# Deploy the committed back end and the current front end build to the server.
# Run ON THE LAPTOP from the repo root:  bash deploy/deploy.sh
#   DEPLOY_HOST  ssh host (default web-01)    FIRST_ENV=1  also copy backend/.env
set -euo pipefail
HOST="${DEPLOY_HOST:-web-01}"
APP=/home/callback/app
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if ! git diff --quiet HEAD -- backend; then
  echo "Note: backend/ has uncommitted changes; only the committed version is deployed."
fi

echo "Building the front end..."
npm --prefix frontend ci --silent
npm --prefix frontend run build --silent

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git archive HEAD backend | tar -x -C "$TMP"

echo "Copying to $HOST..."
rsync -a --delete --exclude .venv --exclude data --exclude media --exclude .env \
  "$TMP/backend/" "$HOST:$APP/backend/"
rsync -a --delete frontend/dist/ "$HOST:$APP/frontend-dist/"
if [ "${FIRST_ENV:-0}" = "1" ]; then
  rsync -a --chmod=F600 backend/.env "$HOST:$APP/backend/.env"
fi

ssh "$HOST" bash -s <<REMOTE
set -euo pipefail
chown -R callback:callback $APP
sudo -u callback $APP/backend/.venv/bin/pip install -q -r $APP/backend/requirements.txt
systemctl restart callback
for i in \$(seq 1 30); do curl -fs http://127.0.0.1:8090/api/health >/dev/null && break; sleep 0.5; done
curl -fs http://127.0.0.1:8090/api/health && echo
REMOTE
echo "Deployed $(git rev-parse --short HEAD)."
