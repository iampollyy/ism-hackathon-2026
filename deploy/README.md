# Deploying the demo

The back end runs on one server behind nginx (CloudPanel), and serves the
built front end from the same address, so phones need no tunnel.

| File | What it does |
|---|---|
| `setup-server.sh` | Once, as root on the server: ffmpeg, the CloudPanel site and its `callback` user, the app folder, a Python venv, the systemd unit |
| `callback.service` | The systemd unit: uvicorn on 127.0.0.1:8090, one process, `FRONTEND_DIST` set |
| `deploy.sh` | From the laptop: builds the front end, copies the committed `backend/` and `frontend/dist/`, installs requirements, restarts, checks health |

```bash
# once
scp deploy/setup-server.sh deploy/callback.service web-01:/root/callback-setup/
ssh web-01 'cd /root/callback-setup && DOMAIN=callback.denishoti.dev bash setup-server.sh'
FIRST_ENV=1 bash deploy/deploy.sh          # also copies backend/.env (never printed)
ssh web-01 'clpctl lets-encrypt:install:certificate --domainName=callback.denishoti.dev'

# every later deploy
bash deploy/deploy.sh
```

The server's `.env` also sets the daily caps (`DAILY_FAMILY_LIMIT`,
`DAILY_CLONE_LIMIT`, `DAILY_CALL_LIMIT`), so the public address cannot spend
all the ElevenLabs credit, and the VAPID keys for push. Data (SQLite and the
recordings) lives in `/home/callback/app/backend/data` and `media`, which
deploys never touch. Logs: `ssh web-01 journalctl -u callback -f`.

## Automatic deploys (GitHub Actions)

`.github/workflows/deploy.yml` runs on every push to `main` (and by hand from
the Actions tab): back-end tests and the front-end build first; only if both
pass does it copy `backend/` and the new `frontend/dist/` to the server and
restart the service, then check the public site. A failing test means no
deploy, and the site keeps running the last good version.

CI logs in with its own key as the site user `callback`, never as root, and
may only restart its own service. The server's host key is pinned in
`deploy/known_hosts`.

One-time set-up (Denis):

```bash
bash deploy/setup-ci-access.sh     # makes the key, allows it on the server, copies it to the clipboard
```

Then on GitHub: the repo → Settings → Secrets and variables → Actions → New
repository secret, name `DEPLOY_SSH_KEY`, paste. Adding secrets needs admin
rights on the repo; if you don't see Settings, the repo owner adds it.

`deploy/deploy.sh` still works for a deploy from the laptop.
