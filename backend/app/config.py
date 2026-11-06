"""환경 변수 기반 설정. 비밀값은 저장소 밖(.env, 비밀 관리 수단)에서 주입한다."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """앱 설정. 모든 키는 `MKMONEY_` 접두사를 쓴다."""

    model_config = SettingsConfigDict(env_prefix="MKMONEY_", extra="ignore")

    frontend_dist: Path = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    database_url: str | None = None
    # Argon2id 해시(scripts/create_password_hash.py로 생성). 없으면 로그인 불가.
    password_hash: str | None = None
    # 세션 서명 비밀(32바이트 이상 권장). 없으면 로그인 불가.
    session_secret: str | None = None
    session_max_age_seconds: int = Field(default=12 * 3600, ge=300)
    # 변경 요청의 Origin 헤더가 이 목록 중 하나여야 한다(예: https://192.168.0.10:8443).
    # JSON 배열 또는 쉼표 구분 문자열 모두 허용한다.
    allowed_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)
    # 개발 전용: localhost HTTP 허용, Secure 쿠키 해제. 운영에서는 절대 켜지 않는다.
    dev_insecure: bool = False

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """`["a","b"]` 또는 `a,b` 형식을 목록으로 바꾼다(끝의 / 제거)."""
        if isinstance(value, str):
            text = value.strip()
            items = json.loads(text) if text.startswith("[") else text.split(",")
            return [str(item).strip().rstrip("/") for item in items if str(item).strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    """설정 싱글톤(테스트에서는 dependency override로 교체)."""
    return Settings()


settings = get_settings()
