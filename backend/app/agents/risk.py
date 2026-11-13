"""Risk job: the live risk check on a practice call. OWNER: track C.

"Judge what the caller says, not how they sound." While a practice call goes
on, a fast model reads the turns so far and names the warning signals in the
caller's lines, from a fixed list (schemas.RISK_SIGNALS: the eight tactics,
plus money_request, asks_for_code and refuses_callback), with a few words of
reason for the laptop. It sees only the turn texts, never the `tactic` events
the practice agent marks, so its agreement with those marks is a fair
measure (scripts/eval_risk.py).

Numbers come from code: the level is set by rule from the signals.
- green: no signals;
- yellow: softer pressure only (new_number, urgency, authority,
  emotional_appeal, small_ask_first);
- red: any of RED_SIGNALS (money_request, unusual_payment, asks_for_code,
  refuses_callback, secrecy, isolation).
Nothing is taken back within a call: each check's signals are added to the
previous check's, and the level never goes down.

Fallback (no model key, both models too slow, a refusal): keywords and
phrases in the caller's lines (FALLBACK_PATTERNS), in code; source is then
"fallback". The reason is then built from fixed phrases.

When to run it, and storing the result as a `risk` event, is
services/live_risk.py's job.
"""

import asyncio
import logging
import re
from typing import Any

from app.agents import llm
from app.agents.shapes import RiskCheck
from app.schemas import RISK_LEVELS, RISK_SIGNAL_LABELS, RISK_SIGNALS

log = logging.getLogger("app.agents.risk")

JOB = "risk"
PROMPT_VERSION = "risk.v1"
FALLBACK_VERSION = "fallback"
CALLER = "agent"  # the `speaker` of the caller's lines: the practice agent plays the caller
# Both models together (each has llm.JOB_SECONDS["risk"]): the light must keep up with the call.
TOTAL_SECONDS = 5.0
MAX_TOKENS = 2000
REASON_WORDS = 8
GREEN_REASON = "Nothing worrying yet"

# Money, secrecy, a code, or dodging a check: red at once. Every other signal is softer pressure.
RED_SIGNALS = frozenset({
    "money_request", "unusual_payment", "asks_for_code", "refuses_callback", "secrecy", "isolation",
})

# The fallback's reason: the two strongest signals, in this order, as "Caller <a> and <b>".
REASON_ORDER = (
    "asks_for_code", "money_request", "unusual_payment", "refuses_callback", "secrecy", "isolation",
    "urgency", "authority", "new_number", "emotional_appeal", "small_ask_first",
)
REASON_PHRASES: dict[str, str] = {
    "asks_for_code": "asks for a code",
    "money_request": "asks for money",
    "unusual_payment": "wants an odd payment",
    "refuses_callback": "avoids a call-back",
    "secrecy": "wants it kept secret",
    "isolation": "says not to call anyone",
    "urgency": "rushes you",
    "authority": "claims to be official",
    "new_number": "calls from a new number",
    "emotional_appeal": "plays on your feelings",
    "small_ask_first": "starts with a small ask",
}

# ---------------------------------------------------------------- the fallback's keywords

_NOT = r"(?:don'?t|do not|must not|mustn'?t|never|no need to|you shouldn'?t)"
_PATTERNS: dict[str, tuple[str, ...]] = {
    "new_number": (
        r"\bnew (?:phone )?number\b",
        r"\b(?:new|borrowed|friend'?s|colleague'?s|mate'?s|someone'?s) phone\b",
        r"\b(?:dropped|broke|lost|smashed|cracked) (?:my )?phone\b",
        r"\bphone (?:is |got )?(?:broken|smashed|dead|stolen)\b",
        r"\b(?:old|usual|normal) number (?:doesn'?t|does not|isn'?t|won'?t)\b",
    ),
    "urgency": (
        r"\btoday\b", r"\btonight\b", r"\bright now\b", r"\bimmediately\b", r"\burgent(?:ly)?\b",
        r"\bstraight away\b", r"\bas soon as (?:possible|you can)\b", r"\bhurry\b", r"\bno time\b",
        r"\bbefore (?:it'?s too late|the payment goes through|it goes through)\b",
        r"\bin the next (?:few )?(?:minutes?|hours?)\b",
        r"\b(?:read|send|do|pay) (?:it |this |that )?(?:out )?(?:to me )?now\b",
    ),
    "secrecy": (
        rf"\b{_NOT} (?:tell|mention|say anything|discuss (?:this|it))\b",
        r"\bkeep (?:this|it) (?:between us|quiet|secret|to yourself)\b",
        r"\bbetween (?:you and me|us)\b", r"\b(?:it'?s|this is) (?:a )?secret\b", r"\bconfidential\b",
        r"\b(?:no one|nobody) (?:else )?(?:can|must|should|needs to) know\b",
    ),
    "authority": (
        r"\b(?:police|officer|detective|constable|inspector)\b",
        r"\bsecurity (?:team|department|officer)\b",
        r"\bfraud (?:team|department|unit|squad|investigat\w*)\b",
        r"\b(?:this is|calling from|i'?m from|we'?re from|i'?m calling from) (?:your|the) bank\b",
        r"\byour bank'?s\b", r"\b(?:tax office|tax authority|court|government|customs)\b",
    ),
    "emotional_appeal": (
        r"\b(?:awful|terrible|horrible) (?:morning|day|night|week|time)\b",
        r"\bi'?m (?:so |really |just )?(?:scared|frightened|stressed|desperate|panicking|terrified|upset)\b",
        r"\b(?:so|really|just) (?:stressed|scared|desperate|upset)\b",
        r"\bi (?:really )?need your help\b", r"\bplease help\b", r"\byou'?re (?:the )?only one\b",
        r"\bi'?m in (?:trouble|a mess)\b", r"\bbegging\b", r"\bcrying\b",
        r"\blose (?:my|the|our) (?:flat|home|house|job)\b",
    ),
    "small_ask_first": (
        r"\bjust (?:need|want) (?:to|you to) (?:confirm|verify|check)\b",
        r"\b(?:only |just )?takes? a (?:second|moment|minute)\b",
        r"\b(?:quick|small|simple) (?:check|question|favour|favor|thing)\b",
        r"\bjust (?:a|one) (?:small|quick|little)\b",
        r"\bconfirm (?:that )?it'?s (?:really )?you\b", r"\bverify (?:you|your identity|it'?s you)\b",
    ),
    "isolation": (
        rf"\b{_NOT} (?:call|ring|phone|contact|speak to|talk to|check with|text|involve) "
        r"(?:anyone|anybody|your (?:bank|family|son|daughter|husband|wife)|the (?:bank|police))\b",
    ),
    "unusual_payment": (
        r"\bgift ?cards?\b", r"\bvouchers?\b", r"\b(?:itunes|google play|steam|amazon) (?:cards?|codes?)\b",
        r"\bbitcoin\b", r"\bcrypto\w*\b", r"\bcourier\b", r"\bcash\b", r"\b(?:western union|moneygram)\b",
        r"\b(?:friend|colleague|mate|cousin|landlord)'?s (?:bank )?account\b",
        r"\b(?:another|a different|a new|a safe|a secure|someone else'?s) (?:bank )?account\b",
    ),
    "money_request": (
        r"\b(?:can|could|would|will) you (?:please )?(?:send|transfer|wire|lend|pay|give|move|cover)\b",
        r"\b(?:send|transfer|wire|lend) (?:me|us)\b",
        r"\b(?:need|want) (?:some |the |a bit of )?(?:money|cash|a loan|a transfer)\b",
        r"\b(?:need|have|had|got) to pay\b", r"\bmake a (?:payment|transfer)\b",
        r"\bmove (?:your|the) money\b",
    ),
    "asks_for_code": (
        r"\b(?:code|codes|pin|passcode|password|otp)\b",
        r"\b(?:card|account|bank|login|log-in|security) (?:number|details)\b", r"\bsort code\b",
    ),
    "refuses_callback": (
        rf"\b{_NOT} (?:hang up|put the phone down)\b", r"\bstay on the line\b",
        rf"\b{_NOT} (?:call|ring|phone) (?:me |us )?back\b",
        r"\b(?:can'?t|cannot|won'?t be able to) (?:call|ring|reach) me\b",
        r"\bno time for (?:that|this|questions|games)\b",
        r"\b(?:forget|never mind)(?: about)? (?:the|our) (?:family )?(?:word|password|question)\b",
    ),
}
FALLBACK_PATTERNS: dict[str, tuple[re.Pattern[str], ...]] = {
    signal: tuple(re.compile(pattern, re.IGNORECASE) for pattern in patterns)
    for signal, patterns in _PATTERNS.items()
}


# ---------------------------------------------------------------- rules


def signal_list(values: Any) -> list[str]:
    """Known signal keys only, no repeats, order kept."""
    result: list[str] = []
    for key in values or []:
        if key in RISK_SIGNALS and key not in result:
            result.append(key)
    return result


def level_for(signals: Any) -> str:
    """green with no signals, red with any of RED_SIGNALS, otherwise yellow."""
    keys = signal_list(signals)
    if not keys:
        return "green"
    return "red" if any(key in RED_SIGNALS for key in keys) else "yellow"


def _rank(level: Any) -> int:
    return RISK_LEVELS.index(level) if level in RISK_LEVELS else 0


def higher_level(*levels: Any) -> str:
    """The highest of the given levels; anything unknown counts as green."""
    return RISK_LEVELS[max((_rank(level) for level in levels), default=0)]


def caller_turn_index(turns: list[dict[str, Any]]) -> int | None:
    """The index of the last caller line, or None if the caller has not spoken."""
    for index in range(len(turns) - 1, -1, -1):
        if turns[index].get("speaker") == CALLER:
            return index
    return None


def fallback_reason(signals: list[str]) -> str:
    """'Caller <a> and <b>' from the two strongest signals; GREEN_REASON with none."""
    strongest = sorted(signal_list(signals), key=REASON_ORDER.index)[:2]
    if not strongest:
        return GREEN_REASON
    return "Caller " + " and ".join(REASON_PHRASES[key] for key in strongest)


def clean_reason(reason: Any) -> str | None:
    """The model's reason on one line, without quotes or a full stop; None if
    empty or far too long for the screen."""
    text = " ".join(str(reason or "").split()).strip("\"'“”‘’ ").rstrip(".").strip()
    if not text or len(text.split()) > REASON_WORDS + 4:  # a little slack over the prompt's limit
        return None
    return text


def combine(previous: dict[str, Any] | None, signals: Any, reason: str | None, source: str,
            turn_index: int) -> dict[str, Any]:
    """The `risk` event data: this check's signals added to the previous
    check's, and a level that never goes below the previous one. The new
    reason is kept only if this check alone explains the level; otherwise
    the previous reason stays (or the fallback's phrases)."""
    previous = previous or {}
    before = signal_list(previous.get("signals"))
    new = signal_list(signals)
    merged = before + [key for key in new if key not in before]
    level = higher_level(previous.get("level"), level_for(merged))
    if not merged:
        reason = GREEN_REASON
    elif reason is None or (new and reason.lower() == GREEN_REASON.lower()):
        reason = fallback_reason(merged)
    elif _rank(level_for(new)) < _rank(level):
        reason = previous.get("reason") or fallback_reason(merged)
    return {
        "level": level,
        "signals": merged,
        "labels": [RISK_SIGNAL_LABELS[key] for key in merged],
        "reason": reason,
        "turn_index": turn_index,
        "source": source,
    }


# ---------------------------------------------------------------- the fallback


def fallback_signals(turns: list[dict[str, Any]]) -> list[str]:
    """The signals whose keywords appear in the caller's lines, first seen first."""
    found: list[str] = []
    for turn in turns:
        if turn.get("speaker") != CALLER:
            continue
        text = " ".join(str(turn.get("text") or "").replace("’", "'").split())
        for signal, patterns in FALLBACK_PATTERNS.items():
            if signal not in found and any(pattern.search(text) for pattern in patterns):
                found.append(signal)
    return found


def fallback_check(turns: list[dict[str, Any]], previous: dict[str, Any] | None = None) -> dict[str, Any]:
    """The check in code alone: keywords in the caller's lines so far."""
    index = caller_turn_index(turns)
    return combine(previous, fallback_signals(turns), None, FALLBACK_VERSION,
                   -1 if index is None else index)


# ---------------------------------------------------------------- the model


def transcript(turns: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for turn in turns:
        text = " ".join(str(turn.get("text") or "").split())
        if text:
            lines.append(f"{'Caller' if turn.get('speaker') == CALLER else 'Person'}: {text}")
    return "\n".join(lines)


def _user_message(turns: list[dict[str, Any]]) -> str:
    return f"<transcript>\n{transcript(turns)}\n</transcript>"


async def check_risk(turns: list[dict[str, Any]], previous: dict[str, Any] | None = None) -> dict[str, Any]:
    """Check the practice call so far and return the `risk` event data:
    {level, signals, labels, reason, turn_index, source}.

    turns: the call's turns so far, in order, as [{speaker, text}]
      (speaker "agent" is the caller, "user" the person).
    previous: the last check's data for this call, or None; its signals are
      kept and its level is the floor.
    turn_index is the index in `turns` of the last caller line (-1 if none).
    source is PROMPT_VERSION, or "fallback" when the model had no key,
    was too slow (llm.JOB_SECONDS each, TOTAL_SECONDS in all) or refused.
    Never raises (cancellation still propagates). OWNER: track C."""
    try:
        index = caller_turn_index(turns)
        if index is not None:
            result = await asyncio.wait_for(llm.run_job(
                JOB,
                system=llm.load_prompt(JOB),
                user=_user_message(turns),
                schema=RiskCheck,
                prompt_version=PROMPT_VERSION,
                max_tokens=MAX_TOKENS,
            ), TOTAL_SECONDS)
            if isinstance(result, RiskCheck):
                return combine(previous, result.signals, clean_reason(result.reason), PROMPT_VERSION, index)
    except TimeoutError:
        log.warning("risk check took over %s s; using the fallback", TOTAL_SECONDS)
    except Exception:
        log.exception("risk check failed; using the fallback")
    return fallback_check(turns, previous)
