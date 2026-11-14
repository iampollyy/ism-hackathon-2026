"""The typed outputs of the model jobs (docs/ai.md, "Output shapes"). OWNER: track C.

Each model job asks the provider for one of these through structured outputs.
Code still checks every value before it is used (clamping, filtering).
No field has a default, so the schemas also work in OpenAI's strict mode.
"""

from typing import Literal

from pydantic import BaseModel

from app.schemas import Outcome, ReadinessKey, RiskSignal, ScenarioKey, Tactic

TrustsMost = Literal["family", "bank", "police", "hospital", "unknown"]


class ReadinessItem(BaseModel):
    key: ReadinessKey
    score: int  # 0, 1 or 2; clamped in code
    evidence: str  # a short quote


class Profile(BaseModel):  # Profiler
    consent_practice: bool
    consent_quote: str
    items: list[ReadinessItem]
    trusts_most: TrustsMost
    said: str  # one quote for the family page
    weak_spot: str  # one sentence


class PlanStep(BaseModel):
    when: str  # "today", "in three days"
    scenario: ScenarioKey
    difficulty: int
    voice_of: str | None  # a member's name, or None for a library voice
    why: str


class MemberPlan(BaseModel):
    member_id: str
    weak_spot: str
    this_week: str
    steps: list[PlanStep]


class FamilyPlan(BaseModel):  # Planner
    members: list[MemberPlan]
    family_tasks: list[str]


class Brief(BaseModel):  # Director
    caller_claim: str
    address_as: str
    opening_line: str
    scenario_brief: str
    ask: str
    tactic_order: list[Tactic]


class Score(BaseModel):  # Scorer
    outcome: Outcome
    tactics_used: list[Tactic]
    tactics_worked: list[Tactic]
    lesson: str
    debrief: str


class Pattern(BaseModel):
    title: str
    summary: str
    tactics: list[Tactic]
    closest_scenario: ScenarioKey
    source_url: str


class Digest(BaseModel):  # Digest
    patterns: list[Pattern]


class WeeklyNote(BaseModel):  # the weekly note, one per person
    text: str


class RiskCheck(BaseModel):  # the live risk check; code turns the signals into the level
    signals: list[RiskSignal]
    reason: str  # a few plain words for the laptop screen
