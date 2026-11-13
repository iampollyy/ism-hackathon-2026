"""ffmpeg clean-up of a voice recording. OWNER: track A."""

from pathlib import Path


async def clean_recording(source: Path, target: Path) -> Path:
    """Write a cleaned copy of `source` to `target` (mp3): mono, 44.1 kHz,
    leading silence trimmed, even loudness. Starting point:
    ffmpeg -i in -ac 1 -ar 44100 -af "silenceremove=start_periods=1:start_threshold=-45dB,loudnorm" out.mp3
    Run ffmpeg without blocking the event loop. Returns `target`.
    OWNER: track A."""
    raise NotImplementedError
