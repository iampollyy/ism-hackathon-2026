"""Track 4: drills, family activity and member progress (routers/review.py,
services/review.py), on calls, results and events seeded directly."""

import json
import re
from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import to_iso, utcnow
from app.ids import new_call_id
from app.models import Call, CallEvent, Consent, Member, MemberJoin, Message, ReadinessSnapshot, Result
from app.services import review

BASE = utcnow() - timedelta(hours=3)


def at(minutes: float) -> str:
    return to_iso(BASE + timedelta(minutes=minutes))


@pytest.fixture
def fam(make_family: Any, db: Session) -> dict[str, str]:
    """Sara (mother), Jon (son, organiser) and Ana (daughter), all with the
    sign-up tick, signed up at minute 0 (before everything a test seeds)."""
    body = make_family(3)
    ids = [member["id"] for member in body["members"]]
    for member in db.scalars(select(Member).where(Member.id.in_(ids))):
        member.created_at = at(0)
    for consent in db.scalars(select(Consent).where(Consent.member_id.in_(ids))):
        consent.created_at = at(0)
    db.commit()
    return {"id": body["family_id"], "sara": ids[0], "jon": ids[1], "ana": ids[2]}


def add_call(db: Session, fam: dict[str, str], minute: float, kind: str = "practice", status: str = "scored",
             target: str = "sara", voice: str | None = None, scenario: str | None = "relative_new_number",
             length: float = 2, **fields: Any) -> str:
    call_id = new_call_id()
    answered = fields.pop("answered_at", at(minute))
    ended = fields.pop("ended_at", at(minute + length))
    db.add(Call(id=call_id, family_id=fam["id"], kind=kind, target_member_id=fam[target],
                voice_member_id=fam[voice] if voice else None,
                scenario=scenario if kind == "practice" else None, difficulty=fields.pop("difficulty", 1),
                status=status, answered_at=answered, ended_at=ended, created_at=at(minute), **fields))
    db.commit()
    return call_id


def add_result(db: Session, call_id: str, outcome: str, minute: float, seconds: float | None = None,
               tactics: tuple[str, ...] = (), lesson: str = "Hang up and call the family number.",
               callback: float | None = None) -> None:
    db.add(Result(call_id=call_id, outcome=outcome, seconds_to_challenge=seconds,
                  tactics_used_json=json.dumps(list(tactics)), tactics_worked_json="[]", lesson=lesson,
                  debrief="A. B. C.", callback_seconds=callback, scorer_version="fallback", created_at=at(minute)))
    db.commit()


def add_events(db: Session, call_id: str, *items: tuple[str, dict[str, Any]]) -> None:
    for seq, (kind, data) in enumerate(items, start=1):
        db.add(CallEvent(call_id=call_id, seq=seq, type=kind, t=float(seq), data_json=json.dumps(data),
                         created_at=at(0)))
    db.commit()


def add_message(db: Session, member_id: str, kind: str, text: str, minute: float) -> None:
    db.add(Message(member_id=member_id, kind=kind, text=text, created_at=at(minute)))
    db.commit()


# ---------------------------------------------------------------- drills


def test_drills_unknown_family_and_member(client: Any, fam: dict[str, str], make_family: Any) -> None:
    assert client.get("/api/families/fam_nope/drills").json()["error"]["code"] == "not_found"
    other = make_family(1)["members"][0]["id"]
    response = client.get(f"/api/families/{fam['id']}/drills", params={"member_id": other})
    assert response.status_code == 404 and response.json()["error"]["code"] == "not_found"
    assert client.get(f"/api/families/{fam['id']}/drills", params={"member_id": "mem_nope"}).status_code == 404
    bad = client.get(f"/api/families/{fam['id']}/drills", params={"limit": 0})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_request"


def test_drills_empty(client: Any, fam: dict[str, str]) -> None:
    assert client.get(f"/api/families/{fam['id']}/drills").json() == {"drills": []}


def test_drills_scored_practice_with_result(client: Any, db: Session, fam: dict[str, str]) -> None:
    call_id = add_call(db, fam, 10, voice="jon", difficulty=2, callback_seconds=40.0)
    add_events(db, call_id,
               ("turn", {"speaker": "agent", "text": "Mum? It's me."}),
               ("tactic", {"key": "new_number", "label": "New number"}),
               ("risk", {"level": "yellow", "signals": ["new_number"], "labels": ["New number"],
                         "reason": "New number", "turn_index": 0, "source": "fallback"}),
               ("risk", {"level": "red", "signals": ["new_number", "money_request"],
                         "labels": ["New number", "Asks for money"], "reason": "Asks for money",
                         "turn_index": 2, "source": "fallback"}),
               ("outcome", {"outcome": "asked_safe_word", "seconds_to_challenge": 23.4}))
    add_result(db, call_id, "asked_safe_word", 12, seconds=23.4, tactics=("new_number", "urgency", "bogus"),
               lesson="You asked for the family word.", callback=40.0)
    add_call(db, fam, 5, kind="welcome")  # not a drill
    add_call(db, fam, 6, kind="family_line")  # not a drill

    drills = client.get(f"/api/families/{fam['id']}/drills").json()["drills"]
    assert len(drills) == 1
    drill = drills[0]
    assert drill["call_id"] == call_id
    assert drill["member"] == {"id": fam["sara"], "name": "Sara"}
    assert drill["voice_of"] == {"id": fam["jon"], "name": "Jon"}
    assert drill["scenario"] == "relative_new_number"
    assert drill["scenario_title"] == "Relative with a new number"
    assert drill["difficulty"] == 2 and drill["status"] == "scored"
    assert drill["created_at"] == at(10) and drill["answered_at"] == at(10) and drill["ended_at"] == at(12)
    assert drill["scheduled_for"] is None
    assert drill["outcome"] == "asked_safe_word" and drill["outcome_label"] == "Asked for the family word"
    assert drill["safe"] is True
    assert drill["seconds_to_challenge"] == 23.4
    assert drill["peak_risk_level"] == "red"
    assert drill["tactics"] == [{"key": "new_number", "label": "New number"}, {"key": "urgency", "label": "Urgency"}]
    assert drill["lesson"] == "You asked for the family word."
    assert drill["callback_seconds"] == 40.0


@pytest.mark.parametrize("outcome, safe", [
    ("asked_safe_word", True), ("hung_up", True), ("asked_personal_question", True),
    ("hesitated", False), ("agreed", False),
])
def test_drill_safe_by_outcome(client: Any, db: Session, fam: dict[str, str], outcome: str, safe: bool) -> None:
    call_id = add_call(db, fam, 10)
    add_result(db, call_id, outcome, 12)
    drill = client.get(f"/api/families/{fam['id']}/drills").json()["drills"][0]
    assert drill["safe"] is safe and drill["outcome"] == outcome


def test_drill_before_scoring(client: Any, db: Session, fam: dict[str, str]) -> None:
    scheduled = add_call(db, fam, 30, status="scheduled", answered_at=None, ended_at=None,
                         scheduled_for=at(200), scenario="police")
    ended = add_call(db, fam, 20, status="ended", callback_seconds=12.0)
    add_events(db, ended, ("tactic", {"key": "urgency"}), ("tactic", {"key": "secrecy"}),
               ("tactic", {"key": "urgency"}))
    drills = client.get(f"/api/families/{fam['id']}/drills").json()["drills"]
    assert [drill["call_id"] for drill in drills] == [scheduled, ended]  # newest first
    upcoming, waiting = drills
    assert upcoming["status"] == "scheduled" and upcoming["scheduled_for"] == at(200)
    assert upcoming["scenario_title"] == "Police officer"
    assert upcoming["outcome"] is None and upcoming["safe"] is False and upcoming["tactics"] == []
    assert upcoming["peak_risk_level"] is None and upcoming["lesson"] is None
    assert waiting["tactics"] == [{"key": "urgency", "label": "Urgency"}, {"key": "secrecy", "label": "Secrecy"}]
    assert waiting["outcome"] is None and waiting["callback_seconds"] == 12.0


def test_drills_filter_by_member_and_limit(client: Any, db: Session, fam: dict[str, str]) -> None:
    sara_old = add_call(db, fam, 10)
    sara_new = add_call(db, fam, 50)
    jon = add_call(db, fam, 30, target="jon")
    url = f"/api/families/{fam['id']}/drills"
    assert [d["call_id"] for d in client.get(url).json()["drills"]] == [sara_new, jon, sara_old]
    only_sara = client.get(url, params={"member_id": fam["sara"]}).json()["drills"]
    assert [d["call_id"] for d in only_sara] == [sara_new, sara_old]
    assert [d["call_id"] for d in client.get(url, params={"limit": 1}).json()["drills"]] == [sara_new]


def test_the_organisers_own_drill_stays_a_surprise(client: Any, db: Session, fam: dict[str, str]) -> None:
    """Jon (the organiser) reads these screens: his scheduled drill is not
    listed and has no next time, until it rings."""
    for_sara = add_call(db, fam, 10, status="scheduled", answered_at=None, ended_at=None, scheduled_for=at(200))
    for_jon = add_call(db, fam, 11, status="scheduled", answered_at=None, ended_at=None, scheduled_for=at(100),
                       target="jon", scenario="hospital")
    done = add_call(db, fam, 5, target="jon")
    url = f"/api/families/{fam['id']}/drills"
    assert [d["call_id"] for d in client.get(url).json()["drills"]] == [for_sara, done]
    assert [d["call_id"] for d in client.get(url, params={"member_id": fam["jon"]}).json()["drills"]] == [done]
    assert client.get(url, params={"limit": 1}).json()["drills"][0]["call_id"] == for_sara, "the limit counts shown ones"
    assert client.get(f"/api/members/{fam['jon']}/progress").json()["next_drill_at"] is None
    assert client.get(f"/api/members/{fam['sara']}/progress").json()["next_drill_at"] == at(200)

    db.get(Call, for_jon).status = "ringing"
    db.commit()
    assert [d["call_id"] for d in client.get(url).json()["drills"]] == [for_jon, for_sara, done]


def test_drills_are_per_family(client: Any, db: Session, fam: dict[str, str], make_family: Any) -> None:
    add_call(db, fam, 10)
    other = make_family(1)["family_id"]
    assert client.get(f"/api/families/{other}/drills").json()["drills"] == []


# ---------------------------------------------------------------- activity


def texts(items: list[dict[str, Any]], kind: str) -> list[str]:
    return [item["text"] for item in items if item["kind"] == kind]


def test_activity_unknown_family(client: Any) -> None:
    response = client.get("/api/families/fam_nope/activity")
    assert response.status_code == 404 and response.json()["error"]["code"] == "not_found"


def test_activity_after_sign_up(client: Any, fam: dict[str, str]) -> None:
    items = client.get(f"/api/families/{fam['id']}/activity").json()["items"]
    # Nobody but the organiser has joined yet: the organiser added them.
    assert sorted(texts(items, "joined")) == ["Jon added Ana to the family plan", "Jon added Sara to the family plan",
                                             "Jon started the family plan"]
    # The organiser ticked for everyone on the sign-up form (a family without
    # an owner keeps those ticks); only Jon's own tick is his agreement.
    assert sorted(texts(items, "consent_given")) == ["Jon agreed to practice calls at sign-up",
                                                     "Jon ticked practice calls for Ana at sign-up",
                                                     "Jon ticked practice calls for Sara at sign-up"]
    # At the same moment, the tick is shown above the adding.
    sara = [item["kind"] for item in items if item["member"]["id"] == fam["sara"]]
    assert sara == ["consent_given", "joined"]


def owned_family(client: Any, db: Session) -> dict[str, str]:
    """A family made while logged in as "Ana Kovacs": Mum (mother) and Ana
    (the organiser, with her own sign-up tick), added at minute 0."""
    client.post("/api/auth/register", json={"name": "Ana Kovacs", "email": "ana@example.com",
                                            "password": "correct horse"})
    body = client.post("/api/families", json={"name": "The Kovacs", "members": [
        {"name": "Mum", "relationship": "mother", "consent_practice": True},
        {"name": "Ana", "relationship": "daughter", "is_organiser": True, "consent_practice": True}]}).json()
    mum, ana = (member["id"] for member in body["members"])
    for member in db.scalars(select(Member).where(Member.id.in_((mum, ana)))):
        member.created_at = at(0)
    for consent in db.scalars(select(Consent).where(Consent.member_id.in_((mum, ana)))):
        consent.created_at = at(0)
    db.commit()
    return {"id": body["family_id"], "mum": mum, "ana": ana}


def test_activity_names_who_acted(client: Any, db: Session) -> None:
    fam = owned_family(client, db)
    added = texts(client.get(f"/api/families/{fam['id']}/activity").json()["items"], "joined")
    assert sorted(added) == ["Ana Kovacs added Mum to the family plan", "Ana started the family plan"]

    # Mum opens her invite at minute 5 and agrees there; she is "joined" then, not at minute 0.
    response = client.post(f"/api/join/{fam['mum']}", json={"consent_practice": True,
                                                           "consent_clone_from_call": False})
    assert response.status_code == 200, response.text
    db.expire_all()
    db.get(MemberJoin, fam["mum"]).joined_at = at(5)
    for row in db.scalars(select(Consent).where(Consent.member_id == fam["mum"])):
        row.created_at = at(5)
    db.commit()
    # Ana switches Mum's practice calls off, then records Mum's voice on her laptop.
    assert client.post(f"/api/members/{fam['mum']}/consent", json={"consent_practice": False}).status_code == 200
    db.add(Consent(member_id=fam["mum"], kind="clone", source="voice_recording", evidence="x", created_at=at(20)))
    db.add(Consent(member_id=fam["ana"], kind="clone", source="voice_recording", evidence="x", created_at=at(21)))
    db.commit()

    items = client.get(f"/api/families/{fam['id']}/activity").json()["items"]
    mum = [(item["when"], item["text"]) for item in items if item["member"]["id"] == fam["mum"]]
    assert mum[-2:] == [(at(5), "Mum joined the family plan"), (at(0), "Ana Kovacs added Mum to the family plan")]
    assert texts(items, "consent_given") == ["Mum agreed to practice calls when joining",
                                             "Ana agreed to practice calls at sign-up"]
    assert texts(items, "consent_withdrawn") == ["Ana Kovacs switched off Mum's practice calls"]
    assert texts(items, "voice_consent") == [
        "Ana recorded a voice sample for family drills",
        "Mum's voice sample was recorded on Ana Kovacs's laptop, starting with their spoken consent",
    ]
    assert not [text for _, text in mum if text.startswith(("Mum paused", "Mum recorded", "Mum agreed to practice calls at"))]


def test_activity_timeline(client: Any, db: Session, fam: dict[str, str]) -> None:
    # Voice: a recording, then the clone.
    db.add(Consent(member_id=fam["jon"], kind="clone", source="voice_recording", evidence="x", created_at=at(1)))
    jon = db.get(Member, fam["jon"])
    jon.consent_clone_at, jon.voice_status, jon.voice_id = at(2), "ready", "voice_1"
    db.commit()
    welcome = add_call(db, fam, 3, kind="welcome", length=4)
    practice = add_call(db, fam, 10, voice="jon", callback_seconds=40.0)
    add_result(db, practice, "asked_safe_word", 13, seconds=23.4, callback=40.0)
    add_call(db, fam, 13, kind="family_line", status="scored", parent_call_id=practice)  # the tap that counted
    add_call(db, fam, 14, kind="family_line", status="scored", parent_call_id=practice)  # a second tap
    add_message(db, fam["jon"], "callback_notice", "Sara called the family number after a practice.", 13)
    add_message(db, fam["sara"], "weekly", "Callers pose as a bank this week.", 20)
    add_message(db, fam["ana"], "reminder", "Agree a family word in person.", 21)
    for member in ("jon", "ana"):
        add_message(db, fam[member], "alert", "Sara may be on a scam call. Ring her on her usual number.", 30)
    add_message(db, fam["ana"], "alert", "Ana may be on a scam call.", 31)
    db.add(Consent(member_id=fam["ana"], kind="practice_withdrawn", source="manual", evidence="x", created_at=at(40)))
    db.add(Consent(member_id=fam["ana"], kind="opt_out", source="manual", evidence="x", created_at=at(41)))
    db.commit()

    items = client.get(f"/api/families/{fam['id']}/activity").json()["items"]
    assert texts(items, "voice_consent") == ["Jon recorded a voice sample for family drills"]
    assert texts(items, "voice_ready") == ["Jon's voice was set up for family drills"]
    welcome_item = next(item for item in items if item["kind"] == "welcome_done")
    assert welcome_item == {"when": at(7), "member": {"id": fam["sara"], "name": "Sara"}, "kind": "welcome_done",
                            "text": "Sara took the welcome call", "call_id": welcome}
    drill = next(item for item in items if item["kind"] == "drill")
    assert drill["text"] == "Sara asked for the family word after 23 seconds, on a practice call in Jon's voice"
    assert drill["call_id"] == practice and drill["when"] == at(12)
    lines = [item for item in items if item["kind"] == "family_line"]
    assert [item["text"] for item in lines] == ["Sara called the family number",
                                                "Sara called the family number 40 seconds after a practice call"]
    assert all(item["call_id"] == practice for item in lines)
    assert not [item for item in items if "after a practice." in item["text"]]  # the notice is not shown twice
    assert texts(items, "weekly_note") == ["This week's note for Sara: Callers pose as a bank this week."]
    assert texts(items, "reminder") == ["Reminder for Ana: Agree a family word in person."]
    alerts = [item for item in items if item["kind"] == "alert"]
    assert [(item["text"], item["member"]) for item in alerts] == [
        ("Ana may be on a scam call.", {"id": fam["ana"], "name": "Ana"}),
        ("Sara may be on a scam call. Ring her on her usual number.", None),
    ]
    assert texts(items, "consent_withdrawn") == ["Ana paused practice calls"]
    assert texts(items, "opted_out") == ["Ana left Callback"]
    # Newest first, and the limit keeps the newest.
    times = [item["when"] for item in items]
    assert times == sorted(times, reverse=True)
    assert items[0]["kind"] == "opted_out"
    limited = client.get(f"/api/families/{fam['id']}/activity", params={"limit": 2}).json()["items"]
    assert [item["kind"] for item in limited] == ["opted_out", "consent_withdrawn"]


def test_activity_keeps_drill_timing_a_surprise(client: Any, db: Session, fam: dict[str, str]) -> None:
    add_call(db, fam, 10, status="scheduled", answered_at=None, ended_at=None, scheduled_for=at(300))
    add_call(db, fam, 11, status="ringing", answered_at=None, ended_at=None, ring_at=at(11))
    add_call(db, fam, 12, status="in_progress", ended_at=None, target="jon")
    add_call(db, fam, 13, status="failed", answered_at=None, target="ana")
    add_call(db, fam, 14, status="scored", target="ana")  # scored without a result: the line never connected
    items = client.get(f"/api/families/{fam['id']}/activity").json()["items"]
    assert not [item for item in items if item["kind"].startswith("drill")]


def test_activity_unanswered_and_pending_drills(client: Any, db: Session, fam: dict[str, str]) -> None:
    declined = add_call(db, fam, 10, status="declined", answered_at=None)
    add_call(db, fam, 20, status="missed", answered_at=None, target="jon")
    add_call(db, fam, 30, status="ended", target="ana", voice="jon")
    items = client.get(f"/api/families/{fam['id']}/activity").json()["items"]
    assert texts(items, "drill_unanswered") == ["A practice call for Jon went unanswered",
                                                "Sara declined a practice call"]
    assert next(item for item in items if item["kind"] == "drill_unanswered" and "Sara" in item["text"])["call_id"] \
        == declined
    assert texts(items, "drill") == ["Ana took a practice call in Jon's voice; the review is on its way"]


SHAMING = re.compile(r"fail|fool|fell for|wrong|mistake|caught out|scammed|gave in", re.IGNORECASE)


def test_activity_never_shames(client: Any, db: Session, fam: dict[str, str]) -> None:
    for minute, (outcome, scenario) in enumerate([("agreed", "bank_security"), ("hesitated", "police"),
                                                  ("hung_up", "hospital"), ("asked_personal_question", None)]):
        call_id = add_call(db, fam, minute * 10, scenario=scenario)
        add_result(db, call_id, outcome, minute * 10 + 2, seconds=None if outcome in ("agreed", "hesitated") else 150)
    items = client.get(f"/api/families/{fam['id']}/activity").json()["items"]
    drills = texts(items, "drill")
    assert drills == [
        "Sara asked a question only family would know after 3 minutes, on a practice call",
        "Sara hung up to check after 3 minutes, on a practice call (clinic with an unpaid fee)",
        "Sara took a practice call (police officer) and picked up a tip for next time",
        "Sara took a practice call (bank security team) and picked up a tip for next time",
    ]
    assert not [item for item in items if SHAMING.search(item["text"])]


def test_activity_consent_wording_for_other_tracks(client: Any, db: Session, fam: dict[str, str]) -> None:
    rows = [("practice", "welcome_call"), ("practice", "invite"), ("practice", "manual"),
            ("practice_withdrawn", "welcome_call"), ("clone", "welcome_call"), ("clone_from_call", "invite"),
            ("something_new", "manual")]
    for minute, (kind, source) in enumerate(rows, start=50):
        db.add(Consent(member_id=fam["ana"], kind=kind, source=source, evidence="e", created_at=at(minute)))
    db.commit()
    items = client.get(f"/api/families/{fam['id']}/activity").json()["items"]
    ana = [item["text"] for item in items if item["member"] and item["member"]["id"] == fam["ana"]][:6]
    assert ana == [
        "Ana agreed that their welcome call may be used to copy their voice for family drills",
        "Ana agreed on the welcome call to lend their voice for family drills",
        "Ana chose not to get practice calls for now",
        "Ana agreed to practice calls",
        "Ana agreed to practice calls when joining",
        "Ana said yes to practice calls on the welcome call",
    ]


@pytest.mark.parametrize("seconds, words", [(0, "0 seconds"), (1, "1 second"), (23.4, "23 seconds"),
                                            (119, "119 seconds"), (150, "3 minutes")])
def test_say_seconds(seconds: float, words: str) -> None:
    assert review.say_seconds(seconds) == words


# ---------------------------------------------------------------- progress


def add_snapshot(db: Session, member_id: str, scores: dict[str, int], minute: float) -> None:
    items = [{"key": key, "score": score} for key, score in scores.items()]
    db.add(ReadinessSnapshot(member_id=member_id, items_json=json.dumps(items), total=sum(scores.values()),
                             max=10, created_at=at(minute)))
    db.commit()


def test_progress_unknown_member(client: Any) -> None:
    response = client.get("/api/members/mem_nope/progress")
    assert response.status_code == 404 and response.json()["error"]["code"] == "not_found"


def test_progress_new_member(client: Any, fam: dict[str, str]) -> None:
    body = client.get(f"/api/members/{fam['jon']}/progress").json()
    assert body["member"] == {"id": fam["jon"], "name": "Jon"}
    assert body["readiness"]["before"] == 0 and body["readiness"]["now"] == 0 and body["readiness"]["max"] == 10
    assert len(body["readiness"]["items"]) == 5
    assert body["drills"] == {"total": 0, "safe": 0, "last_outcome": None, "last_outcome_label": None,
                              "safe_streak": 0}
    assert body["lessons"] == [] and body["weak_spot"] is None and body["next_drill_at"] is None


def test_progress_with_drills(client: Any, db: Session, fam: dict[str, str]) -> None:
    add_snapshot(db, fam["sara"], {"verify_first": 0, "safe_word": 1, "trusted_contact": 1,
                                   "payment_caution": 1, "under_pressure": 0}, 1)
    add_snapshot(db, fam["sara"], {"verify_first": 2, "safe_word": 2, "trusted_contact": 2,
                                   "payment_caution": 1, "under_pressure": 2}, 60)
    sara = db.get(Member, fam["sara"])
    sara.profile_json = json.dumps({"weak_spot": "From the profile."})
    sara.plan_json = json.dumps({"weak_spot": "Calls that sound official.", "this_week": "Save the number.",
                                 "steps": []})
    db.commit()
    history = [("hung_up", "Hung up, well done."), ("agreed", "Next time, hang up first."),
               ("asked_safe_word", "The family word works."), ("asked_personal_question", "Good question.")]
    ids = []
    for index, (outcome, lesson) in enumerate(history):
        call_id = add_call(db, fam, 10 + index * 10)
        add_result(db, call_id, outcome, 12 + index * 10, lesson=lesson)
        ids.append(call_id)
    add_call(db, fam, 5, target="jon")  # someone else's drill
    add_call(db, fam, 90, status="scheduled", answered_at=None, ended_at=None, scheduled_for=at(500))
    add_call(db, fam, 91, status="scheduled", answered_at=None, ended_at=None, scheduled_for=at(400))

    body = client.get(f"/api/members/{fam['sara']}/progress").json()
    assert body["readiness"]["before"] == 3 and body["readiness"]["now"] == 9
    assert body["drills"] == {"total": 4, "safe": 3, "last_outcome": "asked_personal_question",
                              "last_outcome_label": "Asked a personal question", "safe_streak": 2}
    assert [lesson["call_id"] for lesson in body["lessons"]] == list(reversed(ids))
    assert body["lessons"][0] == {"call_id": ids[3], "when": at(42), "outcome": "asked_personal_question",
                                  "outcome_label": "Asked a personal question", "lesson": "Good question."}
    assert body["weak_spot"] == "Calls that sound official."  # the plan's, as on the family page
    assert body["next_drill_at"] == at(400)
    family_page = client.get(f"/api/families/{fam['id']}").json()
    assert next(m for m in family_page["members"] if m["id"] == fam["sara"])["readiness"] == body["readiness"]


def test_progress_streak_resets_after_a_tip(client: Any, db: Session, fam: dict[str, str]) -> None:
    for index, outcome in enumerate(["hung_up", "hung_up", "hesitated"]):
        add_result(db, add_call(db, fam, index * 10), outcome, index * 10 + 2)
    drills = client.get(f"/api/members/{fam['sara']}/progress").json()["drills"]
    assert drills["safe_streak"] == 0 and drills["safe"] == 2 and drills["last_outcome"] == "hesitated"
