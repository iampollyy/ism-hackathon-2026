"""What happens after a call ends (backend.md flow 5). OWNER: track C.

after_call(call_id) runs in the background once the phone reports the end.

| Step | Welcome call                          | Practice call                                   |
|------|---------------------------------------|-------------------------------------------------|
| 1    | Transcript from our stored turns      | Same                                            |
| 2    | Profiler (fallback: all 0)            | Outcome by rule, then the scorer for the words  |
| 3    | Snapshot "before"; spoken consent     | Results row, readiness by rule, snapshot "now"  |
| 4    | Status scored                         | Status scored, publish `result`                 |
| 5    | Planner for the family                | Planner for this member                         |
| 6    | Keep ElevenLabs' transcript as the record, in a background task (both; skipped in fake mode) |

A family-line call is only set to scored.

Before step 1, after_call waits until EVENT_GRACE_SECONDS have passed since
the end, so a last event batch sent just after /end is still read.

The status is set to scored before the planner runs (the planner is a slow,
careful job and nobody waits on it), so the debrief appears as soon as the
scorer is done. (backend.md lists the planner first; this order is a
deliberate deviation.)

A welcome call where nothing was said changes no profile or readiness. A
later welcome call replaces "before" while no practice has moved the scores.
A practice with no rule outcome and no model answer gets a result row, but
its readiness is carried forward (only the family-number item can move).

Database rule: no session is open across an await. Each step reads or
writes in its own short session and commits before the next model call
(db.py, "Hard rule").
"""

import asyncio
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app import events
from app.agents import planner, profiler, scorer
from app.config import get_settings
from app.db import new_session, now_iso, parse_time, utcnow
from app.models import Call, Consent, Family, Member, ReadinessSnapshot, Result
from app.schemas import OUTCOME_LABELS, READINESS_MAX, SCENARIOS, TACTICS
from app.services import elevenlabs, outcome, readiness, run_in_background
from app.services import scenarios as scenario_files

log = logging.getLogger("app.pipeline")

TRANSCRIPT_POLL_SECONDS = 2.0
TRANSCRIPT_POLL_TRIES = 30  # every two seconds for up to a minute
# How long after the end of a call its events are first read, so a last
# batch the phone sends just after /end is still scored.
EVENT_GRACE_SECONDS = 2.0

# Used when the scenario files cannot be read.
BUILTIN_SCENARIOS = [{
    "key": "relative_new_number",
    "voice": "clone",
    "allowed_tactics": ["new_number", "urgency", "secrecy", "emotional_appeal", "small_ask_first"],
}]


# ---------------------------------------------------------------- entry point


async def after_call(call_id: str) -> None:
    """Run in the background after a call ends (started with
    services.run_in_background). Scores the call by its kind, then keeps
    ElevenLabs' transcript as the record. Never raises; logs failures.
    OWNER: track C."""
    try:
        info = _call_info(call_id)
        if info is None:
            log.warning("after_call: no call %s", call_id)
            return
        if info.status != "ended":
            log.info("after_call: call %s is %s, not ended; nothing to do", call_id, info.status)
            return
        await asyncio.sleep(grace_left(info.ended_at))
        info = _call_info(call_id)
        if info is None or info.status != "ended":
            return  # scored meanwhile by another run
        await _score_by_kind(call_id, info.kind)
        if info.conversation_id and not get_settings().fake_elevenlabs:
            run_in_background(keep_transcript(call_id, info.conversation_id), f"transcript:{call_id}")
    except Exception:
        log.exception("after_call failed for %s", call_id)


@dataclass
class CallInfo:
    kind: str
    status: str
    conversation_id: str | None
    ended_at: str | None


def _call_info(call_id: str) -> CallInfo | None:
    with new_session() as db:
        call = db.get(Call, call_id)
        if call is None:
            return None
        return CallInfo(call.kind, call.status, call.conversation_id, call.ended_at)


def grace_left(ended_at: str | None) -> float:
    """Seconds still to wait, so that EVENT_GRACE_SECONDS have passed since
    the call ended before its events are read: the phone may send its last
    batch just after /end (the events endpoint still takes it).

    Only a call that ended within the last EVENT_GRACE_SECONDS waits. One
    that ended earlier needs no wait; an unknown end time or one in the
    future (the server stamps ended_at itself, so only made-up data has
    that) gets none either."""
    ended = parse_time(ended_at)
    if ended is None:
        return 0.0
    since_end = (utcnow() - ended).total_seconds()
    if since_end < 0 or since_end >= EVENT_GRACE_SECONDS:
        return 0.0
    return EVENT_GRACE_SECONDS - since_end


async def _score_by_kind(call_id: str, kind: str) -> None:
    try:
        if kind == "practice":
            await score_practice(call_id)
        elif kind == "welcome":
            await score_welcome(call_id)
        else:
            finish_family_line(call_id)
    except Exception:
        log.exception("scoring failed for %s call %s", kind, call_id)


# ---------------------------------------------------------------- transcripts and events


def _clock(t: Any) -> str:
    if not isinstance(t, (int, float)):
        return ""
    seconds = max(0, int(t))
    return f"[{seconds // 60}:{seconds % 60:02d}] "


def transcript_text(call_events: list[dict[str, Any]], agent_label: str, user_label: str,
                    show_tactics: bool = False) -> str:
    """The call as plain lines, from the stored `turn` events (and, for a
    practice, the tactics the caller marked)."""
    lines: list[str] = []
    for event in call_events:
        data = event.get("data") or {}
        if event.get("type") == "turn":
            text = " ".join(str(data.get("text") or "").split())
            if text:
                who = agent_label if data.get("speaker") == "agent" else user_label
                lines.append(f"{_clock(event.get('t'))}{who}: {text}")
        elif show_tactics and event.get("type") == "tactic" and data.get("key") in TACTICS:
            lines.append(f"{_clock(event.get('t'))}(the caller starts the tactic: {data['key']})")
    return "\n".join(lines)


def turns_as_events(turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Written turns [{speaker, text}] (test fixtures) in the stored event form."""
    return [{"type": "turn", "t": turn.get("t"), "data": {"speaker": turn.get("speaker"), "text": turn.get("text")}}
            for turn in turns]


def has_turns(call_events: list[dict[str, Any]]) -> bool:
    return any(event.get("type") == "turn" for event in call_events)


def tactics_marked(call_events: list[dict[str, Any]]) -> list[str]:
    """The tactic keys from the call's tactic events, first use first, no repeats."""
    keys: list[str] = []
    for event in call_events:
        key = (event.get("data") or {}).get("key")
        if event.get("type") == "tactic" and key in TACTICS and key not in keys:
            keys.append(key)
    return keys


def consent_from_events(call_events: list[dict[str, Any]]) -> bool | None:
    """The last `consent` event's answer, or None if there was none."""
    given: bool | None = None
    for event in call_events:
        if event.get("type") == "consent":
            given = (event.get("data") or {}).get("given") is True
    return given


def _load_json(raw: str | None) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


# ---------------------------------------------------------------- practice


async def score_practice(call_id: str) -> None:
    """Outcome by rule, the scorer, the results row, readiness, `result`,
    then the planner for this member."""
    with new_session() as db:
        call = db.get(Call, call_id)
        target = db.get(Member, call.target_member_id) if call else None
        if call is None or target is None:
            return
        call_events = events.list_events(call_id, db=db)
        decision = outcome.decide_outcome(call_events, call.ended_by,
                                          parse_time(call.answered_at), parse_time(call.ended_at))
        marked = tactics_marked(call_events)
        if decision.outcome is None and not has_turns(call_events):
            # Nothing was said and nothing was decided (an error or a silent
            # timeout): no result, and readiness does not move.
            call.status = "scored"
            db.commit()
            log.info("practice %s had no conversation; scored without a result", call_id)
            return
        transcript = transcript_text(call_events, "Caller", target.name, show_tactics=True)
        context = {"rule_outcome": decision.outcome, "tactics_marked": marked, "scenario": call.scenario,
                   "difficulty": call.difficulty, "target_name": target.name}
        member_id = target.id
        db.commit()  # nothing pending while the model runs

    score = await scorer.score_call(transcript, context)

    # From here to the commit there is no await: the family number may be
    # tapped meanwhile, and its callback_seconds must be read fresh.
    with new_session() as db:
        call = db.get(Call, call_id)
        if call is None or db.get(Result, call_id) is not None:
            return
        result = write_result(db, call, decision, score, marked)
        write_practice_snapshot(db, member_id, call_id, result, guessed=is_guess(decision, score))
        call.status = "scored"
        db.commit()
        data = result_event_data(result)

    try:
        events.publish(call_id, "result", data)
    except Exception:
        log.exception("could not publish the result of %s", call_id)
    await plan_members(call_id, only_member_id=member_id)


def write_result(db: DbSession, call: Call, decision: outcome.OutcomeDecision,
                 score: dict[str, Any], marked: list[str]) -> Result:
    """The results row: the rule's outcome (else the scorer's), the scorer's
    words, the marked tactics, and callback_seconds copied from the call."""
    final = decision.outcome or score["outcome"]
    if decision.outcome is not None:
        seconds = decision.seconds_to_challenge
    else:
        seconds = outcome.seconds_for(final, parse_time(call.answered_at), parse_time(call.ended_at))
    result = Result(
        call_id=call.id,
        outcome=final,
        seconds_to_challenge=seconds,
        tactics_used_json=json.dumps(marked or score.get("tactics_used") or []),
        tactics_worked_json=json.dumps(score.get("tactics_worked") or []),
        lesson=score.get("lesson") or scorer.fallback_lesson(final),
        debrief=score.get("debrief"),
        callback_seconds=call.callback_seconds,
        scorer_version=score.get("scorer_version"),
        created_at=now_iso(),
    )
    db.add(result)
    return result


def latest_snapshot(db: DbSession, member_id: str) -> ReadinessSnapshot | None:
    return db.scalars(
        select(ReadinessSnapshot)
        .where(ReadinessSnapshot.member_id == member_id)
        .order_by(ReadinessSnapshot.created_at.desc(), ReadinessSnapshot.id.desc())
        .limit(1)
    ).first()


def add_snapshot(db: DbSession, member_id: str, call_id: str | None, scores: dict[str, int],
                 evidence: dict[str, str]) -> ReadinessSnapshot:
    snapshot = ReadinessSnapshot(
        member_id=member_id,
        source_call_id=call_id,
        items_json=json.dumps(readiness.items_from_scores(scores, evidence)),
        total=readiness.total(scores),
        max=READINESS_MAX,
        created_at=now_iso(),
    )
    db.add(snapshot)
    return snapshot


def is_guess(decision: outcome.OutcomeDecision, score: dict[str, Any]) -> bool:
    """True when no rule decided the outcome and no model scored the call:
    the result's outcome is then only the fallback's default."""
    return decision.outcome is None and score.get("scorer_version") == scorer.FALLBACK_VERSION


def write_practice_snapshot(db: DbSession, member_id: str, call_id: str, result: Result,
                            guessed: bool = False) -> ReadinessSnapshot:
    """Readiness "now": the latest scores moved by this result (and by the
    family number, if it was tapped within a minute). A guessed outcome
    (see is_guess) moves nothing but the family-number item."""
    previous = latest_snapshot(db, member_id)
    items = _load_json(previous.items_json) if previous else []
    before = readiness.scores_from_items(items)
    evidence = readiness.evidence_from_items(items)
    if guessed:
        after = readiness.normalize(readiness.apply_callback(before, result.callback_seconds))
    else:
        after = readiness.apply_result(before, result.outcome, result.seconds_to_challenge,
                                       result.callback_seconds)
    note = f"Practice call: {OUTCOME_LABELS.get(result.outcome, result.outcome).lower()}"
    if result.seconds_to_challenge is not None:
        note += f" after {round(result.seconds_to_challenge)} s"
    for key in after:
        if after[key] != before[key]:
            evidence[key] = note
    if after["trusted_contact"] != before["trusted_contact"] and result.callback_seconds is not None:
        evidence["trusted_contact"] = f"Rang the family number {round(result.callback_seconds)} s after a practice"
    return add_snapshot(db, member_id, call_id, after, evidence)


def result_event_data(result: Result) -> dict[str, Any]:
    return {
        "outcome": result.outcome,
        "seconds_to_challenge": result.seconds_to_challenge,
        "lesson": result.lesson,
        "debrief": result.debrief,
        "tactics_used": _load_json(result.tactics_used_json) or [],
        "tactics_worked": _load_json(result.tactics_worked_json) or [],
        "callback_seconds": result.callback_seconds,
    }


# ---------------------------------------------------------------- welcome


async def score_welcome(call_id: str) -> None:
    """The profiler, spoken consent, the "before" snapshot, then the planner
    for the whole family.

    A welcome call where nothing was said (it dropped, or failed) changes
    no profile, snapshot or plan; only an explicit consent event counts. A
    fallback profile (every model failed) never replaces one a model made.
    So a failed welcome call can be run again, and the good run wins."""
    with new_session() as db:
        call = db.get(Call, call_id)
        member = db.get(Member, call.target_member_id) if call else None
        if call is None or member is None:
            return
        call_events = events.list_events(call_id, db=db)
        consent_event = consent_from_events(call_events)
        if not has_turns(call_events):
            finish_welcome(db, member, call, consent_event)
            log.info("welcome %s had no conversation; profile and readiness unchanged", call_id)
            return
        transcript = transcript_text(call_events, "Callback", member.name)
        db.commit()

    profile = await profiler.build_profile(transcript, consent_event)

    with new_session() as db:
        call = db.get(Call, call_id)
        member = db.get(Member, call.target_member_id) if call else None
        if call is None or member is None:
            return
        if not keeps_old_profile(member, profile):
            member.profile_json = json.dumps(profile)
            set_welcome_snapshot(db, member.id, call_id, profile)
        if profile.get("consent_practice"):
            record_spoken_consent(db, member, call, profile.get("consent_quote") or "")
        call.status = "scored"
        db.commit()

    await plan_members(call_id)


def finish_welcome(db: DbSession, member: Member, call: Call, consent_event: bool | None) -> None:
    """Score a welcome call where nothing was said: record consent only
    from an explicit consent event, then set the call to scored. Commits."""
    if consent_event:
        record_spoken_consent(db, member, call, "")
    call.status = "scored"
    db.commit()


def keeps_old_profile(member: Member, profile: dict[str, Any]) -> bool:
    """True when the new profile is the fallback and the stored one came
    from a model: a failed run must not wipe a good one."""
    if profile.get("source") != profiler.FALLBACK_SOURCE:
        return False
    stored = _load_json(member.profile_json)
    return isinstance(stored, dict) and stored.get("source") not in (None, profiler.FALLBACK_SOURCE)


def only_welcome_snapshots(db: DbSession, member_id: str) -> list[ReadinessSnapshot] | None:
    """The member's snapshots if every one came from a welcome call (none
    from a practice yet, none of unknown origin), else None."""
    rows = list(db.scalars(select(ReadinessSnapshot).where(ReadinessSnapshot.member_id == member_id)))
    for row in rows:
        source = db.get(Call, row.source_call_id) if row.source_call_id else None
        if source is None or source.kind != "welcome":
            return None
    return rows


def set_welcome_snapshot(db: DbSession, member_id: str, call_id: str, profile: dict[str, Any]) -> None:
    """Readiness "before", from the profile. Set by the first welcome call;
    a later welcome call replaces it while no practice has moved the scores
    (so a re-run after a failed welcome call fixes the family page). After
    the first practice, only practice results move the scores."""
    earlier = only_welcome_snapshots(db, member_id)
    if earlier is None:
        return
    for row in earlier:
        db.delete(row)
    items = profile.get("items") or []
    add_snapshot(db, member_id, call_id, readiness.scores_from_items(items),
                 readiness.evidence_from_items(items))


def record_spoken_consent(db: DbSession, member: Member, call: Call, quote: str) -> None:
    """A clear yes in the welcome call: a consents row (practice,
    welcome_call), unless the consent event already wrote one, and
    consent_practice_at if it was not set. Never for someone who opted out."""
    if member.opted_out_at is not None:
        return
    existing = db.scalars(
        select(Consent).where(
            Consent.member_id == member.id,
            Consent.kind == "practice",
            Consent.source == "welcome_call",
            (Consent.call_id == call.id) | (Consent.call_id.is_(None)),
        )
    ).first()
    now = now_iso()
    if existing is None:
        db.add(Consent(member_id=member.id, kind="practice", source="welcome_call",
                       evidence=quote or "a clear yes in the welcome call", call_id=call.id, created_at=now))
    if member.consent_practice_at is None:
        member.consent_practice_at = now


# ---------------------------------------------------------------- family line


def finish_family_line(call_id: str) -> None:
    with new_session() as db:
        call = db.get(Call, call_id)
        if call is not None:
            call.status = "scored"
            db.commit()


# ---------------------------------------------------------------- planner


def available_scenarios() -> list[dict[str, Any]]:
    """The scenario files that exist, as {key, voice, allowed_tactics}."""
    try:
        found = [s for s in scenario_files.list_scenarios() if s.get("key") in SCENARIOS]
    except Exception:
        log.exception("could not read the scenario files; using the relative story only")
        found = []
    return found or list(BUILTIN_SCENARIOS)


def voice_names(member: Member, family_members: list[Member]) -> list[str]:
    """Relatives whose ready clone may be used on this member (organiser first)."""
    ready = [other for other in family_members
             if other.id != member.id and other.opted_out_at is None and other.consent_clone_at
             and other.voice_status == "ready" and other.voice_id]
    ready.sort(key=lambda other: not other.is_organiser)
    return [other.name for other in ready]


def _leading_tactic(call: Call, result: Result) -> str | None:
    brief = _load_json(call.brief_json) or {}
    order = brief.get("tactic_order") if isinstance(brief, dict) else None
    keys = order.split(",") if isinstance(order, str) else (order or [])
    keys = [str(key).strip() for key in keys if str(key).strip() in TACTICS]
    if keys:
        return keys[0]
    used = _load_json(result.tactics_used_json) or []
    return used[0] if used else None


def practice_history(db: DbSession, member_id: str) -> list[dict[str, Any]]:
    """This member's scored practice results, oldest first."""
    rows = db.execute(
        select(Call, Result).join(Result, Result.call_id == Call.id)
        .where(Call.target_member_id == member_id, Call.kind == "practice")
        .order_by(Result.created_at)
    ).all()
    return [{
        "scenario": call.scenario,
        "difficulty": call.difficulty,
        "outcome": result.outcome,
        "seconds_to_challenge": result.seconds_to_challenge,
        "tactics_worked": _load_json(result.tactics_worked_json) or [],
        "leading_tactic": _leading_tactic(call, result),
    } for call, result in rows]


def member_input(db: DbSession, member: Member, family_members: list[Member],
                 available: list[dict[str, Any]]) -> dict[str, Any]:
    """One member's part of the planner's input: profile, results, and the
    choices the rules allow (see agents/planner.py)."""
    profile = _load_json(member.profile_json)
    profile = profile if isinstance(profile, dict) else None
    history = practice_history(db, member.id)
    choice = readiness.next_practice((profile or {}).get("trusts_most"), history, available)
    voices = voice_names(member, family_members)
    clone_keys = [s["key"] for s in available if s.get("voice") == "clone"]
    first = choice.scenarios[0]
    return {
        "member_id": member.id,
        "name": member.name,
        "relationship": member.relationship,
        "profile": profile,
        "results": history,
        "allowed": {
            "scenarios": choice.scenarios,
            "later_scenarios": [s["key"] for s in available],
            "clone_scenarios": clone_keys,
            "max_difficulty": choice.max_difficulty,
            "voices": voices,
        },
        "rule": {
            "scenario": first,
            "difficulty": choice.difficulty,
            "voice_of": voices[0] if voices and first in clone_keys else None,
            "reason": choice.reason,
            "leading_tactic": choice.leading_tactic,
        },
    }


def planner_input(db: DbSession, family: Family, members: list[Member],
                  family_members: list[Member]) -> dict[str, Any]:
    available = available_scenarios()
    return {
        "family_name": family.name,
        "safe_word_set": family.safe_word_set,
        "members": [member_input(db, member, family_members, available) for member in members],
    }


def plannable(member: Member) -> bool:
    """Plans are for every member who has not opted out. A member without
    practice consent still gets a plan; the consent gate stops the call
    itself, and the weekly run sends them a reminder instead."""
    return member.opted_out_at is None


async def plan_members(call_id: str, only_member_id: str | None = None) -> None:
    """Run the planner for the call's family (or one member) and store each
    member's plan, with the family tasks, in plan_json. Never raises."""
    try:
        with new_session() as db:
            call = db.get(Call, call_id)
            family = db.get(Family, call.family_id) if call else None
            if family is None:
                return
            family_members = list(db.scalars(select(Member).where(Member.family_id == family.id)
                                             .order_by(Member.created_at)))
            members = [m for m in family_members
                       if plannable(m) and (only_member_id is None or m.id == only_member_id)]
            if not members:
                return
            family_input = planner_input(db, family, members, family_members)
            db.commit()

        plan = await planner.plan_family(family_input)

        with new_session() as db:
            store_plans(db, plan, {m["member_id"] for m in family_input["members"]})
            db.commit()
    except Exception:
        log.exception("planning after %s failed", call_id)


def store_plans(db: DbSession, plan: dict[str, Any], member_ids: set[str]) -> None:
    tasks = plan.get("family_tasks") or []
    for member_plan in plan.get("members") or []:
        member = db.get(Member, member_plan.get("member_id"))
        if member is None or member.id not in member_ids:
            continue
        member.plan_json = json.dumps({**member_plan, "family_tasks": tasks})


# ---------------------------------------------------------------- ElevenLabs' transcript


def transcript_path(call_id: str) -> Path:
    return get_settings().media_path / "transcripts" / f"{call_id}.json"


async def keep_transcript(call_id: str, conversation_id: str | None) -> None:
    """Ask ElevenLabs every two seconds, for up to a minute, until the
    conversation is done, then save its transcript as the record. Skipped in
    fake mode, without a conversation id, or on any error. Never raises."""
    if get_settings().fake_elevenlabs or not conversation_id:
        return
    try:
        for _ in range(TRANSCRIPT_POLL_TRIES):
            conversation = await elevenlabs.get_conversation(conversation_id)
            status = conversation.get("status")
            if status == "done":
                save_transcript(call_id, conversation_id, conversation)
                return
            if status == "failed":
                log.info("ElevenLabs reports conversation %s as failed", conversation_id)
                return
            await asyncio.sleep(TRANSCRIPT_POLL_SECONDS)
        log.info("conversation %s not done after a minute; transcript not kept", conversation_id)
    except Exception as exc:  # noqa: BLE001  (the record is optional)
        log.info("transcript for %s not kept: %s", call_id, type(exc).__name__)


def save_transcript(call_id: str, conversation_id: str, conversation: dict[str, Any]) -> Path:
    path = transcript_path(call_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "call_id": call_id,
        "conversation_id": conversation_id,
        "status": conversation.get("status"),
        "transcript": conversation.get("transcript") or [],
        "analysis": conversation.get("analysis"),
        "saved_at": now_iso(),
    }
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
