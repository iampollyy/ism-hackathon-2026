"""The scenario list for the picker. OWNER: track A."""

from typing import Any

from fastapi import APIRouter

from app import schemas
from app.services import scenarios as scenario_files

router = APIRouter(tags=["scenarios"])


def scenario_view(scenario: dict[str, Any]) -> schemas.ScenarioView:
    return schemas.ScenarioView(
        key=scenario["key"],
        title=scenario["title"],
        voice="clone" if scenario_files.uses_clone(scenario) else "library",
        caller_label=scenario.get("caller_label") or "Unknown number",
        allowed_tactics=[key for key in scenario.get("allowed_tactics", []) if key in schemas.TACTICS],
    )


@router.get("/scenarios", response_model=list[schemas.ScenarioView])
async def get_scenarios() -> list[schemas.ScenarioView]:
    """A bare JSON list, sorted by key."""
    return [
        scenario_view(scenario)
        for scenario in scenario_files.list_scenarios()
        if scenario.get("key") in schemas.SCENARIOS
    ]
