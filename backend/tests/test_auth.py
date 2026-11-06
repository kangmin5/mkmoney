from fastapi.testclient import TestClient

from app.config import Settings
from app.security import issue_session_token, verify_session_token
from tests.conftest import ORIGIN, TEST_PASSWORD


def test_data_routes_require_login(client: TestClient) -> None:
    assert client.get("/api/transactions").status_code == 401
    assert client.post("/api/imports/check", json={"fingerprints": []}).status_code == 401
    assert client.get("/api/auth/me").json() == {"authenticated": False}


def test_login_sets_strict_secure_httponly_cookie_and_logout_clears(client: TestClient) -> None:
    assert client.post("/api/auth/login", json={"password": "wrong"}).status_code == 401
    response = client.post("/api/auth/login", json={"password": TEST_PASSWORD})
    assert response.status_code == 200
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "secure" in cookie and "samesite=strict" in cookie
    assert client.get("/api/auth/me").json() == {"authenticated": True}
    client.post("/api/auth/logout")
    client.cookies.clear()
    assert client.get("/api/transactions").status_code == 401


def test_mutations_require_https_and_same_origin(client: TestClient) -> None:
    body = {"password": TEST_PASSWORD}
    assert client.post("/api/auth/login", json=body, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/auth/login", json=body, headers={"Origin": ""}).status_code == 403
    plain = TestClient(client.app, base_url="http://testserver", headers={"Origin": ORIGIN})
    assert plain.post("/api/auth/login", json=body).status_code == 403


def test_repeated_failures_lock_login(client: TestClient) -> None:
    for _ in range(5):
        client.post("/api/auth/login", json={"password": "wrong"})
    assert client.post("/api/auth/login", json={"password": TEST_PASSWORD}).status_code == 429


def test_session_token_expiry_and_tamper(settings: Settings) -> None:
    token = issue_session_token(settings, now=1_000_000)
    assert verify_session_token(settings, token, now=1_000_100)
    assert not verify_session_token(settings, token, now=1_000_000 + settings.session_max_age_seconds + 1)
    assert not verify_session_token(settings, token[:-2] + "xx", now=1_000_100)


def test_allowed_origins_accept_json_or_comma_separated(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("MKMONEY_ALLOWED_ORIGINS", "https://a.test/, https://b.test")
    assert Settings().allowed_origins == ["https://a.test", "https://b.test"]
    monkeypatch.setenv("MKMONEY_ALLOWED_ORIGINS", '["https://c.test"]')
    assert Settings().allowed_origins == ["https://c.test"]
