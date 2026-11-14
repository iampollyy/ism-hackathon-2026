"""Request and response shapes (docs/backend.md "The API", docs/idea.md contract).

Also the fixed lists (tactics, outcomes, scenarios, call kinds and states),
their human labels, and ApiError, the one exception routers raise to answer
with the error shape {"error": {"code", "message"}}.

No shape here has a field for the safe word. Only `safe_word_set` exists.
"""

import base64
import re
from typing import Annotated, Any, Literal, Union
from urllib.parse import urlsplit

from pydantic import AfterValidator, BaseModel, Field, StringConstraints


from pydantic import AfterValidator, BaseModel, Field, StrictBool

# ---------------------------------------------------------------- fixed lists

Tactic = Literal[
    "new_number", "urgency", "secrecy", "authority",
    "emotional_appeal", "small_ask_first", "isolation", "unusual_payment",
]
Outcome = Literal["asked_safe_word", "hung_up", "asked_personal_question", "hesitated", "agreed"]
ScenarioKey = Literal["relative_new_number", "police", "bank_security", "hospital"]
CallKind = Literal["welcome", "practice", "family_line"]
CallStatus = Literal[
    "scheduled", "ringing", "in_progress", "ended", "scored", "declined", "missed", "failed",
]
EndedBy = Literal["agent", "user", "timeout", "error"]
Speaker = Literal["agent", "user"]
VoiceStatus = Literal["none", "ready", "failed", "deleted"]
MessageKind = Literal["weekly", "callback_notice", "reminder", "alert"]  # alert: track 3, the Shield
ConsentKind = Literal["clone", "practice", "practice_withdrawn", "opt_out"]
ConsentSource = Literal["voice_recording", "welcome_call", "manual"]
ReadinessKey = Literal["verify_first", "safe_word", "trusted_contact", "payment_caution", "under_pressure"]
EventType = Literal[
    "call.status", "turn", "tactic", "outcome", "revealed", "callback.connected", "result", "consent",
    "risk",
    "voice_consent",  # track 2: the welcome agent's voice_consent_result

    "risk", "shield.alert",  # shield.alert: track 3, the Shield alerted the family
]
# The live risk check (agents/risk.py): the tactics, plus three signs that a
# call is a scam. Code maps the signals to the level.
RiskSignal = Literal[Tactic, "money_request", "asks_for_code", "refuses_callback"]
RiskLevel = Literal["green", "yellow", "red"]

TACTICS: tuple[str, ...] = Tactic.__args__  # type: ignore[attr-defined]
RISK_SIGNALS: tuple[str, ...] = RiskSignal.__args__  # type: ignore[attr-defined]
RISK_LEVELS: tuple[str, ...] = RiskLevel.__args__  # type: ignore[attr-defined]
OUTCOMES: tuple[str, ...] = Outcome.__args__  # type: ignore[attr-defined]
SCENARIOS: tuple[str, ...] = ScenarioKey.__args__  # type: ignore[attr-defined]
READINESS_KEYS: tuple[str, ...] = ReadinessKey.__args__  # type: ignore[attr-defined]

TACTIC_LABELS: dict[str, str] = {
    "new_number": "New number",
    "urgency": "Urgency",
    "secrecy": "Secrecy",
    "authority": "Authority",
    "emotional_appeal": "Emotional appeal",
    "small_ask_first": "Small ask first",
    "isolation": "Don't call anyone",
    "unusual_payment": "Unusual payment",
}

RISK_SIGNAL_LABELS: dict[str, str] = {
    **TACTIC_LABELS,
    "money_request": "Asks for money",
    "asks_for_code": "Asks for a code",
    "refuses_callback": "Avoids a call-back",
}

OUTCOME_LABELS: dict[str, str] = {
    "asked_safe_word": "Asked for the family word",
    "hung_up": "Hung up",
    "asked_personal_question": "Asked a personal question",
    "hesitated": "Hesitated",
    "agreed": "Agreed",
}

READINESS_LABELS: dict[str, str] = {
    "verify_first": "Checks before acting",
    "safe_word": "Family word",
    "trusted_contact": "Someone to ring",
    "payment_caution": "Careful with payments",
    "under_pressure": "Calm under pressure",
}
READINESS_ITEM_MAX = 2
READINESS_MAX = READINESS_ITEM_MAX * len(READINESS_LABELS)  # 10

# How long each kind of call may run, as sent in the session. The agents'
# max_duration_seconds is this plus 30; the scheduler ends calls after that.
MAX_SECONDS: dict[str, int] = {"welcome": 330, "practice": 150, "family_line": 60}


# ---------------------------------------------------------------- errors


class ApiError(Exception):
    """Raise from any router or service to answer with the error shape."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


class ErrorBody(BaseModel):
    code: str  # e.g. not_found, consent_missing, voice_not_ready, busy, phone_offline, clone_failed
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody


class Ok(BaseModel):
    ok: bool = True


# ---------------------------------------------------------------- families


class MemberCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    relationship: str = Field(min_length=1, max_length=40)  # mother, son, friend
    is_organiser: bool = False
    consent_practice: bool = False  # "I agree to receive practice calls without knowing when."
    # The organiser's own tick "Callback may copy my voice from my welcome call" (only theirs counts).
    consent_clone_from_call: bool = False


class FamilyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    safe_word_set: bool = False  # the family has agreed a word; the word is never collected
    members: list[MemberCreate] = Field(min_length=1, max_length=12)


class MemberLink(BaseModel):
    id: str
    name: str
    phone_link: str  # /phone/{member_id}


class FamilyCreated(BaseModel):
    family_id: str
    members: list[MemberLink]


class ConsentUpdate(BaseModel):
    consent_practice: bool  # the same tick as at sign-up, later: true gives consent, false withdraws it


class ConsentView(BaseModel):
    clone: bool
    practice: bool


class ReadinessItemView(BaseModel):
    key: ReadinessKey
    label: str
    before: int
    now: int
    max: int = READINESS_ITEM_MAX


class ReadinessView(BaseModel):
    before: int
    now: int
    max: int = READINESS_MAX
    items: list[ReadinessItemView]


class PlanStepView(BaseModel):
    when: str
    scenario: ScenarioKey
    difficulty: int = 1
    voice_of: str | None = None
    why: str
    status: str = "planned"  # planned | scheduled | done


class PlanView(BaseModel):
    this_week: str
    steps: list[PlanStepView]


class MemberView(BaseModel):
    id: str
    name: str
    relationship: str
    is_organiser: bool
    phone_link: str
    consent: ConsentView
    voice_ready: bool
    voice_status: VoiceStatus
    phone_online: bool  # phone-state asked in the last five seconds
    readiness: ReadinessView
    weak_spot: str | None = None
    said: str | None = None  # their quote from the welcome call
    plan: PlanView | None = None
    # Track 1: the invite (docs/full-app/track1.md). invite_link and
    # phone_number are "" and None unless the reader may see them
    # (services/accounts.can_see_invites); phone_number is None once they opted out.
    invite_link: str = ""  # /join/{member_id}
    joined: bool = False  # they opened the invite link and joined
    joined_at: str | None = None
    phone_number: str | None = None  # as given on the invite page


class FamilyReadinessView(BaseModel):
    before: int
    now: int
    max: int


class FamilyNumber(BaseModel):
    enabled: bool


class WeekItem(BaseModel):
    kind: Literal["welcome", "practice", "family_line", "message", "reminder", "weekly", "alert"]
    member_id: str
    member_name: str
    status: str  # a call status, or "sent" / "read" for a message
    when: str  # ISO time: scheduled_for, ended_at or created_at
    text: str
    call_id: str | None = None


class FamilyView(BaseModel):
    id: str
    name: str
    safe_word_set: bool
    family_number: FamilyNumber
    members: list[MemberView]
    readiness: FamilyReadinessView
    week: list[WeekItem]  # recent and planned activity, newest first


# ---------------------------------------------------------------- voice


class VoiceReady(BaseModel):
    voice_ready: bool


# ---------------------------------------------------------------- calls


class PracticeCallCreate(BaseModel):
    target_member_id: str
    voice_member_id: str | None = None  # None: a library voice
    scenario: ScenarioKey = "relative_new_number"
    difficulty: int = Field(default=1, ge=1, le=3)
    delay_seconds: int = Field(default=0, ge=0, le=7 * 24 * 3600)


class CallCreated(BaseModel):
    call_id: str
    status: CallStatus


class Reveal(BaseModel):
    voice_of: str | None  # the name whose clone spoke, or None for a library voice
    kind: Literal["practice", "shield"] = "practice"  # shield: a simulated scam call (track 3)


class Session(BaseModel):
    """What the phone page passes to startSession()."""

    kind: CallKind
    conversation_token: str
    conversation_id: str
    overrides: dict[str, Any]  # {"tts": {"voiceId": "..."}} or {}
    dynamic_variables: dict[str, str | int | float]
    max_seconds: int
    reveal: Reveal | None = None  # practice calls only


class FamilyLineStarted(BaseModel):
    call_id: str
    session: Session


class PersonRef(BaseModel):
    id: str
    name: str


class TurnView(BaseModel):
    speaker: Speaker
    text: str
    t: float | None
    tactic: Tactic | None = None


class TacticView(BaseModel):
    key: Tactic
    label: str
    t: float | None


class RiskPointView(BaseModel):
    """One stored `risk` event: the light after one check (backend.md)."""

    level: RiskLevel
    signals: list[RiskSignal]
    labels: list[str]
    reason: str
    turn_index: int  # index in CallView.turns of the last caller line checked
    source: str  # the prompt version, or "fallback"
    t: float | None


class CallResultView(BaseModel):
    outcome: Outcome
    seconds_to_challenge: float | None
    lesson: str
    debrief: str | None = None
    tactics_used: list[Tactic] = []
    tactics_worked: list[Tactic] = []


class CallView(BaseModel):
    id: str
    kind: CallKind
    status: CallStatus
    target: PersonRef
    voice_of: PersonRef | None
    scenario: ScenarioKey | None
    difficulty: int
    caller_label: str | None
    turns: list[TurnView]
    tactics: list[TacticView]
    risk: list[RiskPointView] = []  # the live risk check's results, in order (practice calls)
    shield: "CallShieldView | None" = None  # set only on a shield call (track 3)
    result: CallResultView | None  # None until the call is scored
    callback_seconds: float | None
    answered_at: str | None = None
    ended_at: str | None = None
    ended_by: EndedBy | None = None
    family_id: str | None = None  # so a screen can link back to the family page
    # The first outcome the agent reported and its seconds to the first
    # challenge, as soon as it is stored (result only comes after scoring).
    live_outcome: Outcome | None = None
    live_seconds_to_challenge: float | None = None
    consent_given: bool | None = None  # welcome calls: the last consent answer so far


# ---------------------------------------------------------------- events from the phone


class TurnIn(BaseModel):
    type: Literal["turn"]
    speaker: Speaker
    text: str = Field(min_length=1, max_length=4000)


class TacticIn(BaseModel):
    type: Literal["tactic"]
    key: Tactic


class OutcomeIn(BaseModel):
    type: Literal["outcome"]
    outcome: Outcome


class RevealedIn(BaseModel):
    type: Literal["revealed"]


class ConsentIn(BaseModel):
    type: Literal["consent"]
    given: bool


class VoiceConsentIn(BaseModel):
    """Track 2: the welcome agent's voice_consent_result (may Callback use
    their voice from this call?). Welcome calls only; see services/voice_sample.py."""

    type: Literal["voice_consent"]
    given: StrictBool  # true only for a clear yes; JSON true or false only, never "yes" or 1


EventIn = Annotated[
    Union[TurnIn, TacticIn, OutcomeIn, RevealedIn, ConsentIn, VoiceConsentIn],
    Field(discriminator="type"),
]


class EventsBatch(BaseModel):
    events: list[EventIn] = Field(min_length=1, max_length=100)


class EndRequest(BaseModel):
    ended_by: EndedBy


# ---------------------------------------------------------------- phone state


class PhoneMember(BaseModel):
    id: str
    name: str
    family: str  # the family's name
    family_id: str | None = None  # for the phone's News tab
    voice_ready: bool = False  # a copy of this member's voice exists


class Caller(BaseModel):
    label: str  # "Unknown number"
    number: str  # made up; never a real number or institution's


class IncomingCall(BaseModel):
    call_id: str
    kind: Literal["welcome", "practice"]
    caller: Caller


class PhoneMessage(BaseModel):
    id: int
    kind: MessageKind
    text: str
    created_at: str


class PhoneState(BaseModel):
    member: PhoneMember
    incoming_call: IncomingCall | None
    messages: list[PhoneMessage]  # unread only
    family_number: FamilyNumber
    shield: "ShieldState | None" = None  # set only during a shield call (track 3)


class MessagesRead(BaseModel):
    ids: list[int] | None = None  # None: mark all as read


# ---------------------------------------------------------------- web push

# The push services the browsers use (Chrome and Android, Firefox, Safari and
# iOS, Edge). We POST to the endpoint a page sends, so only these hosts are taken.
PUSH_SERVICE_HOSTS = ("fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com")


def _b64url_bytes(value: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]+={0,2}", value):
        raise ValueError("must be URL-safe base64")
    stripped = value.rstrip("=")
    return base64.urlsafe_b64decode(stripped + "=" * (-len(stripped) % 4))


def _p256dh(value: str) -> str:
    raw = _b64url_bytes(value)
    if len(raw) != 65 or raw[0] != 4:
        raise ValueError("must be an uncompressed P-256 public key")
    return value


def _auth_secret(value: str) -> str:
    if len(_b64url_bytes(value)) != 16:
        raise ValueError("must be 16 bytes")
    return value


def _push_endpoint(value: str) -> str:
    url = urlsplit(value)
    host = (url.hostname or "").lower()
    if url.scheme != "https" or not any(host == known or host.endswith("." + known)
                                        for known in PUSH_SERVICE_HOSTS):
        raise ValueError("must be the https address of a browser push service")
    return value


class PushKeys(BaseModel):
    p256dh: Annotated[str, Field(max_length=200), AfterValidator(_p256dh)]
    auth: Annotated[str, Field(max_length=100), AfterValidator(_auth_secret)]


class PushSubscriptionIn(BaseModel):
    """The browser's PushSubscription.toJSON(); expirationTime is ignored."""

    endpoint: Annotated[str, Field(max_length=2048), AfterValidator(_push_endpoint)]
    keys: PushKeys


class PushSubscriptionRemove(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2048)  # toJSON() works here too


class PushPublicKey(BaseModel):
    enabled: bool  # False: push is off (no VAPID keys set); do not subscribe
    public_key: str | None = None  # for pushManager.subscribe({applicationServerKey})


# ---------------------------------------------------------------- scenarios


class ScenarioView(BaseModel):
    key: ScenarioKey
    title: str
    voice: Literal["clone", "library"]
    caller_label: str
    allowed_tactics: list[Tactic]


# ---------------------------------------------------------------- weekly run


class PatternView(BaseModel):
    title: str
    summary: str
    tactics: list[Tactic]
    closest_scenario: ScenarioKey
    source_url: str


class DigestView(BaseModel):
    week: str  # e.g. "2026-W46"
    patterns: list[PatternView]


class WeeklyAction(BaseModel):
    member_id: str
    member_name: str
    kind: Literal["message", "practice", "reminder"]
    text: str
    call_id: str | None = None


class WeeklyRunResult(BaseModel):
    digest: DigestView
    actions: list[WeeklyAction]


# ---------------------------------------------------------------- health


class Health(BaseModel):
    ok: bool = True
    fake_elevenlabs: bool


# ---------------------------------------------------------------- billing (Saturday, demo mode)

PlanKey = Literal["trial", "family_monthly", "family_yearly", "bank"]
TRIAL_DAYS = 30


class PricePlan(BaseModel):
    key: str  # family_monthly | family_yearly | bank | partner
    name: str
    price: str  # shown as is, e.g. "€4.99 a month"
    price_eur: float | None  # None: free or on request
    period: Literal["month", "year"] | None
    note: str
    features: list[str]
    cta: str
    choosable: bool  # false: "Talk to us" (for banks)


class Pricing(BaseModel):
    trial_days: int
    currency: str
    plans: list[PricePlan]
    demo_note: str


class FamilyPlanView(BaseModel):
    plan: PlanKey
    plan_name: str
    status: Literal["trialing", "active", "canceled"]
    price: str | None
    trial_ends_at: str | None  # while trialing
    started_at: str
    bank_code: str | None
    demo: bool = True  # no payment is ever taken


class PlanChoice(BaseModel):
    plan: Literal["family_monthly", "family_yearly", "bank"]
    bank_code: str | None = Field(default=None, max_length=40)


# ---------------------------------------------------------------- waitlist (landing page)


class WaitlistIn(BaseModel):
    email: str = Field(min_length=5, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    kind: Literal["family", "bank"] = "family"
    organisation: str | None = Field(default=None, max_length=120)
    message: str | None = Field(default=None, max_length=1000)
    source: str | None = Field(default=None, max_length=60)


class WaitlistCount(BaseModel):
    families: int
    banks: int


# ---------------------------------------------------------------- track 1: organiser accounts, invites and joining
# docs/full-app/track1.md. The password is checked in the router (8 to 200
# characters) so a short one answers 422 password_too_short.

PASSWORD_MAX_CHARS = 200


def _email(value: str) -> str:
    value = value.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
        raise ValueError("must be an email address")
    return value


def _phone_number(value: str | None) -> str | None:
    """Loose: an optional leading +, then digits and spaces, 6 to 20
    characters in all. Empty means none."""
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if not (6 <= len(value) <= 20 and re.fullmatch(r"\+?[0-9][0-9 ]*", value)):
        raise ValueError("must be 6 to 20 digits and spaces, with an optional leading +")
    return value


Email = Annotated[str, Field(max_length=254), AfterValidator(_email)]


class RegisterIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]  # trimmed first
    email: Email
    password: str = Field(max_length=PASSWORD_MAX_CHARS)


class LoginIn(BaseModel):
    email: str = Field(max_length=254)  # not validated: a wrong one is only a wrong log-in
    password: str = Field(max_length=PASSWORD_MAX_CHARS)


class AccountView(BaseModel):
    id: str
    name: str
    email: str


class FamilyRef(BaseModel):
    id: str
    name: str


class Me(BaseModel):
    account: AccountView
    families: list[FamilyRef]  # oldest first


class FamilySummary(BaseModel):
    id: str
    name: str
    safe_word_set: bool
    created_at: str
    member_count: int
    joined_count: int  # members who joined by their invite link


class FamilyList(BaseModel):
    families: list[FamilySummary]  # oldest first


class JoinFamily(BaseModel):
    # No id: the family id opens the family page, which lists every member's
    # id (the only key to their invite and phone pages).
    name: str
    safe_word_set: bool


class JoinOrganiser(BaseModel):
    name: str


class JoinMember(BaseModel):
    id: str
    name: str
    relationship: str


class JoinConsents(BaseModel):
    practice: bool  # practice calls without knowing when
    clone_from_call: bool  # their voice may be cloned from their welcome call


class JoinView(BaseModel):
    family: JoinFamily
    organiser: JoinOrganiser | None
    member: JoinMember
    joined: bool
    joined_at: str | None = None
    phone_number: str | None = None
    opted_out: bool = False  # they left Callback; joining is refused (409)
    consents: JoinConsents
    phone_link: str  # /phone/{member_id}


class JoinIn(BaseModel):
    consent_practice: bool
    consent_clone_from_call: bool
    phone_number: Annotated[str | None, Field(max_length=40), AfterValidator(_phone_number)] = None


class Joined(BaseModel):
    phone_link: str


# ---------------------------------------------------------------- track 2: the member's voice from the welcome call

# none: nothing is kept from this call (yet); waiting_for_consent: the
# recording is kept until the spoken yes arrives; cloning: the clone is being
# made; ready: a clone was made from this call; failed: it could not be.
VoiceSampleState = Literal["none", "waiting_for_consent", "cloning", "ready", "failed"]


class VoiceSampleAccepted(BaseModel):
    """The answer to POST /api/calls/{id}/voice-sample, given at once."""

    accepted: bool = True
    cloning: bool  # True: both consents and the recording are in; the clone is being made now
    reason: str | None = None  # why it is not cloning (yet), in plain words; None when cloning


class VoiceSampleStatus(BaseModel):
    call_id: str | None  # the welcome call; None when the member has had none
    state: VoiceSampleState
    reason: str | None = None  # plain words for the screen; None when cloning or ready
    speech_seconds: float | None = None  # seconds of their voice heard, once measured


# ---------------------------------------------------------------- track 3: protection, random drills, the Shield
# The endpoints and rules: docs/full-app/protection.md.


class ProtectionMemberView(BaseModel):
    member_id: str
    name: str
    eligible: bool  # random and surprise drills may pick them
    reason_if_not: str | None = None  # plain words, e.g. "Drills are paused."
    paused: bool
    next_drill_at: str | None = None  # their next scheduled practice, of any source
    drills_last_7_days: int  # practice calls (not shield calls) that rang in the last 7 days


class ProtectionView(BaseModel):
    family_id: str
    enabled: bool  # random drills
    drills_per_week: int
    window_start_hour: int  # local hour, inclusive
    window_end_hour: int  # local hour, exclusive (24 is midnight)
    timezone: str
    shield_enabled: bool
    updated_at: str | None = None  # None: never changed (the defaults)
    members: list[ProtectionMemberView]


class ProtectionUpdate(BaseModel):
    """Every field optional; a missing or null field keeps its value."""

    enabled: bool | None = None
    drills_per_week: int | None = Field(default=None, ge=1, le=7)
    window_start_hour: int | None = Field(default=None, ge=0, le=23)
    window_end_hour: int | None = Field(default=None, ge=1, le=24)
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    shield_enabled: bool | None = None


class DrillPause(BaseModel):
    paused: bool


class SurpriseDrillRequest(BaseModel):
    member_id: str | None = None  # None: a random eligible member
    within_seconds: int = Field(default=60, ge=20, le=300)


class SurpriseDrillCreated(BaseModel):
    call_id: str
    member: PersonRef
    scenario: ScenarioKey
    scheduled_for: str


class ShieldCallRequest(BaseModel):
    member_id: str
    voice_member_id: str | None = None  # None: a random other member's ready voice, if any
    scenario: ScenarioKey | None = None  # None: relative_new_number, or bank_security without a voice


class ShieldCallCreated(BaseModel):
    call_id: str
    member: PersonRef
    scenario: ScenarioKey


class CallBackContact(BaseModel):
    """Whom the Shield tells the person to call back."""

    member_id: str
    name: str
    phone_number: str | None = None  # from member_joins, when the join stored one


class ShieldState(BaseModel):
    """phone-state's `shield`: the live warning during a shield call."""

    call_id: str
    level: RiskLevel
    reason: str
    signals: list[RiskSignal] = []
    labels: list[str]
    warn: bool
    message: str | None = None  # the warning, from code; None while warn is false
    call_back: CallBackContact | None = None


class CallShieldView(BaseModel):
    """GET /api/calls/{id}'s `shield`, for a laptop without the live stream."""

    alerted: int  # family members alerted; 0 until the alert
    alerted_at: str | None = None
    alert_level: RiskLevel | None = None


class AlertRequest(BaseModel):
    claimed_member_id: str | None = None  # the relative the caller pretends to be, if known


class AlertSent(BaseModel):
    alerted: int  # how many family members got the alert


PhoneState.model_rebuild()
CallView.model_rebuild()


# ---------------------------------------------------------------- track 4: review, activity, progress, learning, news
# Read-only screens (routers/review.py; docs/full-app/review.md). Status and
# scenario are plain strings here, so a status or scenario another track adds
# never breaks these lists.


class TacticRef(BaseModel):
    key: str  # a tactic key (or, in learning, a risk signal key)
    label: str


class DrillView(BaseModel):
    """One practice call for the review screen. The full replay is GET /api/calls/{id}."""

    call_id: str
    member: PersonRef  # who was called
    voice_of: PersonRef | None  # whose clone spoke; None for a library voice
    scenario: str | None
    scenario_title: str | None
    difficulty: int
    status: str  # a call status
    created_at: str
    scheduled_for: str | None
    answered_at: str | None
    ended_at: str | None
    outcome: Outcome | None  # None until the drill is scored with a result
    outcome_label: str | None
    safe: bool  # asked the family word, hung up, or asked a personal question
    seconds_to_challenge: float | None
    peak_risk_level: RiskLevel | None  # the highest live risk level, or None without a risk check
    tactics: list[TacticRef]
    lesson: str | None
    callback_seconds: float | None  # practice end to the family-number tap
    shield: bool = False  # a Shield demo call (a simulated scam call), not a training drill


class DrillList(BaseModel):
    drills: list[DrillView]  # newest first


ActivityKind = Literal[
    "joined", "consent_given", "consent_withdrawn", "voice_consent", "voice_ready", "welcome_done",
    "drill", "drill_unanswered", "family_line", "alert", "weekly_note", "reminder", "message", "opted_out",
]


class ActivityItem(BaseModel):
    when: str  # ISO time
    member: PersonRef | None  # who did it (for a message, who got it); None for a family-wide item
    kind: ActivityKind
    text: str  # kind words: what the person did, never "failed"
    call_id: str | None = None  # the practice call to open, when there is one


class ActivityView(BaseModel):
    items: list[ActivityItem]  # newest first


class DrillStats(BaseModel):
    total: int  # drills with a result
    safe: int  # of those, the safe ones
    last_outcome: Outcome | None
    last_outcome_label: str | None
    safe_streak: int  # safe results in a row, counting back from the latest


class LessonView(BaseModel):
    call_id: str
    when: str
    outcome: Outcome
    outcome_label: str
    lesson: str


class ProgressView(BaseModel):
    member: PersonRef
    readiness: ReadinessView
    drills: DrillStats
    lessons: list[LessonView]  # newest first
    weak_spot: str | None
    next_drill_at: str | None  # the next scheduled drill; for the organiser's screen, never the member's own


class LearnTactic(BaseModel):
    key: RiskSignal
    label: str
    kind: Literal["tactic", "signal"]  # one of the eight tactics, or one of the three extra risk signals
    level: Literal["yellow", "red"]  # the live risk light this sign alone gives
    what_it_sounds_like: list[Annotated[str, Field(min_length=1)]] = Field(min_length=1)  # two short example lines
    why_it_works: str = Field(min_length=1)
    what_to_do: str = Field(min_length=1)


class LearnTactics(BaseModel):
    tactics: list[LearnTactic]


class Habit(BaseModel):
    key: str = Field(min_length=1)
    title: str = Field(min_length=1)
    line: str = Field(min_length=1)


class Habits(BaseModel):
    habits: list[Habit]


class NewsSource(BaseModel):
    url: str
    date: str | None  # YYYY-MM-DD: the day Callback read the page; None on a fallback row (not known)


class NewsPattern(BaseModel):
    title: str
    summary: str
    tactics: list[TacticRef]
    closest_scenario: str | None
    sources: list[NewsSource]  # empty for the built-in examples


class NewsNote(BaseModel):
    member: PersonRef
    text: str
    when: str


class NewsView(BaseModel):
    patterns: list[NewsPattern]
    updated_at: str | None  # when the digest was built; None when there is none
    week: str | None  # e.g. "2026-W46"
    fallback: bool  # not this week's news: the built-in examples, or a digest from an earlier week
    notes: list[NewsNote]  # each member's latest weekly note
    next_refresh_at: str | None  # when a refresh may build again (shared by all families); None: now


class NewsRefreshed(NewsView):
    refreshed: bool  # True: a new digest was built now
    reason: Literal["too_soon", "fresh", "no_new_digest", "failed"] | None = None


# ---------------------------------------------------------------- adding a person later (Saturday)

MAX_FAMILY_MEMBERS = 12  # the same limit as at sign-up


class MemberAdd(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    relationship: str = Field(min_length=1, max_length=40)


class MemberAdded(BaseModel):
    id: str
    name: str
    relationship: str
    invite_link: str  # /join/{id}: open it on their phone to join
    phone_link: str
