"""ffmpeg clean-up of a voice recording. OWNER: track A.

Phones record webm (Android, Chrome) or mp4/m4a (iPhone, Safari); ffmpeg
reads either by probing the file, whatever its name.
"""

import asyncio
import logging
from pathlib import Path

log = logging.getLogger("app.audio")

# Mono at 44.1 kHz, silence over a second trimmed (at the start, between
# sentences and at the end), then even loudness.
AUDIO_FILTER = (
    "silenceremove=start_periods=1:start_threshold=-45dB"
    ":stop_periods=-1:stop_duration=1:stop_threshold=-45dB,"
    "loudnorm"
)
FFMPEG_SECONDS = 60.0
# An mp3 smaller than this holds well under a second of sound.
MIN_OUTPUT_BYTES = 2000


class AudioError(Exception):
    """ffmpeg is missing, failed, or the recording has no usable sound."""


def ffmpeg_args(source: Path, target: Path) -> list[str]:
    return [
        "ffmpeg", "-nostdin", "-y", "-loglevel", "error",
        "-i", str(source),
        "-vn", "-ac", "1", "-ar", "44100",
        "-af", AUDIO_FILTER,
        "-codec:a", "libmp3lame", "-q:a", "2",
        str(target),
    ]


async def _run(args: list[str]) -> tuple[int, str]:
    """Run a command without blocking the event loop; return (exit code, stderr)."""
    try:
        process = await asyncio.create_subprocess_exec(
            *args, stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as error:
        raise AudioError("ffmpeg is not installed on this machine.") from error
    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=FFMPEG_SECONDS)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        process.kill()
        await process.wait()
        raise
    return process.returncode or 0, stderr.decode(errors="replace")


async def clean_recording(source: Path, target: Path) -> Path:
    """Write a cleaned copy of `source` to `target` (mp3): mono, 44.1 kHz,
    long silences trimmed, even loudness. Returns `target`.
    Raises AudioError if ffmpeg fails or nothing audible is left."""
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        code, stderr = await _run(ffmpeg_args(source, target))
    except asyncio.TimeoutError as error:
        raise AudioError(f"ffmpeg took longer than {FFMPEG_SECONDS:.0f} seconds.") from error
    if code != 0:
        log.warning("ffmpeg failed on %s: %s", source.name, stderr.strip()[-300:])
        raise AudioError("The recording could not be read. Please record it again.")
    if not target.exists() or target.stat().st_size < MIN_OUTPUT_BYTES:
        raise AudioError("The recording seems to be silent. Please record it again.")
    return target
