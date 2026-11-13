"""The weekly run, once, for one family. OWNER: track C.

POST /api/families/{id}/weekly-run: Firecrawl fetches two or three public
scam-warning pages, the digest job reduces them (one digest per week, shared),
the planner picks one action per member (message, practice or reminder),
messages go to `messages`, practices become `scheduled` calls.
"""

from fastapi import APIRouter

from app import schemas

router = APIRouter(tags=["weekly"])


@router.post("/families/{family_id}/weekly-run", response_model=schemas.WeeklyRunResult)
async def weekly_run(family_id: str) -> schemas.WeeklyRunResult:
    # STUB (track C): replace
    return schemas.WeeklyRunResult(
        digest=schemas.DigestView(
            week="2026-W46",
            patterns=[schemas.PatternView(
                title="Callers posing as a bank's security team",
                summary="A caller says a payment was blocked and asks you to read out a code.",
                tactics=["authority", "small_ask_first", "urgency"],
                closest_scenario="bank_security",
                source_url="https://example.org/warning",
            )],
        ),
        actions=[
            schemas.WeeklyAction(member_id="mem_Qz81hT0a", member_name="Sara", kind="message",
                                 text="This week: callers posing as a bank's security team. "
                                      "Never read out a code; hang up and ring the bank's number."),
            schemas.WeeklyAction(member_id="mem_7Lr2pWcd", member_name="Jon", kind="practice",
                                 text="A bank security practice, some time in the next two days.",
                                 call_id="call_9f3k"),
        ],
    )
