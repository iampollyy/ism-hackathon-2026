"""Turn an edit list (EDL) into a finished video.

    tools/.venv/bin/python tools/edit.py work/my-reel.edl.json

EDL (JSON):
{
  "name": "reel1-the-call",          # output file name (default: the EDL's name)
  "format": "reel",                  # "reel" 1080x1920 or "wide" 1920x1080
  "captions": true,                  # burn word-by-word captions from work/<clip>.words.json
  "endcard": true,                   # brand end card for 2 s at the end
  "music": "music/track.mp3",        # optional, mixed under speech
  "music_volume": 0.12,
  "thumb_at": 1.0,                   # seconds into the output for out/<name>.jpg
  "clips": [
    {"src": "raw/take1.mov", "in": 1.2, "out": 6.8},
    {"src": "raw/app-news-phone.mp4", "in": 1, "out": 4.9, "zoom": 1.08,
     "audio_src": "raw/take1.mov", "audio_in": 6.8},
    {"src": "raw/title.png", "dur": 2}
  ],
  "sfx": [{"src": "sfx/whoosh.mp3", "at": 6.5, "volume": 0.8}]
}

Per clip: "in"/"out" in seconds of the source; "audio_src" + "audio_in" = play
another source's sound (and captions) under this picture, from that second,
for B-roll over narration; "zoom" = slow punch-in to that
factor over the clip (1.0 = none); "volume" (default 1); "captions": false to
leave that clip uncaptioned; images take "dur". Paths are relative to the video
folder. Each clip is scaled to cover the frame and centre-cropped (vertical
phone footage fills a reel; a wide screen recording is cropped to its middle,
so record app B-roll at the target shape)."""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import captions
from common import BRAND, FONTS, OUT, ROOT, SIZES, WORK, duration, has_audio, resolve, run, words_path

FPS = 30
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
# iPhones record HDR (HLG / Dolby Vision) by default; map it to normal SDR colour.
HDR_TRANSFERS = {"arib-std-b67", "smpte2084"}
TONEMAP = ("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,"
           "zscale=t=bt709:m=bt709:r=tv,format=yuv420p,")


def is_hdr(path: Path) -> bool:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer",
                          "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout.strip()
    return out in HDR_TRANSFERS


def segment(clip: dict, index: int, fmt: str, job: Path) -> tuple[Path, float]:
    width, height = SIZES[fmt]
    src = resolve(clip["src"])
    target = job / f"seg{index:02d}.mp4"
    is_image = src.suffix.lower() in IMAGE_EXT
    if is_image:
        start, length = 0.0, float(clip.get("dur", 2.0))
        inputs = ["-loop", "1", "-framerate", str(FPS), "-t", f"{length:.3f}", "-i", str(src)]
    else:
        start = float(clip.get("in", 0.0))
        end = float(clip.get("out", duration(src)))
        length = end - start
        inputs = ["-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(src)]
    zoom = float(clip.get("zoom", 1.0))
    video = (TONEMAP if not is_image and is_hdr(src) else "") + \
        f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1"
    if zoom != 1.0:
        grow = f"(1+{zoom - 1:.4f}*t/{length:.3f})"
        video += (f",scale=w='2*trunc({width}*{grow}/2)':h='2*trunc({height}*{grow}/2)':eval=frame,"
                  f"crop={width}:{height}")
    video += f",fps={FPS},format=yuv420p"
    volume = float(clip.get("volume", 1.0))
    if clip.get("audio_src"):
        # B-roll over narration: this clip's picture, another source's sound.
        audio_src = resolve(clip["audio_src"])
        audio_in = ["-ss", f"{float(clip.get('audio_in', 0.0)):.3f}", "-t", f"{length:.3f}", "-i", str(audio_src)]
        audio = f"[1:a]aresample=48000,aformat=channel_layouts=stereo,volume={volume}[a]"
        audio_map = "[a]"
    elif not is_image and has_audio(src) and volume > 0:
        audio_in: list[str] = []
        audio = f"[0:a]aresample=48000,aformat=channel_layouts=stereo,volume={volume}[a]"
        audio_map = "[a]"
    else:
        audio_in = ["-f", "lavfi", "-t", f"{length:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
        audio = None
        audio_map = "1:a"
    graph = f"[0:v]{video}[v]" + (f";{audio}" if audio else "")
    run(["ffmpeg", "-y", "-v", "error", *inputs, *audio_in, "-filter_complex", graph, "-map", "[v]", "-map", audio_map,
         "-t", f"{length:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-r", str(FPS),
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", str(target)])
    return target, duration(target)


def shifted_words(clip: dict, offset: float, length: float) -> list[dict]:
    """The words spoken in this clip's sound, moved to where the clip sits in the output."""
    if clip.get("audio_src"):
        src, start = resolve(clip["audio_src"]), float(clip.get("audio_in", 0.0))
    else:
        src, start = resolve(clip["src"]), float(clip.get("in", 0.0))
    path = words_path(src)
    if clip.get("captions") is False or src.suffix.lower() in IMAGE_EXT or not path.exists():
        return []
    end = start + length
    out = []
    for word in json.loads(path.read_text())["words"]:
        if word["start"] >= start - 0.05 and word["end"] <= end + 0.15:
            out.append({"text": word["text"], "start": word["start"] - start + offset,
                        "end": min(word["end"], end) - start + offset})
    return out


def render(edl_path: Path) -> Path:
    began = time.time()
    edl = json.loads(edl_path.read_text())
    fmt = edl.get("format", "reel")
    if fmt not in SIZES:
        raise SystemExit('format must be "reel" or "wide"')
    name = edl.get("name") or edl_path.name.removesuffix(".json").removesuffix(".edl")
    job = WORK / f"job-{name}"
    job.mkdir(parents=True, exist_ok=True)

    clips = list(edl["clips"])
    if edl.get("endcard", True):
        card = BRAND / "social" / ("reel-end-card-1080x1920.png" if fmt == "reel" else "video-thumbnail-1920x1080.png")
        clips.append({"src": str(card), "dur": float(edl.get("endcard_seconds", 2.0)), "captions": False})

    segments, words, offset = [], [], 0.0
    for index, clip in enumerate(clips):
        path, length = segment(clip, index, fmt, job)
        segments.append(path)
        words += shifted_words(clip, offset, length)
        offset += length
    total = offset

    listing = job / "segments.txt"
    listing.write_text("".join(f"file '{p.name}'\n" for p in segments))
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy",
         str(job / "joined.mp4")])

    # Final pass: captions, music, sound effects, loudness, delivery encode.
    inputs = ["-i", "joined.mp4"]
    audio_chain = ["[0:a]anull[speech]"]
    mix = ["[speech]"]
    next_input = 1
    if edl.get("music"):
        inputs += ["-stream_loop", "-1", "-i", str(resolve(edl["music"]))]
        volume = float(edl.get("music_volume", 0.12))
        audio_chain.append(f"[{next_input}:a]aresample=48000,aformat=channel_layouts=stereo,volume={volume},"
                           f"atrim=0:{total:.3f},afade=t=out:st={max(total - 1.5, 0):.3f}:d=1.5[music]")
        mix.append("[music]")
        next_input += 1
    for number, effect in enumerate(edl.get("sfx", [])):
        inputs += ["-i", str(resolve(effect["src"]))]
        delay = int(float(effect["at"]) * 1000)
        audio_chain.append(f"[{next_input}:a]aresample=48000,aformat=channel_layouts=stereo,"
                           f"volume={float(effect.get('volume', 0.8))},adelay={delay}|{delay}[fx{number}]")
        mix.append(f"[fx{number}]")
        next_input += 1
    if len(mix) > 1:
        audio_chain.append(f"{''.join(mix)}amix=inputs={len(mix)}:duration=first:normalize=0[mixed]")
        last = "[mixed]"
    else:
        last = "[speech]"
    audio_chain.append(f"{last}loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]")

    video = "[0:v]null[vout]"
    if edl.get("captions", True) and words:
        (job / "captions.ass").write_text(captions.build(words, fmt))
        fonts = os.path.relpath(FONTS, job)
        video = f"[0:v]subtitles=captions.ass:fontsdir={fonts}[vout]"
    OUT.mkdir(exist_ok=True)
    target = OUT / f"{name}.mp4"
    _final(inputs, video, audio_chain, total, target, job)
    thumb = OUT / f"{name}.jpg"
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{float(edl.get('thumb_at', 1.0)):.3f}", "-i", str(target),
         "-frames:v", "1", "-q:v", "2", str(thumb)])
    print(f"{target.relative_to(ROOT)}: {total:.1f} s, {len(words)} caption words, rendered in {time.time() - began:.0f} s")
    return target


def _final(inputs: list[str], video: str, audio_chain: list[str], total: float, target: Path, job: Path) -> None:
    """The delivery encode, run from the job folder so the subtitles filter gets plain relative paths."""
    cmd = ["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join([video, *audio_chain]),
           "-map", "[vout]", "-map", "[aout]", "-t", f"{total:.3f}",
           "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-profile:v", "high", "-pix_fmt", "yuv420p",
           "-r", str(FPS), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", str(target)]
    done = subprocess.run(cmd, cwd=job, capture_output=True, text=True)
    if done.returncode != 0:
        raise SystemExit(f"final encode failed:\n{done.stderr[-2000:]}")


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        render(resolve(arg))
