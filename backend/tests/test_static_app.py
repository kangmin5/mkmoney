from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def test_serves_built_frontend_and_api_from_one_origin(tmp_path: Path) -> None:
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>합성</title>", encoding="utf-8")
    (tmp_path / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    client = TestClient(create_app(tmp_path), base_url="https://testserver")
    assert "합성" in client.get("/").text
    assert client.get("/assets/app.js").status_code == 200
    assert client.get("/api/health").json()["status"] == "ok"
    assert client.get("/api/transactions").status_code == 401
    assert client.get("/docs").status_code == 404
