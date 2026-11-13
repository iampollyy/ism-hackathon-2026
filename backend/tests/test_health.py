"""GET /api/health and the shared error shape."""


def test_health_is_ok(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "fake_elevenlabs": True}


def test_unknown_route_uses_error_shape(client):
    response = client.get("/api/nothing-here")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert "message" in response.json()["error"]


def test_cors_allows_vite_dev_server(client):
    response = client.options(
        "/api/health",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
