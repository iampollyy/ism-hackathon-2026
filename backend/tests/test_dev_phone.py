"""The bare test phone page (app/routers/dev.py)."""


def test_dev_phone_page_is_served(client) -> None:
    response = client.get("/api/dev/phone/mem_anything")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["cache-control"] == "no-store"
    body = response.text
    assert "Callback test phone" in body
    assert "@elevenlabs/client@1.32.1" in body
    for path in ("/phone-state", "/answer", "/events", "/end", "/family-line", "/decline"):
        assert path in body
