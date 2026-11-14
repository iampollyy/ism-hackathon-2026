"""The organiser agrees at sign-up, so they count as joined (routers/families.create_family)."""


def make_owned_family(client, voice: bool, practice: bool = True) -> tuple[str, str]:
    client.post("/api/auth/register", json={"name": "Ana", "email": "ana@example.com", "password": "correct horse"})
    body = {"name": "The Kovacs", "safe_word_set": True, "members": [
        {"name": "Ana", "relationship": "daughter", "is_organiser": True, "consent_practice": practice,
         "consent_clone_from_call": voice},
        {"name": "Rūta", "relationship": "mother", "consent_practice": True, "consent_clone_from_call": True}]}
    created = client.post("/api/families", json=body).json()
    return created["family_id"], created["members"][0]["id"]


def test_the_organiser_is_joined_with_their_own_ticks(client) -> None:
    family_id, ana = make_owned_family(client, voice=True)
    join = client.get(f"/api/join/{ana}").json()
    assert join["joined"] is True
    assert join["consents"] == {"practice": True, "clone_from_call": True}
    members = {m["id"]: m for m in client.get(f"/api/families/{family_id}").json()["members"]}
    rest = [m for m in members.values() if m["id"] != ana][0]
    assert members[ana]["joined"] is True
    # Nobody agrees for someone else: Rūta's ticks from the organiser's form are ignored.
    assert rest["joined"] is False and rest["consent"]["practice"] is False


def test_the_organisers_welcome_call_starts_when_they_open_their_phone(client) -> None:
    _, ana = make_owned_family(client, voice=True)
    state = client.get(f"/api/members/{ana}/phone-state").json()
    assert state["incoming_call"] and state["incoming_call"]["kind"] == "welcome"


def test_without_the_voice_tick_their_voice_is_not_copied_from_the_call(client) -> None:
    _, ana = make_owned_family(client, voice=False)
    join = client.get(f"/api/join/{ana}").json()
    assert join["joined"] is True and join["consents"]["clone_from_call"] is False


def test_without_a_log_in_nothing_changes(client) -> None:
    body = {"name": "Open family", "safe_word_set": False, "members": [
        {"name": "Ana", "relationship": "daughter", "is_organiser": True, "consent_practice": True,
         "consent_clone_from_call": True},
        {"name": "Rūta", "relationship": "mother"}]}
    ana = client.post("/api/families", json=body).json()["members"][0]["id"]
    assert client.get(f"/api/join/{ana}").json()["joined"] is False
