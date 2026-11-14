"""Voices for realistic video: keep a human performance, change or clean the voice.

    tools/.venv/bin/python tools/voice.py voices
        Lists the account's voices (name, id, kind). Team members' cloned
        voices are here too; use one only with that person's explicit OK for
        marketing (the in-app consent covers practice calls, not videos).

    tools/.venv/bin/python tools/voice.py change raw/take.mov --voice <voice_id> [--keep-noise]
        ElevenLabs Voice Changer (speech-to-speech, eleven_multilingual_sts_v2):
        the performance (timing, emotion, breaths) stays, the voice becomes
        <voice_id>. Writes work/<clip>.<voice>.mp3 and, for a video,
        raw/<clip>-<voice>.mp4 with the new voice, ready for edit.py.

    tools/.venv/bin/python tools/voice.py isolate raw/take.mov
        ElevenLabs Voice Isolator: removes venue noise and music. Writes
        work/<clip>.clean.mp3 and, for a video, raw/<clip>-clean.mp4.
"""

import argparse
import tempfile
from pathlib import Path

from common import RAW, WORK, client, has_audio, resolve, run

STS_MODEL = "eleven_multilingual_sts_v2"
VIDEO_EXT = {".mov", ".mp4", ".m4v", ".webm", ".mkv"}


def extract_audio(src: Path, tmp: Path) -> Path:
    """The clip's sound as a 44.1 kHz mono MP3 (well under the 50 MB limit)."""
    if not has_audio(src):
        raise SystemExit(f"{src.name}: no audio track")
    audio = tmp / "audio.mp3"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "44100", "-b:a", "192k", str(audio)])
    return audio


def mux(video: Path, audio: Path, target: Path) -> None:
    """The original picture with the new sound, same length as the picture."""
    run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-i", str(audio), "-map", "0:v:0", "-map", "1:a:0",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(target)])


def post_audio(path: str, audio: Path, data: dict[str, str]) -> bytes:
    with client(timeout=600) as http, audio.open("rb") as handle:
        response = http.post(path, data=data, files={"audio": ("audio.mp3", handle, "audio/mpeg")})
    if response.status_code != 200:
        raise SystemExit(f"ElevenLabs {path} failed ({response.status_code}): {response.text[:300]}")
    return response.content


def list_voices() -> None:
    with client() as http:
        response = http.get("/v1/voices")
    if response.status_code != 200:
        raise SystemExit(f"listing voices failed ({response.status_code}): {response.text[:300]}")
    for voice in sorted(response.json().get("voices", []), key=lambda v: (v.get("category") or "", v.get("name") or "")):
        print(f"{voice.get('category', ''):<12} {voice.get('voice_id')}  {voice.get('name')}")


def change(src: Path, voice_id: str, keep_noise: bool) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        audio = extract_audio(src, Path(tmp))
        data = {"model_id": STS_MODEL, "output_format": "mp3_44100_192",
                "remove_background_noise": "false" if keep_noise else "true"}
        result = post_audio(f"/v1/voice-changer/{voice_id}", audio, data)
    out_audio = WORK / f"{src.stem}.{voice_id[:8]}.mp3"
    out_audio.write_bytes(result)
    print(f"voice changed: {out_audio}")
    if src.suffix.lower() in VIDEO_EXT:
        target = RAW / f"{src.stem}-{voice_id[:8]}.mp4"
        mux(src, out_audio, target)
        print(f"video with the new voice: {target}")


def isolate(src: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        audio = extract_audio(src, Path(tmp))
        result = post_audio("/v1/audio-isolation", audio, {})
    out_audio = WORK / f"{src.stem}.clean.mp3"
    out_audio.write_bytes(result)
    print(f"clean speech: {out_audio}")
    if src.suffix.lower() in VIDEO_EXT:
        target = RAW / f"{src.stem}-clean.mp4"
        mux(src, out_audio, target)
        print(f"video with clean sound: {target}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("voices")
    changer = sub.add_parser("change")
    changer.add_argument("clip")
    changer.add_argument("--voice", required=True)
    changer.add_argument("--keep-noise", action="store_true")
    isolator = sub.add_parser("isolate")
    isolator.add_argument("clip")
    args = parser.parse_args()
    WORK.mkdir(exist_ok=True)
    RAW.mkdir(exist_ok=True)
    if args.command == "voices":
        list_voices()
    elif args.command == "change":
        change(resolve(args.clip), args.voice, args.keep_noise)
    else:
        isolate(resolve(args.clip))


if __name__ == "__main__":
    main()
