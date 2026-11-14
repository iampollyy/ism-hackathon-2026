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
MessageKind = Literal["weekly", "callback_notice", "reminder"]
ConsentKind = Literal["clone", "practice", "practice_withdrawn", "opt_out"]
ConsentSource = Literal["voice_recording", "welcome_call", "manual"]
ReadinessKey = Literal["verify_first", "safe_word", "trusted_contact", "payment_caution", "under_pressure"]
EventType = Literal[
    "call.status", "turn", "tactic", "outcome", "revealed", "callback.connected", "result", "consent",
    "risk",
    "voice_consent",  # track 2: the welcome agent's voice_consent_result
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


class FamilyReadinessView(BaseModel):
    before: int
    now: int
    max: int


class FamilyNumber(BaseModel):
    enabled: bool


class WeekItem(BaseModel):
    kind: Literal["welcome", "practice", "family_line", "message", "reminder", "weekly"]
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
    result: CallResultView | None  # None until the call is scored
    callback_seconds: float | None
    answered_at: str | None = None
    ended_at: str | None = None
    ended_by: EndedBy | None = None


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
