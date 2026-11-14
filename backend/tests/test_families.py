"""POST /api/families and GET /api/families/{id}."""

import json
from datetime import timedelta

from sqlalchemy import select

from app.db import now_iso, to_iso, utcnow
from app.ids import new_call_id
from app.models import Call, Consent, Family, Member, ReadinessSnapshot


def safe_word_keys(value) -> list[str]:
    """Every key anywhere in a JSON value that mentions the safe word,
    except the allowed safe_word_set."""
    found: list[str] = []
    if isinstance(value, dict):
        for key, inner in value.items():
            if "safe" in key.lower() and key != "safe_word_set":
                found.append(key)
            found.extend(safe_word_keys(inner))
    elif isinstance(value, list):
        for inner in value:
            found.extend(safe_word_keys(inner))
    return found


def test_create_family_returns_ids_and_phone_links(client, make_family):
    body = make_family()
    assert body["family_id"].startswith("fam_")
    assert [m["name"] for m in body["members"]] == ["Sara", "Jon"]
    for member in body["members"]:
        assert member["id"].startswith("mem_")
        assert len(member["id"]) >= 4 + 10
        assert member["phone_link"] == f"/phone/{member['id']}"


def test_consent_tick_sets_time_and_writes_manual_consent(client, make_family, db):
    body = make_family(consent=True)
    for link in body["members"]:
        member = db.get(Member, link["id"])
        assert member.consent_practice_at is not None
        rows = list(db.scalars(select(Consent).where(Consent.member_id == member.id)))
        assert [(row.kind, row.source) for row in rows] == [("practice", "manual")]


def test_no_tick_means_no_consent(client, make_family, db):
    body = make_family(consent=False)
    member = db.get(Member, body["members"][0]["id"])
    assert member.consent_practice_at is None
    assert db.scalars(select(Consent)).first() is None
    family = client.get(f"/api/families/{body['family_id']}").json()
    assert family["members"][0]["consent"] == {"clone": False, "practice": False}


def test_create_family_validates(client):
    response = client.post("/api/families", json={"name": "X", "members": []})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_safe_word_is_never_stored_or_returned(client, db):
    payload = {
        "name": "The Kovacs", "safe_word_set": True, "safe_word": "pineapple",
        "members": [{"name": "Sara", "relationship": "mother", "consent_practice": True,
                     "safe_word": "pineapple"}],
    }
    created = client.post("/api/families", json=payload)
    assert created.status_code == 201
    assert "pineapple" not in created.text
    family = client.get(f"/api/families/{created.json()['family_id']}")
    assert "pineapple" not in family.text
    assert safe_word_keys(family.json()) == []
    assert safe_word_keys(created.json()) == []
    assert family.json()["safe_word_set"] is True
    stored = db.get(Family, created.json()["family_id"])
    assert not hasattr(stored, "safe_word")


def test_get_family_shape_with_defaults(client, make_family):
    body = make_family()
    response = client.get(f"/api/families/{body['family_id']}")
    assert response.status_code == 200
    family = response.json()
    assert family["id"] == body["family_id"]
    assert family["name"] == "The Kovacs"
    assert family["family_number"] == {"enabled": True}
    assert family["readiness"] == {"before": 0, "now": 0, "max": 10}
    assert family["week"] == []
    sara = family["members"][0]
    assert sara["name"] == "Sara" and sara["relationship"] == "mother"
    assert sara["consent"] == {"clone": False, "practice": True}
    assert sara["voice_ready"] is False and sara["voice_status"] == "none"
    assert sara["phone_online"] is False
    assert sara["plan"] is None and sara["said"] is None and sara["weak_spot"] is None
    assert sara["readiness"]["before"] == 0 and sara["readiness"]["max"] == 10
    assert [item["key"] for item in sara["readiness"]["items"]] == [
        "verify_first", "safe_word", "trusted_contact", "payment_caution", "under_pressure"]


def test_get_family_reads_snapshots_plan_profile_and_online(client, make_family, db):
    body = make_family()
    member_id = body["members"][0]["id"]
    member = db.get(Member, member_id)
    member.last_seen_at = now_iso()
    member.voice_id = "voice_x"
    member.voice_status = "ready"
    member.consent_clone_at = now_iso()
    db.add(Consent(member_id=member_id, kind="clone_from_call", source="invite", evidence="tick", created_at=now_iso()))
    member.profile_json = json.dumps({"said": "If the bank rings, I do what they say.", "weak_spot": "Trusts the bank."})
    member.plan_json = json.dumps({
        "member_id": member_id, "weak_spot": "Acts fast when the bank calls.", "this_week": "Save the family number.",
        "steps": [{"when": "today", "scenario": "bank_security", "difficulty": 1, "voice_of": None,
                   "why": "Because you said you would do what the bank says."}],
    })
    first = [{"key": "verify_first", "score": 0}, {"key": "safe_word", "score": 1}]
    latest = [{"key": "verify_first", "score": 2}, {"key": "safe_word", "score": 2}, {"key": "under_pressure", "score": 2}]
    db.add(ReadinessSnapshot(member_id=member_id, items_json=json.dumps(first), total=1, max=10,
                             created_at="2026-11-13T10:00:00+00:00"))
    db.add(ReadinessSnapshot(member_id=member_id, items_json=json.dumps(latest), total=6, max=10,
                             created_at="2026-11-13T11:00:00+00:00"))
    db.commit()

    family = client.get(f"/api/families/{body['family_id']}").json()
    sara = family["members"][0]
    assert sara["phone_online"] is True
    assert sara["voice_ready"] is True and sara["consent"]["clone"] is True
    assert sara["said"] == "If the bank rings, I do what they say."
    assert sara["weak_spot"] == "Acts fast when the bank calls."
    assert sara["plan"]["this_week"] == "Save the family number."
    assert sara["plan"]["steps"][0]["scenario"] == "bank_security"
    assert sara["plan"]["steps"][0]["status"] == "planned"
    assert sara["readiness"]["before"] == 1 and sara["readiness"]["now"] == 6
    items = {item["key"]: item for item in sara["readiness"]["items"]}
    assert items["verify_first"]["before"] == 0 and items["verify_first"]["now"] == 2
    assert items["verify_first"]["label"]
    assert family["readiness"]["before"] == 1 and family["readiness"]["now"] == 6


def test_phone_offline_after_five_seconds(client, make_family, db):
    body = make_family()
    member = db.get(Member, body["members"][0]["id"])
    member.last_seen_at = "2026-01-01T00:00:00+00:00"
    db.commit()
    family = client.get(f"/api/families/{body['family_id']}").json()
    assert family["members"][0]["phone_online"] is False


def test_unknown_family_is_404(client):
    response = client.get("/api/families/fam_nope")
    assert response.status_code == 404
    assert response.json() == {"error": {"code": "not_found", "message": "No family with this id."}}


def test_family_readiness_is_the_mean_of_members_with_a_score(client, make_family, db):
    body = make_family()
    sara, jon = (m["id"] for m in body["members"])
    low = [{"key": "verify_first", "score": 2}, {"key": "safe_word", "score": 2}]
    high = low + [{"key": "trusted_contact", "score": 2}, {"key": "payment_caution", "score": 2}]
    db.add(ReadinessSnapshot(member_id=sara, items_json=json.dumps(low), total=4, max=10, created_at=now_iso()))
    db.commit()
    family = client.get(f"/api/families/{body['family_id']}").json()
    assert family["readiness"] == {"before": 4, "now": 4, "max": 10}, "Jon has no score yet, so he does not count"

    db.add(ReadinessSnapshot(member_id=jon, items_json=json.dumps(high), total=8, max=10, created_at=now_iso()))
    db.commit()
    family = client.get(f"/api/families/{body['family_id']}").json()
    assert family["readiness"] == {"before": 6, "now": 6, "max": 10}


# ---------------------------------------------------------------- consent.clone: the person's own voice tick


def voice_consent(client, family_id: str) -> dict[str, bool]:
    family = client.get(f"/api/families/{family_id}").json()
    return {member["name"]: member["consent"]["clone"] for member in family["members"]}


def test_voice_consent_is_the_members_own_tick(client, make_family, db):
    body = make_family()
    sara = body["members"][0]["id"]
    member = db.get(Member, sara)
    member.voice_id, member.voice_status, member.consent_clone_at = "voice_x", "ready", now_iso()
    db.commit()
    # A voice exists, but Sara never ticked "my voice may be copied": not allowed.
    # Jon is the organiser, the one at the laptop: allowed.
    assert voice_consent(client, body["family_id"]) == {"Sara": False, "Jon": True}

    db.add(Consent(member_id=sara, kind="clone_from_call", source="invite", evidence="tick",
                   created_at="2026-11-13T10:00:00+00:00"))
    db.commit()
    assert voice_consent(client, body["family_id"])["Sara"] is True

    db.add(Consent(member_id=sara, kind="clone_from_call_withdrawn", source="invite", evidence="untick",
                   created_at="2026-11-13T11:00:00+00:00"))
    db.commit()
    assert voice_consent(client, body["family_id"])["Sara"] is False, "the latest answer wins"

    db.add(Consent(member_id=sara, kind="clone_from_call", source="invite", evidence="tick",
                   created_at="2026-11-13T12:00:00+00:00"))
    member.opted_out_at = now_iso()
    db.get(Member, body["members"][1]["id"]).opted_out_at = now_iso()
    db.commit()
    assert voice_consent(client, body["family_id"]) == {"Sara": False, "Jon": False}, "never after leaving"


# ---------------------------------------------------------------- This week keeps the organiser's drill a surprise


def add_practice(db, family_id: str, target: str, status: str, minutes: int) -> str:
    call_id = new_call_id()
    when = to_iso(utcnow() + timedelta(minutes=minutes))
    db.add(Call(id=call_id, family_id=family_id, kind="practice", target_member_id=target, difficulty=1,
                scenario="hospital", status=status, scheduled_for=when if status == "scheduled" else None,
                created_at=now_iso()))
    db.commit()
    return call_id


def test_week_hides_the_organisers_own_scheduled_drill(client, make_family, db):
    body = make_family()
    sara, jon = (m["id"] for m in body["members"])
    for_sara = add_practice(db, body["family_id"], sara, "scheduled", 30)
    hidden = add_practice(db, body["family_id"], jon, "scheduled", 40)
    week = client.get(f"/api/families/{body['family_id']}").json()["week"]
    assert [item["call_id"] for item in week] == [for_sara]
    assert "Practice for Jon" not in json.dumps(week)

    db.get(Call, hidden).status = "ringing"  # once it rings it shows like any other
    db.commit()
    week = client.get(f"/api/families/{body['family_id']}").json()["week"]
    assert {item["call_id"] for item in week} == {for_sara, hidden}
