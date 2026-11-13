#!/usr/bin/env bash
# One-time: give the GitHub Actions deploy its own SSH key on the server.
# Run ON THE LAPTOP, as yourself (it needs your root ssh access to web-01).
#
# What it does:
# 1. Makes a new key pair at ~/.ssh/callback_ci_deploy (no passphrase), used
#    only by CI. The private key never leaves your laptop except into the
#    GitHub secret, by your own paste.
# 2. On the server, lets that key log in as the site user `callback` only
#    (not root), with `restrict` (no forwarding, no terminal).
# 3. Lets `callback` run exactly `systemctl restart callback` and
#    `systemctl is-active callback` with sudo, nothing else.
# 4. Copies the private key to your clipboard, for the GitHub secret.
#
# To undo: delete the line containing "callback-ci-deploy" from
# /home/callback/.ssh/authorized_keys, remove /etc/sudoers.d/callback-deploy,
# and delete the DEPLOY_SSH_KEY secret on GitHub.
set -euo pipefail
HOST="${DEPLOY_HOST:-web-01}"
KEY="$HOME/.ssh/callback_ci_deploy"

[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N "" -C "callback-ci-deploy" -f "$KEY"
PUB="$(cat "$KEY.pub")"

ssh "$HOST" "bash -s" <<REMOTE
set -euo pipefail
AK=/home/callback/.ssh/authorized_keys
touch "\$AK"
grep -q 'callback-ci-deploy' "\$AK" || echo 'restrict $PUB' >> "\$AK"
chown callback:callback "\$AK"; chmod 600 "\$AK"
cat > /tmp/callback-deploy.sudoers <<'S'
# CI deploys as the site user and may only restart its own service.
callback ALL=(root) NOPASSWD: /usr/bin/systemctl restart callback, /usr/bin/systemctl is-active callback
S
visudo -cf /tmp/callback-deploy.sudoers
install -m 440 /tmp/callback-deploy.sudoers /etc/sudoers.d/callback-deploy
rm /tmp/callback-deploy.sudoers
REMOTE

echo "Checking the key: it should log in as callback and may restart the service..."
ssh -i "$KEY" -o IdentitiesOnly=yes callback@callback.denishoti.dev 'id -un; sudo -n /usr/bin/systemctl is-active callback'

pbcopy < "$KEY"
echo
echo "The private key is on your clipboard. On GitHub: the repo -> Settings -> Secrets and variables"
echo "-> Actions -> New repository secret, name DEPLOY_SSH_KEY, paste, save. Then clear the clipboard."
