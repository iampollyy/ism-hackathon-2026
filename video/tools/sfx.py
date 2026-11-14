"""Four short sound effects from ElevenLabs sound generation, into sfx/.

    tools/.venv/bin/python tools/sfx.py           # makes the missing ones
    tools/.venv/bin/python tools/sfx.py --force   # makes all four again
"""

import sys

from common import SFX, client

SOUNDS = {
    "ringtone": ("A generic modern smartphone ringtone, a simple soft marimba-like two-note pattern repeating, clean, "
                 "no melody from any known brand", 4.0),
    "whoosh": ("A short clean cinematic whoosh transition, airy, modern", 1.0),
    "call-ended": ("A phone call ended tone: three short soft electronic beeps", 1.5),
    "alert": ("A soft warning alert sting for an app notification, two rising tones, calm but noticeable", 1.5),
}


def make(force: bool = False) -> None:
    SFX.mkdir(exist_ok=True)
    with client() as http:
        for name, (prompt, seconds) in SOUNDS.items():
            target = SFX / f"{name}.mp3"
            if target.exists() and not force:
                print(f"skip {target.name}")
                continue
            response = http.post("/v1/sound-generation", json={"text": prompt, "duration_seconds": seconds,
                                                                "prompt_influence": 0.5})
            if response.status_code != 200:
                raise SystemExit(f"{name}: failed ({response.status_code}): {response.text[:300]}")
            target.write_bytes(response.content)
            print(f"{target.name}: {len(response.content) // 1024} KB")


if __name__ == "__main__":
    make("--force" in sys.argv)
