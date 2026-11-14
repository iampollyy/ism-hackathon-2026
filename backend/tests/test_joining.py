"""Track 1: the invite page (GET/POST /api/join/{id}), the joined fields in
the family view, and the welcome call that starts by itself on a joined
member's phone-state poll."""

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.db import new_session, now_iso
from app.models import Call, Consent, FamilyOwner, Member, MemberJoin
from app.routers import calls
from app.services import joining


def members(family) -> tuple[str, str]:
    return family["members"][0]["id"], family["members"][1]["id"]


def join(client, member_id: str, practice: bool = True, clone: bool = True, phone=None):
    body = {"consent_practice": practice, "consent_clone_from_call": clone}
    if phone is not None:
        body["phone_number"] = phone
    return client.post(f"/api/join/{member_id}", json=body)


def consent_rows(member_id: str) -> list[tuple[str, str]]:
    with new_session() as db:
        rows = db.scalars(select(Consent).where(Consent.member_id == member_id).order_by(Consent.id))
        return [(row.kind, row.source) for row in rows]


def update_member(member_id: str, **fields) -> None:
    with new_session() as db:
        member = db.get(Member, member_id)
        for name, value in fields.items():
            setattr(member, name, value)
        db.commit()


def welcome_calls(member_id: str) -> list[Call]:
    with new_session() as db:
        return list(db.scalars(select(Call).where(Call.target_member_id == member_id, Call.kind == "welcome")
                               .order_by(Call.created_at)))


def set_status(call_id: str, status: str) -> None:
    with new_session() as db:
        db.get(Call, call_id).status = status
        db.commit()


def error_code(response) -> str:
    return response.json()["error"]["code"]


# ---------------------------------------------------------------- the invite page


def test_invite_page_before_joining(client, make_family):
    family = make_family(consent=False)
    sara, _ = members(family)
    response = client.get(f"/api/join/{sara}")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "family": {"name": "The Kovacs", "safe_word_set": True},  # never the family id
        "organiser": {"name": "Jon"},  # the organiser member, when no account owns the family
        "member": {"id": sara, "name": "Sara", "relationship": "mother"},
        "joined": False,
        "joined_at": None,
        "phone_number": None,
        "opted_out": False,
        "consents": {"practice": False, "clone_from_call": False},
        "phone_link": f"/phone/{sara}",
    }


def test_invite_page_never_shows_the_family_id(client, make_family):
    family = make_family()
    sara, _ = members(family)
    join(client, sara, phone="+49 151 2345678")
    for response in (client.get(f"/api/join/{sara}"), join(client, sara)):
        assert response.status_code == 200
        assert family["family_id"] not in response.text


def test_invite_page_names_the_account_that_made_the_family(client):
    client.post("/api/auth/register", json={"name": "Jonathan K", "email": "jon@example.com",
                                            "password": "correct horse"})
    family = client.post("/api/families", json={"name": "The Kovacs", "members": [
        {"name": "Sara", "relationship": "mother"}]}).json()
    with new_session() as db:
        assert db.get(FamilyOwner, family["family_id"]) is not None
    sara = family["members"][0]["id"]
    assert client.get(f"/api/join/{sara}").json()["organiser"] == {"name": "Jonathan K"}


def test_invite_page_without_an_organiser(client):
    family = client.post("/api/families", json={"name": "The Kovacs", "members": [
        {"name": "Sara", "relationship": "mother"}]}).json()
    assert client.get(f"/api/join/{family['members'][0]['id']}").json()["organiser"] is None


def test_unknown_member_is_404(client):
    assert error_code(client.get("/api/join/mem_nope")) == "not_found"
    response = join(client, "mem_nope")
    assert (response.status_code, error_code(response)) == (404, "not_found")


# ---------------------------------------------------------------- joining


def test_join_records_the_ticks_and_the_phone(client, make_family):
    family = make_family(consent=False)
    sara, _ = members(family)
    response = join(client, sara, practice=True, clone=True, phone=" +49 151 2345678 ")
    assert response.status_code == 200, response.text
    assert response.json() == {"phone_link": f"/phone/{sara}"}

    assert consent_rows(sara) == [("practice", "invite"), ("clone_from_call", "invite")]
    with new_session() as db:
        member = db.get(Member, sara)
        assert member.consent_practice_at is not None  # like the sign-up tick
        row = db.get(MemberJoin, sara)
        assert row.joined_at and row.phone_number == "+49 151 2345678"
        assert joining.clone_from_call_given(db, member)

    page = client.get(f"/api/join/{sara}").json()
    assert page["joined"] is True and page["joined_at"] == row.joined_at
    assert page["phone_number"] == "+49 151 2345678"
    assert page["consents"] == {"practice": True, "clone_from_call": True}


def test_the_practice_tick_passes_the_consent_gate(client, make_family):
    sara, _ = members(make_family(consent=False))
    join(client, sara, practice=True, clone=False)
    with new_session() as db:
        target, _ = calls.check_practice_gate(db, sara, None, check_phone_online=False)
    assert target.id == sara


def test_first_join_writes_the_members_own_tick_even_after_the_sign_up_tick(client, make_family):
    sara, _ = members(make_family(consent=True))
    with new_session() as db:
        before = db.get(Member, sara).consent_practice_at
    join(client, sara, practice=True, clone=False)
    assert consent_rows(sara) == [("practice", "manual"), ("practice", "invite")]
    with new_session() as db:
        assert db.get(Member, sara).consent_practice_at == before  # kept, not moved


def test_no_practice_tick_withdraws_the_sign_up_tick(client, make_family):
    sara, _ = members(make_family(consent=True))
    join(client, sara, practice=False, clone=False)
    assert consent_rows(sara) == [("practice", "manual"), ("practice_withdrawn", "invite")]
    with new_session() as db:
        assert db.get(Member, sara).consent_practice_at is None
    assert client.get(f"/api/join/{sara}").json()["consents"] == {"practice": False, "clone_from_call": False}


def test_no_ticks_and_nothing_to_withdraw_write_nothing(client, make_family):
    sara, _ = members(make_family(consent=False))
    assert join(client, sara, practice=False, clone=False).status_code == 200
    assert consent_rows(sara) == []
    with new_session() as db:
        assert db.get(MemberJoin, sara) is not None


def test_joining_again_updates(client, make_family):
    sara, _ = members(make_family(consent=False))
    join(client, sara, practice=True, clone=True, phone="0151 234567")
    with new_session() as db:
        first_joined_at = db.get(MemberJoin, sara).joined_at

    # the same answers again: no new rows; a new phone number
    join(client, sara, practice=True, clone=True, phone="+44 7700 900123")
    assert consent_rows(sara) == [("practice", "invite"), ("clone_from_call", "invite")]
    with new_session() as db:
        row = db.get(MemberJoin, sara)
        assert row.joined_at == first_joined_at and row.phone_number == "+44 7700 900123"

    # both ticks taken away
    join(client, sara, practice=False, clone=False)
    assert consent_rows(sara)[2:] == [("practice_withdrawn", "invite"), ("clone_from_call_withdrawn", "invite")]
    page = client.get(f"/api/join/{sara}").json()
    assert page["consents"] == {"practice": False, "clone_from_call": False}
    assert page["phone_number"] is None  # no number this time

    # and given again
    join(client, sara, practice=True, clone=True)
    assert consent_rows(sara)[4:] == [("practice", "invite"), ("clone_from_call", "invite")]
    assert client.get(f"/api/join/{sara}").json()["consents"] == {"practice": True, "clone_from_call": True}


@pytest.mark.parametrize("phone", ["+49 151 2345678", "0151234567", "123456", "+1 202 555 0123"])
def test_phone_numbers_that_pass(client, make_family, phone):
    sara, _ = members(make_family())
    assert join(client, sara, phone=phone).status_code == 200


@pytest.mark.parametrize("phone", ["abc", "12345", "+", "+ 123456", "12-34-56", "1" * 21, "(030) 123456",
                                   "+49 151 2345678 99999"])  # the last is 21 characters
def test_phone_numbers_that_fail(client, make_family, phone):
    sara, _ = members(make_family())
    response = join(client, sara, phone=phone)
    assert (response.status_code, error_code(response)) == (422, "invalid_request")
    with new_session() as db:
        assert db.get(MemberJoin, sara) is None


def test_an_empty_or_missing_phone_number_is_none(client, make_family):
    sara, jon = members(make_family())
    join(client, sara, phone="   ")
    join(client, jon)
    with new_session() as db:
        assert db.get(MemberJoin, sara).phone_number is None
        assert db.get(MemberJoin, jon).phone_number is None


def test_an_opted_out_member_cannot_join(client, make_family):
    sara, _ = members(make_family())
    update_member(sara, opted_out_at=now_iso())
    response = join(client, sara)
    assert (response.status_code, error_code(response)) == (409, "opted_out")
    page = client.get(f"/api/join/{sara}").json()
    assert page["opted_out"] is True and page["joined"] is False
    assert page["consents"] == {"practice": False, "clone_from_call": False}
    with new_session() as db:
        assert db.get(MemberJoin, sara) is None


def test_clone_from_call_is_false_after_opting_out(client, make_family):
    sara, _ = members(make_family())
    join(client, sara, clone=True)
    update_member(sara, opted_out_at=now_iso())
    with new_session() as db:
        assert joining.clone_from_call_given(db, db.get(Member, sara)) is False


# ---------------------------------------------------------------- the family view


def test_family_view_shows_who_joined(client, make_family):
    family = make_family()
    sara, jon = members(family)
    join(client, sara, phone="+49 151 2345678")
    view = client.get(f"/api/families/{family['family_id']}").json()
    by_id = {member["id"]: member for member in view["members"]}
    assert by_id[sara]["joined"] is True and by_id[sara]["joined_at"]
    assert by_id[sara]["phone_number"] == "+49 151 2345678"
    assert by_id[sara]["invite_link"] == f"/join/{sara}"
    assert (by_id[jon]["joined"], by_id[jon]["joined_at"], by_id[jon]["phone_number"]) == (False, None, None)
    # the existing fields are unchanged
    assert by_id[sara]["phone_link"] == f"/phone/{sara}"
    # clone is True: Sara ticked "may copy my voice" when she joined (consent.clone now follows that tick)
    assert by_id[sara]["consent"] == {"clone": True, "practice": True}


def owned_family(client) -> tuple[str, str, str]:
    """A family made while logged in, with Sara joined (with a phone number).
    Returns (family_id, sara, jon); the client is still logged in."""
    client.post("/api/auth/register", json={"name": "Jon", "email": "jon@example.com", "password": "correct horse"})
    family = client.post("/api/families", json={"name": "The Kovacs", "members": [
        {"name": "Sara", "relationship": "mother", "consent_practice": True},
        {"name": "Jon", "relationship": "son", "is_organiser": True}]}).json()
    sara, jon = family["members"][0]["id"], family["members"][1]["id"]
    join(client, sara, phone="+49 151 2345678")
    return family["family_id"], sara, jon


def test_the_owner_sees_invite_links_and_phone_numbers(client):
    family_id, sara, _ = owned_family(client)
    by_id = {m["id"]: m for m in client.get(f"/api/families/{family_id}").json()["members"]}
    assert by_id[sara]["invite_link"] == f"/join/{sara}"
    assert by_id[sara]["phone_number"] == "+49 151 2345678"


def test_others_do_not_see_an_owned_familys_invite_links_and_phone_numbers(client):
    family_id, sara, _ = owned_family(client)
    client.post("/api/auth/logout")
    client.post("/api/auth/register", json={"name": "Ana", "email": "ana@example.com", "password": "correct horse"})
    for reader in ("another account", "nobody logged in"):
        if reader == "nobody logged in":
            client.post("/api/auth/logout")
        response = client.get(f"/api/families/{family_id}")
        # An owned family is now only readable by its organiser's account:
        # another account gets 404 and nobody logged in gets 401.
        assert response.status_code == (404 if reader == "another account" else 401), reader
        assert "+49 151" not in response.text, reader


def test_an_opted_out_members_phone_number_is_not_shown(client, make_family):
    family = make_family()
    sara, _ = members(family)
    join(client, sara, phone="+49 151 2345678")
    update_member(sara, opted_out_at=now_iso())
    by_id = {m["id"]: m for m in client.get(f"/api/families/{family['family_id']}").json()["members"]}
    assert by_id[sara]["joined"] is True
    assert by_id[sara]["phone_number"] is None


# ---------------------------------------------------------------- the welcome call starts by itself


def test_a_joined_members_first_poll_rings_the_welcome_call(client, make_family):
    sara, _ = members(make_family(consent=False))
    join(client, sara)
    assert welcome_calls(sara) == []  # joining alone does not ring; the open phone page does

    state = client.get(f"/api/members/{sara}/phone-state").json()
    [call] = welcome_calls(sara)
    assert call.status == "ringing" and call.caller_label == calls.WELCOME_CALLER_LABEL
    assert state["incoming_call"]["call_id"] == call.id and state["incoming_call"]["kind"] == "welcome"

    # later polls show the same call and start no other
    again = client.get(f"/api/members/{sara}/phone-state").json()
    assert again["incoming_call"]["call_id"] == call.id
    assert len(welcome_calls(sara)) == 1


@pytest.mark.parametrize("status", ["declined", "missed", "failed", "scored", "ended", "in_progress"])
def test_only_once_whatever_became_of_it(client, make_family, status):
    sara, _ = members(make_family())
    join(client, sara)
    client.get(f"/api/members/{sara}/phone-state")
    [call] = welcome_calls(sara)
    set_status(call.id, status)
    state = client.get(f"/api/members/{sara}/phone-state").json()
    assert state["incoming_call"] is None
    assert len(welcome_calls(sara)) == 1


def test_a_declined_auto_call_can_be_started_again_by_hand(client, make_family):
    sara, _ = members(make_family())
    join(client, sara)
    call_id = client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"]["call_id"]
    assert client.post(f"/api/calls/{call_id}/decline").status_code == 200
    assert client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"] is None
    response = client.post(f"/api/members/{sara}/welcome-call")
    assert response.status_code == 201
    assert client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"]["call_id"] == response.json()["call_id"]


def test_members_who_never_joined_are_not_called(client, make_family):
    sara, jon = members(make_family())
    for _ in range(2):
        assert client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"] is None
    assert welcome_calls(sara) == []


def test_a_member_who_already_had_a_welcome_call_is_not_called_again_on_joining(client, make_family):
    sara, _ = members(make_family())
    client.get(f"/api/members/{sara}/phone-state")
    call_id = client.post(f"/api/members/{sara}/welcome-call").json()["call_id"]
    set_status(call_id, "scored")
    join(client, sara)
    assert client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"] is None
    assert len(welcome_calls(sara)) == 1


def test_no_auto_call_after_opting_out(client, make_family):
    sara, _ = members(make_family())
    join(client, sara)
    update_member(sara, opted_out_at=now_iso())
    assert client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"] is None
    assert welcome_calls(sara) == []


def test_busy_waits_for_the_next_poll(client, make_family):
    family = make_family()
    sara, _ = members(family)
    join(client, sara)
    with new_session() as db:
        db.add(Call(id="call_practice1", family_id=family["family_id"], kind="practice", target_member_id=sara,
                    status="in_progress", difficulty=1, created_at=now_iso()))
        db.commit()
    assert client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"] is None
    assert welcome_calls(sara) == []
    set_status("call_practice1", "ended")
    state = client.get(f"/api/members/{sara}/phone-state").json()
    assert state["incoming_call"]["kind"] == "welcome"


def test_the_daily_call_cap_applies(client, make_family, monkeypatch):
    family = make_family()
    sara, _ = members(family)
    join(client, sara)
    with new_session() as db:
        db.add(Call(id="call_earlier", family_id=family["family_id"], kind="practice", target_member_id=sara,
                    status="scored", difficulty=1, created_at=now_iso()))
        db.commit()
    monkeypatch.setenv("DAILY_CALL_LIMIT", "1")
    get_settings.cache_clear()
    response = client.get(f"/api/members/{sara}/phone-state")
    assert response.status_code == 200 and response.json()["incoming_call"] is None
    assert welcome_calls(sara) == []

    monkeypatch.setenv("DAILY_CALL_LIMIT", "2")
    get_settings.cache_clear()
    assert client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"]["kind"] == "welcome"


def test_the_setting_switches_it_off(client, make_family, monkeypatch):
    sara, _ = members(make_family())
    join(client, sara)
    monkeypatch.setenv("AUTO_WELCOME_CALL", "false")
    get_settings.cache_clear()
    assert client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"] is None
    assert welcome_calls(sara) == []


def test_a_failure_never_breaks_the_poll(client, make_family, monkeypatch):
    sara, _ = members(make_family())
    join(client, sara)

    def broken(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(calls, "start_welcome_call", broken)
    response = client.get(f"/api/members/{sara}/phone-state")
    assert response.status_code == 200 and response.json()["incoming_call"] is None
    with new_session() as db:
        assert db.get(Member, sara).last_seen_at is not None  # the poll itself was recorded


def test_the_auto_call_is_a_normal_welcome_call(client, make_family, monkeypatch):
    """It can be answered like one started by hand (the session is faked)."""
    from app import schemas
    from app.services import sessions

    async def fake_build_session(db, call):
        return schemas.Session(kind=call.kind, conversation_token="tok", conversation_id="conv_test",
                               overrides={}, dynamic_variables={}, max_seconds=schemas.MAX_SECONDS[call.kind])

    monkeypatch.setattr(sessions, "build_session", fake_build_session)
    sara, _ = members(make_family(consent=False))
    join(client, sara)
    call_id = client.get(f"/api/members/{sara}/phone-state").json()["incoming_call"]["call_id"]
    answer = client.post(f"/api/calls/{call_id}/answer")
    assert answer.status_code == 200 and answer.json()["kind"] == "welcome"
    assert client.get(f"/api/calls/{call_id}").json()["status"] == "in_progress"


def test_the_endpoint_still_needs_the_phone_page_open(client, make_family):
    sara, _ = members(make_family())
    join(client, sara)
    response = client.post(f"/api/members/{sara}/welcome-call")
    assert (response.status_code, error_code(response)) == (409, "phone_offline")
