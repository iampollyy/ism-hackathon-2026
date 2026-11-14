#!/usr/bin/env bash
# Render the submission video's cards (src/Cards.tsx): bash render-cards.sh [Name ...]
# Default: all four, wide (1920x1080) and vertical (1080x1920). Each gets a
# silent stereo track so it joins audio clips cleanly in tools/edit.py, and
# two stills in ../work/stills/. Words are in COPY at the top of Cards.tsx.
set -euo pipefail
cd "$(dirname "$0")"
names=("$@")
[ ${#names[@]} -gt 0 ] || names=(TitleCard HowItWorks Roadmap EndCard TitleCardVertical HowItWorksVertical RoadmapVertical EndCardVertical)
mkdir -p ../work/cards ../work/stills ../out
for name in "${names[@]}"; do
  npx remotion render "$name" "../work/cards/$name-raw.mp4" --codec=h264 --crf=16 --is-production=false --log=error
  ffmpeg -hide_banner -loglevel error -y -i "../work/cards/$name-raw.mp4" -f lavfi -i anullsrc=r=48000:cl=stereo \
    -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 128k -shortest -movflags +faststart "../out/$name.mp4"
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "../out/$name.mp4")
  for at in $(python3 -c "d=float('$dur'); print(round(d*0.45,2), round(d-0.6,2))"); do
    ffmpeg -hide_banner -loglevel error -y -ss "$at" -i "../out/$name.mp4" -frames:v 1 "../work/stills/$name-${at}s.jpg"
  done
  echo "wrote ../out/$name.mp4 (${dur}s)"
done
