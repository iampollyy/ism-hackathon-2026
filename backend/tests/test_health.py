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


def test_startup_resumes_the_after_call_work_of_ended_calls(client, make_family, monkeypatch):
    from fastapi.testclient import TestClient

    from app.db import new_session, now_iso
    from app.ids import new_call_id
    from app.main import app
    from app.models import Call
    from app.services import pipeline

    family = make_family()
    with new_session() as db:
        ended = Call(id=new_call_id(), family_id=family["family_id"], kind="family_line",
                     target_member_id=family["members"][0]["id"], difficulty=1, status="ended",
                     ended_at=now_iso(), created_at=now_iso())
        db.add(ended)
        db.commit()
        ended_id = ended.id
    started: list[str] = []

    def fake_after_call(call_id):
        started.append(call_id)

        async def nothing() -> None:
            return None

        return nothing()

    monkeypatch.setattr(pipeline, "after_call", fake_after_call)
    with TestClient(app):  # a restart
        pass
    assert started == [ended_id]
