"""All tables from docs/backend.md ("Data").

Deliberate changes from backend.md:
- families has `safe_word_set` and NO column for the word itself.
- calls has `callback_seconds` (track B writes it when the family number is
  tapped; track C copies it into results) and `caller_number` (the made-up
  number the phone shows, from briefs.build_brief).

Conventions:
- Times are ISO 8601 text in UTC (db.now_iso(), db.parse_time()).
- *_json columns hold JSON text. Formats:
  - members.profile_json: ai.md `Profile` (consent_practice, consent_quote,
    items[{key, score, evidence}], trusts_most, said, weak_spot).
  - members.plan_json: ai.md `MemberPlan` (member_id, weak_spot, this_week,
    steps[{when, scenario, difficulty, voice_of, why, status?}]).
    `status` is optional per step: planned | scheduled | done (default planned).
  - calls.brief_json: the dynamic variables, exactly as sent to the agent.
  - call_events.data_json: the event's fields, without seq and t.
  - readiness_snapshots.items_json: [{key, score, evidence?}] with the five
    keys from schemas.READINESS_KEYS; total is their sum, max is 10.

Added after backend.md: push_subscriptions (Web Push, services/push.py).
Track 3 (docs/full-app/protection.md): protection_settings,
member_drill_settings, call_shield, drill_calls; messages.kind gains `alert`.
"""

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Family(Base):
    __tablename__ = "families"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    safe_word_set: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class Member(Base):
    __tablename__ = "members"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    relationship: Mapped[str] = mapped_column(String, nullable=False)
    is_organiser: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    consent_clone_at: Mapped[str | None] = mapped_column(String)
    consent_practice_at: Mapped[str | None] = mapped_column(String)
    opted_out_at: Mapped[str | None] = mapped_column(String)
    voice_id: Mapped[str | None] = mapped_column(String)
    voice_status: Mapped[str] = mapped_column(String, nullable=False, default="none")
    profile_json: Mapped[str | None] = mapped_column(Text)
    plan_json: Mapped[str | None] = mapped_column(Text)
    last_seen_at: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class Call(Base):
    __tablename__ = "calls"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String, nullable=False)  # welcome | practice | family_line
    target_member_id: Mapped[str] = mapped_column(ForeignKey("members.id"), nullable=False, index=True)
    voice_member_id: Mapped[str | None] = mapped_column(ForeignKey("members.id"))
    scenario: Mapped[str | None] = mapped_column(String)
    difficulty: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    brief_json: Mapped[str | None] = mapped_column(Text)
    caller_label: Mapped[str | None] = mapped_column(String)
    caller_number: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, nullable=False, index=True)
    scheduled_for: Mapped[str | None] = mapped_column(String)
    conversation_id: Mapped[str | None] = mapped_column(String)
    parent_call_id: Mapped[str | None] = mapped_column(ForeignKey("calls.id"))
    ring_at: Mapped[str | None] = mapped_column(String)
    answered_at: Mapped[str | None] = mapped_column(String)
    ended_at: Mapped[str | None] = mapped_column(String)
    ended_by: Mapped[str | None] = mapped_column(String)  # agent | user | timeout | error
    callback_seconds: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class CallEvent(Base):
    __tablename__ = "call_events"
    __table_args__ = (UniqueConstraint("call_id", "seq"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"), nullable=False, index=True)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    t: Mapped[float | None] = mapped_column(Float)
    data_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class Result(Base):
    __tablename__ = "results"

    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"), primary_key=True)
    outcome: Mapped[str] = mapped_column(String, nullable=False)
    seconds_to_challenge: Mapped[float | None] = mapped_column(Float)
    tactics_used_json: Mapped[str] = mapped_column(Text, nullable=False)
    tactics_worked_json: Mapped[str] = mapped_column(Text, nullable=False)
    lesson: Mapped[str] = mapped_column(Text, nullable=False)
    debrief: Mapped[str | None] = mapped_column(Text)
    callback_seconds: Mapped[float | None] = mapped_column(Float)
    scorer_version: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class Consent(Base):
    __tablename__ = "consents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String, nullable=False)  # clone | practice | practice_withdrawn | opt_out
    source: Mapped[str] = mapped_column(String, nullable=False)  # voice_recording | welcome_call | manual
    evidence: Mapped[str | None] = mapped_column(Text)
    call_id: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class ReadinessSnapshot(Base):
    __tablename__ = "readiness_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id"), nullable=False, index=True)
    source_call_id: Mapped[str | None] = mapped_column(String)
    items_json: Mapped[str] = mapped_column(Text, nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    max: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String, nullable=False)  # weekly | callback_notice | reminder | alert
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    read_at: Mapped[str | None] = mapped_column(String)


class PushSubscription(Base):
    """One browser's Web Push subscription (PushSubscription.toJSON()), for
    one member. The endpoint is unique: subscribing again from the same
    browser updates the row, and moves it to that member."""

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id"), nullable=False, index=True)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    p256dh: Mapped[str] = mapped_column(String, nullable=False)
    auth: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    last_success_at: Mapped[str | None] = mapped_column(String)
    failure_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # in a row; a success resets it


class Digest(Base):
    __tablename__ = "digests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    week: Mapped[str] = mapped_column(String, nullable=False)
    sources_json: Mapped[str] = mapped_column(Text, nullable=False)
    tactics_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class ModelRun(Base):
    __tablename__ = "model_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job: Mapped[str] = mapped_column(String, nullable=False)
    model: Mapped[str] = mapped_column(String, nullable=False)
    prompt_version: Mapped[str] = mapped_column(String, nullable=False)
    input_json: Mapped[str] = mapped_column(Text, nullable=False)
    output_json: Mapped[str | None] = mapped_column(Text)
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


# ---------------------------------------------------------------- track 3: protection, drills, the Shield
# New tables only (create_all adds them to an existing database file); see
# docs/full-app/protection.md.


class ProtectionSettings(Base):
    """A family's protection: random drills and the Shield. No row means the
    defaults below (drills off, the Shield on)."""

    __tablename__ = "protection_settings"

    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # random drills
    drills_per_week: Mapped[int] = mapped_column(Integer, nullable=False, default=2)  # 1 to 7
    window_start_hour: Mapped[int] = mapped_column(Integer, nullable=False, default=10)  # local, inclusive
    window_end_hour: Mapped[int] = mapped_column(Integer, nullable=False, default=19)  # local, exclusive
    timezone: Mapped[str] = mapped_column(String, nullable=False, default="Europe/Vilnius")
    shield_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[str | None] = mapped_column(String)


class MemberDrillSettings(Base):
    """One member's own switch for random drills. No row means not paused."""

    __tablename__ = "member_drill_settings"

    member_id: Mapped[str] = mapped_column(ForeignKey("members.id"), primary_key=True)
    paused: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[str | None] = mapped_column(String)


class CallShield(Base):
    """Marks a practice call as a shield call: a simulated scam call during
    which the Shield warns the person and alerts the family by itself.
    alerted_at is set once, when the family is alerted."""

    __tablename__ = "call_shield"

    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"), primary_key=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    alerted_at: Mapped[str | None] = mapped_column(String)
    alert_level: Mapped[str | None] = mapped_column(String)  # the risk level that set off the alert


class DrillCall(Base):
    """A practice call made by the random-drill pass or a surprise drill, so
    a pause or a change of the drill settings can cancel the pending ones."""

    __tablename__ = "drill_calls"

    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"), primary_key=True)
    family_id: Mapped[str] = mapped_column(ForeignKey("families.id"), nullable=False, index=True)
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id"), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String, nullable=False)  # random | surprise
    created_at: Mapped[str] = mapped_column(String, nullable=False)
