"""Practice consent, given and withdrawn (docs/backend.md "Practice consent").

members.consent_practice_at is what the consent gate reads
(calls.check_practice_gate). Each change to it writes one consents row, so the
record shows who agreed or withdrew, how, and on which call:

- kind `practice`: consent given. Source `manual` (the tick) or
  `welcome_call` (a yes from the consent_result tool; call_id is that call).
- kind `practice_withdrawn`: consent withdrawn. Source `manual` (the tick
  taken away) or `welcome_call` (an explicit no from the consent_result
  tool; call_id is that call).

Only these two functions change consent_practice_at after sign-up, except
the pipeline's spoken yes from the profiler (pipeline.record_spoken_consent).
Nothing here commits.
"""

from sqlalchemy.orm import Session as DbSession

from app.db import now_iso
from app.models import Consent, Member

GIVEN = "practice"
WITHDRAWN = "practice_withdrawn"


def give_practice(db: DbSession, member: Member, source: str, evidence: str,
                  call_id: str | None = None) -> bool:
    """Set consent_practice_at (if not set yet) and write a `practice` row.
    Nothing for someone who has opted out. Returns True if a row was written."""
    if member.opted_out_at is not None:
        return False
    now = now_iso()
    if member.consent_practice_at is None:
        member.consent_practice_at = now
    db.add(Consent(member_id=member.id, kind=GIVEN, source=source, evidence=evidence,
                   call_id=call_id, created_at=now))
    return True


def withdraw_practice(db: DbSession, member: Member, source: str, evidence: str,
                      call_id: str | None = None) -> bool:
    """Clear consent_practice_at and write a `practice_withdrawn` row. Nothing
    if there is no consent to withdraw. Returns True if it was withdrawn."""
    if member.consent_practice_at is None:
        return False
    member.consent_practice_at = None
    db.add(Consent(member_id=member.id, kind=WITHDRAWN, source=source, evidence=evidence,
                   call_id=call_id, created_at=now_iso()))
    return True
