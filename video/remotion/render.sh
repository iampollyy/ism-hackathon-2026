#!/usr/bin/env bash
# Render the cold open and set it to -14 LUFS: bash render.sh  (from video/remotion)
set -euo pipefail
cd "$(dirname "$0")"
npx remotion render ColdOpen ../work/coldopen/coldopen-raw.mp4 --codec=h264 --crf=16 --audio-bitrate=320k --is-production=false
ffmpeg -hide_banner -loglevel error -y -i ../work/coldopen/coldopen-raw.mp4 -c:v copy \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11,volume=-1.2dB" -c:a aac -b:a 320k -ar 48000 -movflags +faststart ../out/coldopen-v1.mp4
echo "wrote ../out/coldopen-v1.mp4"
