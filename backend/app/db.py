"""PostgreSQL 연결과 요청 단위 세션."""

from collections.abc import Iterator
from functools import lru_cache

from fastapi import HTTPException, status
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings


def make_engine(database_url: str) -> Engine:
    """연결 확인(pre-ping)을 켠 엔진을 만든다."""
    return create_engine(database_url, pool_pre_ping=True)


@lru_cache
def _session_factory() -> sessionmaker[Session] | None:
    url = get_settings().database_url
    return sessionmaker(bind=make_engine(url), expire_on_commit=False) if url else None


def get_session() -> Iterator[Session]:
    """요청마다 DB 세션을 연다. DB 설정이 없으면 503."""
    factory = _session_factory()
    if factory is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "데이터베이스가 설정되지 않았습니다.")
    with factory() as session:
        yield session
