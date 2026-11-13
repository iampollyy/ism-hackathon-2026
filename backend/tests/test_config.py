"""app/config.py: settings."""

from app.config import Settings


def test_secrets_stay_out_of_repr():
    settings = Settings(_env_file=None, openai_api_key="sk-test-not-real",
                        anthropic_api_key="ak-test-not-real", elevenlabs_api_key="el-test-not-real",
                        firecrawl_api_key="fc-test-not-real")
    text = repr(settings)
    assert "not-real" not in text
    assert settings.openai_api_key == "sk-test-not-real"


def test_job_models_splits_the_list():
    settings = Settings(_env_file=None, scorer_models=" a , b ,")
    assert settings.job_models("scorer") == ["a", "b"]
