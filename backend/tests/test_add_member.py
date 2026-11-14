"""Adding a person to an existing family (POST /api/families/{id}/members)."""


def register(client, email="ana@example.com"):
    assert client.post("/api/auth/register", json={"name": "Ana", "email": email, "password": "correct horse"}).status_code in (200, 201)


def owned_family(client) -> str:
    register(client)
    body = {"name": "The Kovacs", "safe_word_set": True, "members": [
        {"name": "Ana", "relationship": "daughter", "is_organiser": True, "consent_practice": True}]}
    return client.post("/api/families", json=body).json()["family_id"]


def test_the_organiser_adds_a_person_who_then_joins(client) -> None:
    family_id = owned_family(client)
    added = client.post(f"/api/families/{family_id}/members", json={"name": " Petras ", "relationship": "father"})
    assert added.status_code == 201, added.text
    person = added.json()
    assert person["name"] == "Petras" and person["invite_link"] == f"/join/{person['id']}"
    members = {m["id"]: m for m in client.get(f"/api/families/{family_id}").json()["members"]}
    assert members[person["id"]]["joined"] is False
    assert members[person["id"]]["consent"]["practice"] is False  # nobody agrees for them
    # Their invite works like everyone else's.
    assert client.get(f"/api/join/{person['id']}").json()["member"]["name"] == "Petras"


def test_only_the_organiser_can_add(client) -> None:
    family_id = owned_family(client)
    client.post("/api/auth/logout")
    assert client.post(f"/api/families/{family_id}/members", json={"name": "Eve", "relationship": "friend"}).status_code == 401
    register(client, "eve@example.com")
    assert client.post(f"/api/families/{family_id}/members", json={"name": "Eve", "relationship": "friend"}).status_code == 404


def test_validation_unknown_family_and_the_cap(client) -> None:
    family_id = owned_family(client)
    bad = client.post(f"/api/families/{family_id}/members", json={"name": "", "relationship": "father"})
    assert bad.status_code == 422
    assert client.post("/api/families/fam_nope/members", json={"name": "X", "relationship": "y"}).status_code == 404
    for i in range(11):
        assert client.post(f"/api/families/{family_id}/members", json={"name": f"P{i}", "relationship": "cousin"}).status_code == 201
    full = client.post(f"/api/families/{family_id}/members", json={"name": "One more", "relationship": "cousin"})
    assert full.status_code == 409 and full.json()["error"]["code"] == "family_full"
