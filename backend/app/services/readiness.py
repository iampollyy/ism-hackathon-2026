"""The readiness scale and how practice moves it (ai.md). OWNER: track C."""

# ai.md: "Tapped the family number within a minute: trusted_contact becomes 2".
CALLBACK_WITHIN_SECONDS = 60.0


def apply_result(scores: dict[str, int], outcome: str, seconds_to_challenge: float | None,
                 callback_seconds: float | None) -> dict[str, int]:
    """Return new item scores (keys from schemas.READINESS_KEYS, 0 to 2)
    after one practice result, following ai.md's table, including the
    family-number row (apply_callback). Pure function.
    OWNER: track C."""
    raise NotImplementedError


def apply_callback(scores: dict[str, int], callback_seconds: float | None) -> dict[str, int]:
    """Return new item scores after the family number was tapped:
    trusted_contact becomes 2 when callback_seconds is set and at most 60;
    otherwise the scores are unchanged. Pure function, returns a new dict.
    Used by apply_result and by phone.family_line (track B) when the
    practice's result already exists. Written by the foundation so track B
    does not wait on track C; track C may refine it but keeps the signature."""
    new_scores = dict(scores)
    if callback_seconds is not None and 0 <= callback_seconds <= CALLBACK_WITHIN_SECONDS:
        new_scores["trusted_contact"] = 2
    return new_scores
