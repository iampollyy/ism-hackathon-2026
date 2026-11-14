"""Practice consent after sign-up: an explicit no on the welcome call
withdraws it; a new tick or a later yes gives it again (docs/backend.md,
"Practice consent"). No network: no model keys, FAKE_ELEVENLABS on."""

from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import select

from app import events
from app.agents import profiler
from app.db import new_session, now_iso, to_iso, utcnow
from app.ids import new_call_id
from app.models import Call, Consent, Member
from app.schemas import READINESS_KEYS
from app.services import pipeline, scheduler


@pytest.fixture
def no_after_call(monkeypatch: pytest.MonkeyPatch) -> None:
    """/end only ends the call; the after-call work is not part of these tests."""
    async def nothing() -> None:
        return None

    monkeypatch.setattr(pipeline, "after_call", lambda call_id: nothing())


# ---------------------------------------------------------------- helpers


def ids(family: dict[str, Any]) -> tuple[str, str, str]:
    return family["family_id"], family["members"][0]["id"], family["members"][1]["id"]


def online(client: Any, member_id: str) -> None:
    client.get(f"/api/members/{member_id}/phone-state")


def welcome(client: Any, member_id: str, *answers: bool) -> str:
    """Ring, answer and end a welcome call, sending each consent answer in turn."""
    online(client, member_id)
    call_id = client.post(f"/api/members/{member_id}/welcome-call").json()["call_id"]
    assert client.post(f"/api/calls/{call_id}/answer").status_code == 200
    for given in answers:
        response = client.post(f"/api/calls/{call_id}/events",
                               json={"events": [{"type": "consent", "given": given}]})
        assert response.status_code == 200, response.text
    assert client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"}).status_code == 200
    return call_id


def tick(client: Any, member_id: str, given: bool) -> Any:
    return client.post(f"/api/members/{member_id}/consent", json={"consent_practice": given})


def practice(client: Any, member_id: str, **fields: Any) -> Any:
    online(client, member_id)
    return client.post("/api/practice-calls", json={"target_member_id": member_id, **fields})


def consent_at(member_id: str) -> str | None:
    with new_session() as db:
        return db.get(Member, member_id).consent_practice_at


def rows(member_id: str) -> list[tuple[str, str, str | None]]:
    with new_session() as db:
        found = db.scalars(select(Consent).where(Consent.member_id == member_id).order_by(Consent.id))
        return [(row.kind, row.source, row.call_id) for row in found]


def page_consent(client: Any, family_id: str, member_id: str) -> dict[str, bool]:
    family = client.get(f"/api/families/{family_id}").json()
    return next(member for member in family["members"] if member["id"] == member_id)["consent"]


def refused(response: Any) -> bool:
    return response.status_code == 409 and response.json()["error"]["code"] == "consent_missing"


# ---------------------------------------------------------------- a no on the welcome call


def test_a_no_on_the_welcome_call_withdraws_the_sign_up_tick(client, make_family, no_after_call):
    family_id, sara, _ = ids(make_family())
    assert page_consent(client, family_id, sara)["practice"] is True
    call_id = welcome(client, sara, False, False)  # a repeated no writes one row
    assert consent_at(sara) is None
    assert rows(sara) == [("practice", "manual", None), ("practice_withdrawn", "welcome_call", call_id)]
    with new_session() as db:
        row = db.scalars(select(Consent).where(Consent.kind == "practice_withdrawn")).one()
        assert "no" in row.evidence and "consent_result" in row.evidence
    assert refused(practice(client, sara)), "the consent gate refuses practice calls"
    assert page_consent(client, family_id, sara) == {"clone": False, "practice": False}


async def test_a_practice_scheduled_before_the_no_fails_when_due(client, make_family, no_after_call):
    _, sara, _ = ids(make_family())
    created = practice(client, sara, delay_seconds=60)
    assert created.status_code == 201 and created.json()["status"] == "scheduled"
    welcome(client, sara, False)
    with new_session() as db:
        await scheduler.tick(db, utcnow() + timedelta(seconds=120))
    with new_session() as db:
        assert db.get(Call, created.json()["call_id"]).status == "failed"


def test_a_no_without_any_consent_writes_nothing(client, make_family, no_after_call):
    _, sara, _ = ids(make_family(consent=False))
    welcome(client, sara, False)
    assert consent_at(sara) is None and rows(sara) == []


def test_the_latest_answer_in_one_call_wins(client, make_family, no_after_call):
    _, sara, jon = ids(make_family())
    call_id = welcome(client, sara, True, False, True)
    assert consent_at(sara) is not None
    assert rows(sara) == [("practice", "manual", None), ("practice", "welcome_call", call_id),
                          ("practice_withdrawn", "welcome_call", call_id), ("practice", "welcome_call", call_id)]
    other = welcome(client, jon, True, False)
    assert consent_at(jon) is None
    assert rows(jon)[-1] == ("practice_withdrawn", "welcome_call", other)


def test_a_consent_event_on_a_practice_call_changes_nothing(client, make_family, no_after_call):
    _, sara, _ = ids(make_family())
    call_id = practice(client, sara).json()["call_id"]
    assert client.post(f"/api/calls/{call_id}/answer").status_code == 200
    client.post(f"/api/calls/{call_id}/events", json={"events": [{"type": "consent", "given": False}]})
    assert consent_at(sara) is not None and rows(sara) == [("practice", "manual", None)]


# ---------------------------------------------------------------- opting in again


def test_a_later_welcome_yes_gives_consent_again(client, make_family, no_after_call):
    family_id, sara, _ = ids(make_family())
    welcome(client, sara, False)
    second = welcome(client, sara, True)
    assert consent_at(sara) is not None
    assert rows(sara)[-1] == ("practice", "welcome_call", second)
    assert page_consent(client, family_id, sara)["practice"] is True
    assert practice(client, sara).status_code == 201


def test_a_new_tick_gives_consent_again(client, make_family, no_after_call):
    family_id, sara, _ = ids(make_family())
    welcome(client, sara, False)
    assert tick(client, sara, True).json() == {"ok": True}
    assert tick(client, sara, True).status_code == 200  # the same tick twice writes one row
    assert consent_at(sara) is not None
    assert [row[:2] for row in rows(sara)] == [("practice", "manual"), ("practice_withdrawn", "welcome_call"),
                                               ("practice", "manual")]
    assert page_consent(client, family_id, sara)["practice"] is True
    assert practice(client, sara).status_code == 201


def test_the_tick_can_be_taken_away(client, make_family, no_after_call):
    family_id, sara, _ = ids(make_family())
    for _ in range(2):
        assert tick(client, sara, False).status_code == 200
    assert consent_at(sara) is None
    assert rows(sara) == [("practice", "manual", None), ("practice_withdrawn", "manual", None)]
    assert refused(practice(client, sara))
    assert page_consent(client, family_id, sara)["practice"] is False


def test_the_tick_for_someone_who_left_or_nobody(client, make_family):
    _, sara, _ = ids(make_family(consent=False))
    assert client.post(f"/api/members/{sara}/opt-out").status_code == 200
    assert refused(tick(client, sara, True))
    assert consent_at(sara) is None
    assert tick(client, "mem_nobody", True).status_code == 404
    assert client.post(f"/api/members/{sara}/consent", json={}).status_code == 422


# ---------------------------------------------------------------- a family with an owner: only the person says yes


def owned_family(client: Any, consent: bool = True) -> tuple[str, str, str]:
    """A family made while logged in as "Jon K", with the sign-up tick on
    both rows. Returns (family_id, sara, jon); the client stays logged in."""
    client.post("/api/auth/register", json={"name": "Jon K", "email": "jon@example.com", "password": "correct horse"})
    body = client.post("/api/families", json={"name": "The Kovacs", "members": [
        {"name": "Sara", "relationship": "mother", "consent_practice": consent},
        {"name": "Jon", "relationship": "son", "is_organiser": True, "consent_practice": consent}]})
    assert body.status_code == 201, body.text
    return ids(body.json())


def must_agree(response: Any) -> bool:
    return response.status_code == 403 and response.json()["error"] == {
        "code": "member_must_agree", "message": "Only Sara can say yes, from their own link."}


def test_the_sign_up_form_only_ticks_for_the_organiser(client):
    family_id, sara, jon = owned_family(client)
    assert consent_at(sara) is None and rows(sara) == [], "the organiser's tick on Sara's row is not her consent"
    assert consent_at(jon) is not None and rows(jon) == [("practice", "manual", None)]
    assert page_consent(client, family_id, sara)["practice"] is False
    assert page_consent(client, family_id, jon)["practice"] is True


def test_the_organiser_cannot_say_yes_for_someone_else(client, no_after_call):
    family_id, sara, _ = owned_family(client)
    assert must_agree(tick(client, sara, True)), "before Sara has even opened her invite"
    assert consent_at(sara) is None and rows(sara) == []

    first = welcome(client, sara, True)  # Sara's own yes
    assert tick(client, sara, False).status_code == 200  # the organiser switches it off
    assert must_agree(tick(client, sara, True)), "and cannot switch it back on"
    assert consent_at(sara) is None
    assert [row[:2] for row in rows(sara)] == [("practice", "welcome_call"), ("practice_withdrawn", "organiser")]
    assert rows(sara)[0][2] == first
    assert page_consent(client, family_id, sara)["practice"] is False

    second = welcome(client, sara, True)  # only Sara's own yes gives it again
    assert consent_at(sara) is not None and rows(sara)[-1] == ("practice", "welcome_call", second)


def test_the_organisers_switch_off_records_who(client, no_after_call):
    family_id, sara, _ = owned_family(client)
    welcome(client, sara, True)
    for _ in range(2):  # the same answer twice writes one row
        assert tick(client, sara, False).json() == {"ok": True}
    assert consent_at(sara) is None
    with new_session() as db:
        found = list(db.scalars(select(Consent).where(Consent.member_id == sara).order_by(Consent.id)))
        assert [(row.kind, row.source, row.evidence) for row in found][-1] == \
            ("practice_withdrawn", "organiser", "switched off by Jon K")
        assert [row.kind for row in found].count("practice_withdrawn") == 1
    assert refused(practice(client, sara))
    assert page_consent(client, family_id, sara)["practice"] is False


def test_the_organiser_switches_their_own_both_ways(client):
    family_id, _, jon = owned_family(client, consent=False)
    assert tick(client, jon, True).json() == {"ok": True}
    assert consent_at(jon) is not None and page_consent(client, family_id, jon)["practice"] is True
    assert tick(client, jon, False).status_code == 200
    assert consent_at(jon) is None
    assert [row[:2] for row in rows(jon)] == [("practice", "manual"), ("practice_withdrawn", "manual")]


# ---------------------------------------------------------------- the profiler never withdraws


def ended_welcome(family_id: str, member_id: str) -> str:
    call_id = new_call_id()
    answered = utcnow() - timedelta(seconds=65)
    with new_session() as db:
        db.add(Call(id=call_id, family_id=family_id, kind="welcome", target_member_id=member_id, difficulty=1,
                    status="ended", answered_at=to_iso(answered), ended_at=to_iso(answered + timedelta(seconds=60)),
                    ended_by="agent", created_at=now_iso()))
        db.commit()
    events.publish(call_id, "turn", {"speaker": "agent", "text": "Are you happy to get a practice call now and then?"})
    events.publish(call_id, "turn", {"speaker": "user", "text": "Hmm, I'm not sure."})
    return call_id


def model_profile(consent: bool) -> dict[str, Any]:
    return {"consent_practice": consent, "consent_quote": "", "trusts_most": "unknown", "said": "",
            "weak_spot": "Not known.", "source": profiler.PROMPT_VERSION,
            "items": [{"key": key, "score": 1, "evidence": "quote"} for key in READINESS_KEYS]}


async def test_the_profilers_reading_never_withdraws(client, make_family, monkeypatch):
    family_id, sara, _ = ids(make_family())

    async def unsure(transcript: str, consent_from_event: bool | None) -> dict[str, Any]:
        assert consent_from_event is None  # the agent sent no consent answer
        return model_profile(consent=False)

    monkeypatch.setattr(profiler, "build_profile", unsure)
    call_id = ended_welcome(family_id, sara)
    await pipeline.after_call(call_id)
    with new_session() as db:
        assert db.get(Call, call_id).status == "scored"
    assert consent_at(sara) is not None and rows(sara) == [("practice", "manual", None)]


async def test_a_no_sent_while_the_profiler_runs_is_not_undone(client, make_family, monkeypatch):
    family_id, sara, _ = ids(make_family())
    call_id = ended_welcome(family_id, sara)

    async def reads_yes(transcript: str, consent_from_event: bool | None) -> dict[str, Any]:
        # The phone's last batch arrives while the model is reading.
        response = client.post(f"/api/calls/{call_id}/events",
                               json={"events": [{"type": "consent", "given": False}]})
        assert response.status_code == 200
        return model_profile(consent=True)

    monkeypatch.setattr(profiler, "build_profile", reads_yes)
    await pipeline.after_call(call_id)
    assert consent_at(sara) is None
    assert rows(sara)[-1] == ("practice_withdrawn", "welcome_call", call_id)
