"""단일 사용자 로그인·로그아웃·세션 확인."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.config import Settings, get_settings
from app.schemas import AuthStatus, LoginRequest
from app.security import (
    SESSION_COOKIE,
    issue_session_token,
    login_throttle,
    verify_password,
    verify_session_token,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
SettingsDep = Annotated[Settings, Depends(get_settings)]


def _set_cookie(response: Response, settings: Settings, value: str, max_age: int) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        value,
        max_age=max_age,
        httponly=True,
        secure=not settings.dev_insecure,
        samesite="strict",
        path="/",
    )


@router.post("/login", response_model=AuthStatus)
def login(body: LoginRequest, response: Response, settings: SettingsDep) -> AuthStatus:
    """비밀번호를 확인하고 서명된 HttpOnly 세션 쿠키를 발급한다."""
    if not settings.password_hash or not settings.session_secret:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "로그인이 설정되지 않았습니다.")
    login_throttle.check()
    ok = verify_password(settings, body.password)
    login_throttle.record(ok)
    if not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "비밀번호가 올바르지 않습니다.")
    _set_cookie(response, settings, issue_session_token(settings), settings.session_max_age_seconds)
    return AuthStatus(authenticated=True)


@router.post("/logout", response_model=AuthStatus)
def logout(response: Response, settings: SettingsDep) -> AuthStatus:
    """세션 쿠키를 지운다."""
    _set_cookie(response, settings, "", 0)
    return AuthStatus(authenticated=False)


@router.get("/me", response_model=AuthStatus)
def me(request: Request, settings: SettingsDep) -> AuthStatus:
    """현재 브라우저 세션의 인증 여부만 알려준다."""
    return AuthStatus(authenticated=verify_session_token(settings, request.cookies.get(SESSION_COOKIE)))
