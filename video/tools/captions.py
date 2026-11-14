"""Word-by-word captions as ASS subtitles, in the Callback brand style.

Space Grotesk Bold, white words on a deep indigo box, the word being spoken in
pink, 2-4 words on screen at a time. Used by edit.py; can also be run alone:

    tools/.venv/bin/python tools/captions.py work/clip.words.json reel work/clip.ass
"""

import json
import sys
from pathlib import Path

from common import DEEP, PINK, SIZES


def ass_colour(hex_rgb: str, alpha: int = 0) -> str:
    """#rrggbb -> &HAABBGGRR (ASS is little-endian, alpha 00 = opaque)."""
    r, g, b = hex_rgb[1:3], hex_rgb[3:5], hex_rgb[5:7]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def stamp(seconds: float) -> str:
    seconds = max(0.0, seconds)
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{int(hours)}:{int(minutes):02d}:{secs:05.2f}"


def chunks(words: list[dict], max_words: int = 3, max_chars: int = 18, max_gap: float = 0.6) -> list[list[dict]]:
    """Group words into short on-screen phrases; break at punctuation, long pauses, length."""
    groups, current = [], []
    for word in words:
        if current:
            gap = word["start"] - current[-1]["end"]
            text_len = sum(len(w["text"]) + 1 for w in current) + len(word["text"])
            if len(current) >= max_words or text_len > max_chars or gap > max_gap:
                groups.append(current)
                current = []
        current.append(word)
        if word["text"].endswith((".", "?", "!", ",")) and len(current) >= 2:
            groups.append(current)
            current = []
    if current:
        groups.append(current)
    return groups


def header(fmt: str, position: str = "middle") -> str:
    width, height = SIZES[fmt]
    alignment = 2  # bottom-centre, lifted by MarginV
    if fmt == "reel" and position == "top":
        # Above the head, for selfie framing where the face fills the middle;
        # starts at 19% height, clear of Instagram's top bar.
        size, margin_v, outline, alignment = 92, int(height * 0.19), 16, 8
    elif fmt == "reel":
        size, margin_v, outline = 92, int(height * 0.36), 16   # baseline near 64% height: clear of IG's UI
    else:
        size, margin_v, outline = 72, int(height * 0.10), 12   # lower third
    white, deep, pink = ass_colour("#ffffff"), ass_colour(DEEP), ass_colour(PINK)
    # BorderStyle 3 = opaque box behind the text, painted in OutlineColour.
    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Space Grotesk,{size},{white},{pink},{deep},{deep},-1,0,0,0,100,100,0,0,3,{outline},0,{alignment},60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def build(words: list[dict], fmt: str, position: str = "middle") -> str:
    """One dialogue line per word: the phrase stays up, the current word turns pink.
    A phrase never stays on screen into the next one (two would stack)."""
    pink = ass_colour(PINK)
    lines = [header(fmt, position)]
    groups = chunks(words)
    for group_index, group in enumerate(groups):
        next_start = groups[group_index + 1][0]["start"] if group_index + 1 < len(groups) else None
        for index, word in enumerate(group):
            start = word["start"]
            end = group[index + 1]["start"] if index + 1 < len(group) else max(word["end"], start + 0.25)
            if next_start is not None:
                end = min(end, next_start)
            parts = []
            for other_index, other in enumerate(group):
                text = other["text"].replace("{", "(").replace("}", ")")
                parts.append(f"{{\\c{pink}}}{text}{{\\r}}" if other_index == index else text)
            lines.append(f"Dialogue: 0,{stamp(start)},{stamp(end)},Caption,,0,0,0,,{' '.join(parts)}")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    source, fmt, target = sys.argv[1], sys.argv[2], sys.argv[3]
    words = json.loads(Path(source).read_text())["words"]
    Path(target).write_text(build(words, fmt))
    print(f"{len(words)} words -> {target}")
