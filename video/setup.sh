#!/usr/bin/env bash
# One-time setup of the Callback video kit on a Mac: bash video/setup.sh
# Installs the Python tools, Playwright (app recordings), Remotion (motion
# graphics) and the HeyGen / Remotion / ElevenLabs skills for Claude Code.
set -euo pipefail
cd "$(dirname "$0")"

command -v ffmpeg >/dev/null || { echo "Installing ffmpeg with Homebrew"; brew install ffmpeg; }
command -v node >/dev/null || { echo "Node 22 is needed (https://nodejs.org)"; exit 1; }

python3 -m venv tools/.venv
tools/.venv/bin/pip install -q -r tools/requirements.txt
(cd tools && npm install --silent && npx -y playwright install chromium)
(cd remotion && npm install --silent)
mkdir -p raw work out references .secrets

# Agent skills for Claude Code (user level, so they work in any folder).
npx -y skills add heygen-com/skills -a claude-code -g -y -s heygen-avatar -s heygen-video -s heygen-translate
npx -y skills add remotion-dev/skills -a claude-code -g -y -s remotion-best-practices -s remotion-captions \
  -s remotion-create -s remotion-multimedia -s remotion-render
npx -y skills add elevenlabs/skills -a claude-code -g -y -s voice-changer -s voice-isolator -s text-to-speech \
  -s speech-to-text -s sound-effects -s music -s dubbing

[ -f .env ] || echo "Last step: put ELEVENLABS_API_KEY=... in video/.env (it is never committed)."
echo "HeyGen: run 'claude mcp add --transport http -s user heygen https://mcp.heygen.com/mcp/v1/', then /mcp in Claude Code to sign in."
echo "Done. Read video/README.md, or ask Claude to 'edit a reel from video/raw'."
