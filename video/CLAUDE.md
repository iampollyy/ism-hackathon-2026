# Callback video kit: notes for Claude

This folder makes Callback's marketing videos: Instagram reels, TikTok and
Shorts, and the 3-minute Devpost submission video. People drop footage in
`raw/`; Claude transcribes, cuts, captions, brands and exports; a person
watches every cut on a phone before anything is posted. Commands and the
edit-list format are in `README.md`; first-time setup is `bash setup.sh`.

## Where things go

| Folder | What | In git? |
| --- | --- | --- |
| `raw/` | team footage, app recordings | never |
| `references/` | screenshots or links of reels whose style to match | never |
| `work/` | transcripts, edit lists (`*.edl.json`), stills | never |
| `out/` | finished videos and thumbnails | never; share through the team Drive |
| `tools/` | Python and Node scripts | yes |
| `remotion/` | motion graphics in React (the cold open lives here) | yes, without `node_modules` |
| `sfx/`, `fonts/` | brand sounds, Space Grotesk and Inter (OFL) | yes |

Keys: `ELEVENLABS_API_KEY` in `video/.env` (ignored by git). Read it inside
the process; never print it, paste it in chat, or commit it. HeyGen works
through its MCP server (`/mcp` sign-in); each person's avatar lives in that
person's own HeyGen account.

## The workflow

1. `tools/.venv/bin/python tools/transcribe.py raw/*` (ElevenLabs speech-to-text, word timestamps).
2. Read the transcripts and pick the best takes; write `work/<name>.edl.json`.
3. `tools/.venv/bin/python tools/edit.py work/<name>.edl.json` writes `out/<name>.mp4`.
4. `tools/.venv/bin/python tools/stills.py out/<name>.mp4` and look at the stills; fix once.
5. Hand the cut to a person to watch on a phone. Revise from what they say.

Motion graphics, phone mock-ups and kinetic text: `remotion/` (`npx remotion studio`
to preview, `bash render.sh` to render). Voice: `tools/voice.py` (voices,
change, isolate). Brand: `../brand/README.md` and `../brand/tokens/`.

## What makes it look real

Start from a human performance, then let AI adjust it. Real faces on camera beat
avatars. For a caller's voice, a teammate acts the line and `voice.py change`
turns it into the target voice. Text-to-speech (eleven_v3 or v4 with audio tags)
is the backup. Time every caption and cut to the transcript's word timestamps.

## Rules

- Consent first: everyone filmed or voice-cloned agrees to marketing use beforehand. The in-app consent covers practice calls only, not videos.
- Label AI: any AI face or voice gets "Dramatised · AI voice" on the post and Instagram's AI label.
- Copy says family, parents or loved ones. Don't lean on "mum/mom" lines ("would your mum know", "bring your mum"): in many cultures they read as disrespectful.
- Never mock someone who fell for a scam; the hero is the person who asks for the family word.
- No real bank, police or company names or logos in fake calls; no invented statistics.
- Blur invite links, QR codes, phone numbers and emails before export.
- Never commit footage, renders, references or keys, and never force-add them past `.gitignore`.
- ElevenLabs credit is shared: check `GET /v1/user/subscription` before large runs, prefer short takes, and don't clone a voice without the person's OK.
