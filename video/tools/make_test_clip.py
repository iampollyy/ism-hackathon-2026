"""Make a test 'talking' clip: brand background + stock-voice narration (no cloned voice)."""
from common import RAW, WORK, client, duration, run

TEXT = ("Scammers can copy a voice from a few seconds of video. Callback runs practice calls, "
        "so your family learns one habit: hang up, and call back on the number you know.")

with client() as http:
    voices = http.get("/v1/voices").json()["voices"]
    stock = [v for v in voices if v.get("category") == "premade"]
    voice = stock[0]
    audio = http.post(f"/v1/text-to-speech/{voice['voice_id']}?output_format=mp3_44100_128",
                      json={"text": TEXT, "model_id": "eleven_multilingual_v2"})
    audio.raise_for_status()
mp3 = WORK / "test-narration.mp3"
mp3.write_bytes(audio.content)
length = duration(mp3) + 0.6
run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=0x352a7c:s=1080x1920:r=30:d={length:.2f}",
     "-i", str(mp3), "-filter_complex", "[0:v]drawbox=x=0:y=ih*0.55:w=iw:h=ih*0.45:color=0x1d1647@0.6:t=fill[v];[1:a]adelay=300|300[a]",
     "-map", "[v]", "-map", "[a]", "-t", f"{length:.2f}", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
     "-c:a", "aac", "-b:a", "192k", str(RAW / "test-talk.mp4")])
print(f"raw/test-talk.mp4: {length:.1f} s, stock voice '{voice['name']}', {len(TEXT)} characters")
