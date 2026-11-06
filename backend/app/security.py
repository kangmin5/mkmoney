"""단일 사용자 세션 인증과 요청 보호(HTTPS·same-origin). 새 의존성 없이 표준 라이브러리 HMAC을 쓴다."""

import base64
import hashlib
import hmac
import secrets
import threading
import time
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from pwdlib import PasswordHash
from pwdlib.exceptions import PwdlibError

from app.config import Settings, get_settings

SESSION_COOKIE = "mkmoney_session"
_password_hasher = PasswordHash.recommended()
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _sign(secret: str, payload: str) -> str:
    return _b64(hmac.new(secret.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest())


def issue_session_token(settings: Settings, now: float | None = None) -> str:
    """`발급시각.난수.서명` 형식의 세션 토큰을 만든다."""
    if not settings.session_secret:
        raise RuntimeError("session secret is not configured")
    payload = f"{int(now if now is not None else time.time())}.{secrets.token_urlsafe(16)}"
    return f"{payload}.{_sign(settings.session_secret, payload)}"


def verify_session_token(settings: Settings, token: str | None, now: float | None = None) -> bool:
    """서명과 만료를 검사한다."""
    if not token or not settings.session_secret:
        return False
    parts = token.split(".")
    if len(parts) != 3 or not parts[0].isdigit():
        return False
    payload = f"{parts[0]}.{parts[1]}"
    if not hmac.compare_digest(_sign(settings.session_secret, payload), parts[2]):
        return False
    age = (now if now is not None else time.time()) - int(parts[0])
    return 0 <= age <= settings.session_max_age_seconds


def hash_password(password: str) -> str:
    """Argon2id 해시를 만든다(운영 비밀번호 설정용)."""
    return _password_hasher.hash(password)


def verify_password(settings: Settings, password: str) -> bool:
    """설정된 해시와 비교한다. 해시가 없으면 항상 실패."""
    if not settings.password_hash:
        return False
    try:
        return _password_hasher.verify(password, settings.password_hash)
    except (PwdlibError, ValueError):  # 알 수 없거나 손상된 해시 형식
        return False


class LoginThrottle:
    """로그인 실패 시 지연(메모리 기반, 단일 프로세스 가정)."""

    def __init__(self, max_failures: int = 5, lock_seconds: int = 60) -> None:
        self.max_failures = max_failures
        self.lock_seconds = lock_seconds
        self._failures = 0
        self._locked_until = 0.0
        self._lock = threading.Lock()

    def check(self) -> None:
        """잠금 중이면 429."""
        with self._lock:
            if time.monotonic() < self._locked_until:
                raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "잠시 후 다시 시도하세요.")

    def record(self, success: bool) -> None:
        """결과를 기록하고 실패가 쌓이면 잠근다."""
        with self._lock:
            if success:
                self._failures = 0
                return
            self._failures += 1
            if self._failures >= self.max_failures:
                self._locked_until = time.monotonic() + self.lock_seconds
                self._failures = 0


login_throttle = LoginThrottle()


def request_is_secure(request: Request, settings: Settings) -> bool:
    """HTTPS 요청인지. 프록시 뒤에서는 uvicorn --proxy-headers가 scheme을 반영한다."""
    if request.url.scheme == "https":
        return True
    host = (request.url.hostname or "").lower()
    return settings.dev_insecure and host in {"localhost", "127.0.0.1"}


def enforce_transport(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> None:
    """모든 API: HTTPS 필수. 변경 요청은 허용 Origin과 일치해야 한다."""
    if not request_is_secure(request, settings):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "HTTPS 연결이 필요합니다.")
    if request.method not in _SAFE_METHODS:
        origin = request.headers.get("origin")
        if not origin or origin not in settings.allowed_origins:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "허용되지 않은 출처의 요청입니다.")


def require_session(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> None:
    """유효한 세션 쿠키가 없으면 401."""
    if not verify_session_token(settings, request.cookies.get(SESSION_COOKIE)):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "로그인이 필요합니다.")
