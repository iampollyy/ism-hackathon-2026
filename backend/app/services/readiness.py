"""The readiness scale and how practice moves it (ai.md). OWNER: track C."""


def apply_result(scores: dict[str, int], outcome: str, seconds_to_challenge: float | None,
                 callback_seconds: float | None) -> dict[str, int]:
    """Return new item scores (keys from schemas.READINESS_KEYS, 0 to 2)
    after one practice result, following ai.md's table. Pure function.
    OWNER: track C."""
    raise NotImplementedError
