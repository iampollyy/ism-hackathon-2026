"""Settings read from the environment and from backend/.env.

Every field is optional with a safe default, so the app starts with an empty
.env. Read settings only through get_settings(); never print the secrets.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent

# The five model jobs (ai.md, "The model jobs"), plus the weekly note. Each setting is a
# comma-separated list: first choice, then the second choice at the other provider.
MODEL_JOBS = ("profiler", "planner", "digest", "director", "scorer", "weekly_note")


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

    # Storage
    database_url: str = "sqlite:///data/app.db"
    media_dir: str = "media"

    # Background loop (tests switch it off)
    scheduler_enabled: bool = True

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
