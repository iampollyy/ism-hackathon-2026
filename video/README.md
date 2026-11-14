# Callback video kit

Raw footage in, finished reels and the submission video out. This folder sits
outside the public repo on purpose: footage of family members never goes to GitHub.

```
raw/    drop clips here (team footage + app recordings)
references/  screenshots, GIFs or links of reels whose style you like (Claude matches captions, pacing, colours)
work/   transcripts, edit lists, stills, intermediates
out/    finished videos (+ a .jpg thumbnail each)
sfx/    ringtone, whoosh, call-ended, alert (made with ElevenLabs)
fonts/  Space Grotesk Bold, Inter SemiBold (OFL, from google/fonts)
tools/  the scripts
```

## For the team: shooting

- **Drop everything into `raw/`** (AirDrop to the Mac, or a shared Drive folder synced here). Any file names work; one take per file is easiest.
- **Phone settings:** vertical, 1080p or 4K, **30 fps**, the same on every phone. On iPhone, HDR is fine (the editor converts it), but turning off Settings > Camera > Record Video > HDR Video gives truer colours.
- **Sound:** phone close to the mouth, quiet room, no music playing. Say each line **2 or 3 times**, with **1 second of silence** before and after.
- **Framing:** keep faces in the upper middle. Instagram covers the top 14% and the bottom 20% of a reel, and captions sit at about 60% height.
- **The submission video:** shoot one horizontal take of each line too.
- **Consent:** anyone on camera, and any parent in a drill, agrees before we post (see the Launch Playbook).

## For Claude: the commands

Run from this folder (`video/` in the repo). First time: `bash setup.sh`. Python tools use `tools/.venv`; the ElevenLabs key comes from `video/.env` (`ELEVENLABS_API_KEY=...`, never committed) or `backend/.env`, read inside the process and never printed.

```bash
# 1. Transcribe new clips (word timestamps; skips clips already done)
tools/.venv/bin/python tools/transcribe.py raw/*.mov raw/*.mp4
#    -> work/<clip>.words.json and work/<clip>.txt (readable, with timestamps)

# 2. Write an edit list from the transcripts (format below), e.g. work/reel1.edl.json

# 3. Render
tools/.venv/bin/python tools/edit.py work/reel1.edl.json
#    -> out/reel1.mp4 + out/reel1.jpg

# 4. Look at the cut
tools/.venv/bin/python tools/stills.py out/reel1.mp4            # 6 evenly spaced frames
tools/.venv/bin/python tools/stills.py out/reel1.mp4 1.5 7 12   # at these seconds

# App B-roll from the live site, sharp, at 30 fps (phone 1080x1920, desktop 1920x1080)
node tools/record_app.mjs                     # landing-phone, news-phone, news-desktop
node tools/record_app.mjs news-phone          # one shot

# Sound effects (already made; --force makes them again)
tools/.venv/bin/python tools/sfx.py
```

## The edit list (EDL)

```json
{
  "name": "reel1-the-call",
  "format": "reel",
  "captions": true,
  "endcard": true,
  "thumb_at": 1.0,
  "music": "music/track.mp3",
  "music_volume": 0.12,
  "clips": [
    {"src": "raw/take1.mov", "in": 1.2, "out": 6.8, "zoom": 1.05},
    {"src": "raw/app-news-phone.mp4", "in": 1, "out": 4.9, "zoom": 1.08,
     "audio_src": "raw/take1.mov", "audio_in": 6.8},
    {"src": "raw/title.png", "dur": 2}
  ],
  "sfx": [{"src": "sfx/whoosh.mp3", "at": 5.4, "volume": 0.7}]
}
```

- `format`: `reel` (1080x1920) or `wide` (1920x1080, the submission video).
- Each clip: `in`/`out` are seconds in the source. Clips are scaled to fill the frame and centre-cropped.
- `zoom`: slow punch-in to that factor over the clip (1.0 = none, 1.05-1.12 looks natural).
- `audio_src` + `audio_in`: show this clip's picture with another clip's sound and captions from that second. Use it for B-roll over narration.
- `volume` (default 1, 0 = mute), `captions: false` per clip, `dur` for images.
- `captions`: word-by-word, Space Grotesk Bold, white on deep indigo, the spoken word in pink.
- `endcard`: 2 s brand end card (`brand/social/reel-end-card-1080x1920.png`, or the 16:9 card for `wide`).
- `music` (optional, looped and faded out), `sfx` (sounds at given seconds of the output).
- The output is H.264, 30 fps, AAC 48 kHz, loudness -14 LUFS (Instagram and YouTube level).

## What needs a human

- **Watch every cut once on a phone, with sound, before it is posted.** Claude checks transcripts, stills and loudness, not timing feel, lip sync or awkward faces.
- Pick the music in Instagram at upload (licensed there), or put a royalty-free track in `music/`.
- Blur anything private (invite links, QR codes, emails, phone numbers) or tell Claude where it appears.

## Speed

A 12 s test reel (3 clips, captions, end card, two sound effects) renders in about 6 s on this Mac. Expect about 20-60 s for a 30 s reel from 4K phone footage (decoding 4K is most of it); the 3-minute video takes a few minutes. App B-roll is captured at about 2-3x real time (10 s of footage in about 25 s).
