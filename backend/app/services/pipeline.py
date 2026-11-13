"""What happens after a call ends (backend.md flow 5). OWNER: track C."""


async def after_call(call_id: str) -> None:
    """Run in the background after a call ends (started with
    services.run_in_background). Opens its own DB session (db.new_session()).

    Welcome call: transcript from stored `turn` events, profiler, a
    readiness snapshot ("before"), planner for the family, status scored.
    Practice call: transcript, outcome.decide_outcome, scorer, a results row
    (copy calls.callback_seconds into it), readiness update and snapshot
    ("now"), planner for this member, publish `result` (lesson, debrief,
    outcome, seconds_to_challenge), status scored.
    Family-line call: nothing to score.
    Then, without blocking scoring, poll elevenlabs.get_conversation every two
    seconds for up to a minute and keep the transcript as the record.
    Never raises; logs failures. OWNER: track C."""
    raise NotImplementedError
