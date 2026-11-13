"""The scenario list for the picker. OWNER: track A."""

from fastapi import APIRouter

from app import schemas

router = APIRouter(tags=["scenarios"])

SAMPLE_SCENARIOS = [
    schemas.ScenarioView(
        key="relative_new_number", title="Relative with a new number", voice="clone",
        caller_label="Unknown number",
        allowed_tactics=["new_number", "urgency", "secrecy", "emotional_appeal", "small_ask_first"],
    ),
    schemas.ScenarioView(
        key="police", title="Police officer", voice="library", caller_label="Unknown number",
        allowed_tactics=["authority", "secrecy", "urgency", "isolation", "unusual_payment"],
    ),
]


@router.get("/scenarios", response_model=list[schemas.ScenarioView])
async def get_scenarios() -> list[schemas.ScenarioView]:
    # STUB (track A): replace with services.scenarios.list_scenarios()
    return SAMPLE_SCENARIOS
