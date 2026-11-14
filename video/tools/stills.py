"""Pull still frames from a video so Claude can look at a cut.

    tools/.venv/bin/python tools/stills.py out/reel1.mp4            # 6 evenly spaced
    tools/.venv/bin/python tools/stills.py out/reel1.mp4 1.5 7 12.2 # at these seconds

Writes work/stills/<video>-<seconds>s.jpg (scaled to 540 px wide) and prints the paths."""

import sys

from common import WORK, duration, resolve, run


def stills(video_arg: str, times: list[float] | None = None, count: int = 6) -> list[str]:
    video = resolve(video_arg)
    length = duration(video)
    if not times:
        times = [round(length * (i + 0.5) / count, 2) for i in range(count)]
    folder = WORK / "stills"
    folder.mkdir(parents=True, exist_ok=True)
    paths = []
    for at in times:
        target = folder / f"{video.stem}-{at:.2f}s.jpg"
        run(["ffmpeg", "-y", "-v", "error", "-ss", f"{min(at, length - 0.05):.3f}", "-i", str(video),
             "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "3", str(target)])
        paths.append(str(target))
    return paths


if __name__ == "__main__":
    print("\n".join(stills(sys.argv[1], [float(t) for t in sys.argv[2:]] or None)))
