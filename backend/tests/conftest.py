"""테스트 공용 fixture. DB 테스트는 이름이 `_test`로 끝나는 일회용 PostgreSQL에서만 실행한다."""

import os
from collections.abc import Iterator
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from app.config import Settings, get_settings
from app.db import get_session
from app.main import app
from app.security import hash_password, login_throttle
from app.services.fingerprint import compute_fingerprint

TEST_PASSWORD = "synthetic-test-password"
ORIGIN = "https://testserver"
TABLES = "transactions, import_batches, transaction_type_mappings, payment_method_mappings"


def alembic_config(url: str) -> Config:
    """테스트 DB용 Alembic 설정."""
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url)
    return config


@pytest.fixture(scope="session")
def test_db_url() -> str:
    """테스트 DB URL. 없으면 skip, `_test`가 아니면 실패(운영·공유 DB 보호)."""
    url = os.getenv("MKMONEY_TEST_DATABASE_URL")
    if not url:
        pytest.skip("requires disposable PostgreSQL test database (make test-db-up)")
    if not (make_url(url).database or "").endswith("_test"):
        pytest.fail("MKMONEY_TEST_DATABASE_URL must target a database ending in _test")
    return url


@pytest.fixture(scope="session")
def pg_engine(test_db_url: str) -> Iterator[Engine]:
    """세션 시작 시 마이그레이션을 적용한 엔진."""
    os.environ.pop("MKMONEY_DATABASE_URL", None)
    command.upgrade(alembic_config(test_db_url), "head")
    engine = create_engine(test_db_url)
    yield engine
    engine.dispose()


@pytest.fixture
def db(pg_engine: Engine) -> Iterator[Session]:
    """테스트마다 깨끗한 테이블. 끝나면 테스트 DB의 테이블만 비운다."""
    factory = sessionmaker(bind=pg_engine, expire_on_commit=False)
    with factory() as session:
        yield session
    with pg_engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {TABLES}"))


@pytest.fixture
def settings() -> Settings:
    """합성 비밀값을 쓰는 테스트 설정."""
    return Settings(
        password_hash=hash_password(TEST_PASSWORD),
        session_secret="synthetic-session-secret-for-tests-only-000",
        allowed_origins=[ORIGIN],
        dev_insecure=False,
    )


@pytest.fixture
def client(settings: Settings, pg_engine: Engine, db: Session) -> Iterator[TestClient]:
    """HTTPS 기준 테스트 클라이언트(로그인 전)."""
    factory = sessionmaker(bind=pg_engine, expire_on_commit=False)

    def session_override() -> Iterator[Session]:
        with factory() as session:
            yield session

    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_session] = session_override
    login_throttle._failures = 0
    login_throttle._locked_until = 0.0
    with TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN}) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def authed(client: TestClient) -> TestClient:
    """로그인한 클라이언트."""
    assert client.post("/api/auth/login", json={"password": TEST_PASSWORD}).status_code == 200
    return client


def make_row(**overrides: Any) -> dict[str, Any]:
    """합성 거래 행(JSON 직렬화 가능)과 올바른 지문."""
    row: dict[str, Any] = {
        "date": "2026-11-06",
        "time": "12:00:00",
        "source_type": "지출",
        "flow": "expense",
        "major_category": "식비",
        "minor_category": "점심",
        "description": "합성 가게",
        "amount": "-12000",
        "currency": "KRW",
        "payment_method": "합성카드",
        "memo": None,
    }
    row.update(overrides)
    from datetime import time as dt_time

    row["fingerprint"] = compute_fingerprint(
        tx_date=date.fromisoformat(row["date"]),
        tx_time=dt_time.fromisoformat(row["time"]) if row["time"] else None,
        source_type=row["source_type"],
        amount=Decimal(row["amount"]),
        currency=row["currency"],
        payment_method=row["payment_method"],
        description=row["description"],
    )
    return row
