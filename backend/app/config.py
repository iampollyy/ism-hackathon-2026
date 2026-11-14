"""Settings read from the environment and from backend/.env.

Every field is optional with a safe default, so the app starts with an empty
.env. Read settings only through get_settings(); never print the secrets.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent

# The five model jobs (ai.md, "The model jobs"), plus the weekly note and the live risk
# check. Each setting is a comma-separated list: first choice, then the second choice at
# the other provider.
MODEL_JOBS = ("profiler", "planner", "digest", "director", "scorer", "weekly_note", "risk")

# The VAPID `sub` claim when VAPID_SUBJECT is empty. Set a real contact for a live demo.
DEFAULT_VAPID_SUBJECT = "mailto:callback@example.com"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Secrets use repr=False, so repr(), logs and tracebacks never show them.

    # ElevenLabs
    elevenlabs_api_key: str = Field(default="", repr=False)
    elevenlabs_welcome_agent_id: str = ""
    elevenlabs_practice_agent_id: str = ""
    elevenlabs_family_line_agent_id: str = ""
    elevenlabs_police_voice_id: str = ""
    elevenlabs_bank_voice_id: str = ""
    elevenlabs_nurse_voice_id: str = ""
    # True: every ElevenLabs call returns fakes, so the whole flow runs without voice.
    fake_elevenlabs: bool = False

    # Model providers
    openai_api_key: str = Field(default="", repr=False)
    anthropic_api_key: str = Field(default="", repr=False)
    firecrawl_api_key: str = Field(default="", repr=False)

    # Model per job: "first,second"
    profiler_models: str = "gpt-6-astra,claude-opus-5-5"
    planner_models: str = "gpt-6-astra,claude-opus-5-5"
    digest_models: str = "gpt-6-astra,claude-opus-5-5"
    director_models: str = "claude-haiku-5-5,gpt-6-luna"
    scorer_models: str = "claude-haiku-5-5,gpt-6-luna"
    weekly_note_models: str = "claude-haiku-5-5,gpt-6-luna"
    risk_models: str = "claude-haiku-5-5,gpt-6-luna"

    # The live risk check on practice calls (tests switch it off; their own tests switch it on)
    risk_check_enabled: bool = True

    # Storage
    database_url: str = "sqlite:///data/app.db"
    media_dir: str = "media"

    # Daily caps for a public deployment (services/limits.py); 0 means no cap.
    daily_family_limit: int = 0
    daily_clone_limit: int = 0
    daily_call_limit: int = 0

    # The built front end (frontend/dist) to serve at /, when the back end runs
    # alone on a server. Empty: the back end serves only /api (Vite serves the rest).
    frontend_dist: str = ""

    # Background loop (tests switch it off)
    scheduler_enabled: bool = True

    # Web Push (VAPID). Push is off while either key is empty; make a pair with
    # scripts/make_vapid_keys.py. The public key is the URL-safe base64 form the
    # browser's applicationServerKey takes; the private key is its raw 32 bytes.
    vapid_public_key: str = ""
    vapid_private_key: str = Field(default="", repr=False)
    vapid_subject: str = DEFAULT_VAPID_SUBJECT  # a contact the push services can reach

    # Track 1: organiser accounts, invites and joining (docs/full-app/track1.md)
    session_days: int = 30  # how long a log-in (the cb_session cookie) lasts
    login_max_failures: int = 5  # wrong log-ins for one email within the window, then 429
    login_window_minutes: int = 15
    # True: a joined member's first phone-state poll starts their welcome call
    auto_welcome_call: bool = True

    # Track 2: the member's voice from their own side of the welcome call
    # (services/voice_sample.py). Fewer seconds of their voice than this,
    # after cleaning, and no clone is made.
    voice_sample_min_seconds: float = 10.0

    @property
    def push_enabled(self) -> bool:
        return bool(self.vapid_public_key and self.vapid_private_key)

    def job_models(self, job: str) -> list[str]:
        """The models for one job, first choice first."""
        raw: str = getattr(self, f"{job}_models")
        return [name.strip() for name in raw.split(",") if name.strip()]

    @property
    def media_path(self) -> Path:
        """The media folder as an absolute path (relative paths are under backend/)."""
        path = Path(self.media_dir)
        return path if path.is_absolute() else BACKEND_DIR / path


@lru_cache
def get_settings() -> Settings:
    return Settings()
