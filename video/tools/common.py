"""Shared paths and the ElevenLabs client. The API key comes from the
environment, else video/.env, else backend/.env; it is read inside this
process and never printed."""

import os
import subprocess
from pathlib import Path

from dotenv import dotenv_values
import httpx

ROOT = Path(__file__).resolve().parent.parent          # <repo>/video
RAW, WORK, OUT, SFX, FONTS = (ROOT / d for d in ("raw", "work", "out", "sfx", "fonts"))
REPO = ROOT.parent
BRAND = REPO / "brand"
ENV_FILES = (ROOT / ".env", REPO / "backend" / ".env")
API = "https://api.elevenlabs.io"

# Brand colours (brand/tokens/tokens.json)
DEEP = "#1d1647"
NAVY = "#352a7c"
PINK = "#f2a9fa"
LAVENDER = "#d8ceff"

SIZES = {"reel": (1080, 1920), "wide": (1920, 1080)}


def api_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY")
    for env_file in ENV_FILES:
        if not key and env_file.exists():
            key = dotenv_values(env_file).get("ELEVENLABS_API_KEY")
    if not key:
        raise SystemExit("No ELEVENLABS_API_KEY: put ELEVENLABS_API_KEY=... in video/.env (never committed)")
    return key


def client(timeout: float = 300) -> httpx.Client:
    return httpx.Client(base_url=API, headers={"xi-api-key": api_key()}, timeout=timeout)


def run(cmd: list[str]) -> None:
    """Run ffmpeg/ffprobe quietly; show the tail of stderr on failure."""
    done = subprocess.run(cmd, capture_output=True, text=True)
    if done.returncode != 0:
        raise SystemExit(f"command failed: {' '.join(cmd[:6])} ...\n{done.stderr[-2000:]}")


def duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout.strip()
    return float(out)


def has_audio(path: Path) -> bool:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                          "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout.strip()
    return bool(out)


def words_path(src: Path) -> Path:
    return WORK / f"{src.stem}.words.json"


def resolve(src: str) -> Path:
    """An EDL or command-line path: absolute, or relative to the video folder."""
    path = Path(src)
    return path if path.is_absolute() else ROOT / path
