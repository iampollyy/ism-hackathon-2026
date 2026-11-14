"""Transcribe clips with ElevenLabs speech-to-text, word by word.

    tools/.venv/bin/python tools/transcribe.py raw/*.mov
    tools/.venv/bin/python tools/transcribe.py --force raw/take3.mov

Writes work/<clip>.words.json: {"text", "language", "words": [{"text", "start", "end"}]}
and work/<clip>.txt (a readable transcript with timestamps every few words).
Clips already transcribed are skipped unless --force."""

import json
import sys
import tempfile
from pathlib import Path

from common import WORK, client, has_audio, resolve, run, words_path

MODEL = "scribe_v2"


def transcribe(src: Path, force: bool = False) -> Path:
    target = words_path(src)
    if target.exists() and not force:
        print(f"skip {src.name} (already transcribed)")
        return target
    if not has_audio(src):
        target.write_text(json.dumps({"text": "", "language": None, "words": []}))
        print(f"{src.name}: no audio track, empty transcript")
        return target
    with tempfile.TemporaryDirectory() as tmp:
        audio = Path(tmp) / "audio.m4a"
        run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "64k", str(audio)])
        with client() as http, audio.open("rb") as handle:
            response = http.post("/v1/speech-to-text", data={"model_id": MODEL, "timestamps_granularity": "word",
                                                             "tag_audio_events": "false"},
                                 files={"file": ("audio.m4a", handle, "audio/mp4")})
    if response.status_code != 200:
        raise SystemExit(f"{src.name}: speech-to-text failed ({response.status_code}): {response.text[:300]}")
    body = response.json()
    words = [{"text": w["text"], "start": round(float(w["start"]), 3), "end": round(float(w["end"]), 3)}
             for w in body.get("words", []) if w.get("type", "word") == "word" and w.get("text", "").strip()]
    target.write_text(json.dumps({"text": body.get("text", ""), "language": body.get("language_code"), "words": words},
                                 ensure_ascii=False, indent=1))
    lines, line = [], []
    for word in words:
        if not line:
            line.append(f"[{word['start']:6.2f}]")
        line.append(word["text"])
        if len(line) > 10 or word["text"].endswith((".", "?", "!")):
            lines.append(" ".join(line))
            line = []
    if line:
        lines.append(" ".join(line))
    (WORK / f"{src.stem}.txt").write_text("\n".join(lines) + "\n")
    print(f"{src.name}: {len(words)} words -> {target.name}")
    return target


if __name__ == "__main__":
    args = sys.argv[1:]
    force = "--force" in args
    WORK.mkdir(exist_ok=True)
    for arg in [a for a in args if a != "--force"]:
        transcribe(resolve(arg), force)
