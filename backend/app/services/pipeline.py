"""What happens after a call ends (backend.md flow 5). OWNER: track C."""


async def after_call(call_id: str) -> None:
    """Run in the background after a call ends (started with
    services.run_in_background). Opens its own DB session (db.new_session()).

    Welcome call: transcript from stored `turn` events, profiler, a
    readiness snapshot ("before"), planner for the family, status scored.
    Practice call: transcript, outcome.decide_outcome, scorer, a results row,
    readiness update and snapshot ("now"), planner for this member, publish
    `result` (lesson, debrief, outcome, seconds_to_challenge), status scored.
    Family-line call: nothing to score.
    Then, without blocking scoring, poll elevenlabs.get_conversation every two
    seconds for up to a minute and keep the transcript as the record.

    Commit (or roll back) before every await of a model or network call;
    never hold uncommitted writes across an await (db.py, "Hard rule").

    The family number is often tapped while scoring runs. So, after the
    scorer returns and with NO await in between: re-read the call
    (db.refresh(call)), copy calls.callback_seconds into the results row,
    compute readiness with readiness.apply_result(..., callback_seconds)
    (which also applies the "tapped within a minute" rule), write the
    snapshot, and commit, all in one transaction. A tap after that commit is
    handled by phone.family_line (it updates the result and readiness).
    Never raises; logs failures. OWNER: track C."""
    raise NotImplementedError
