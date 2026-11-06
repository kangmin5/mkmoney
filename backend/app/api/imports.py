"""가져오기: 지문 중복 확인, 승인 행 반영, 최근 요약."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import ImportBatch
from app.schemas import (
    FingerprintCheckRequest,
    FingerprintCheckResponse,
    ImportBatchRead,
    ImportRequest,
    ImportResult,
)
from app.security import require_session
from app.services.imports import ImportValidationError, commit_import, existing_fingerprints

router = APIRouter(prefix="/api/imports", tags=["imports"], dependencies=[Depends(require_session)])
SessionDep = Annotated[Session, Depends(get_session)]


@router.post("/check", response_model=FingerprintCheckResponse)
def check(body: FingerprintCheckRequest, session: SessionDep) -> FingerprintCheckResponse:
    """지문만 받아 이미 저장된 것을 돌려준다. 거래 필드는 받지 않는다."""
    return FingerprintCheckResponse(existing=existing_fingerprints(session, body.fingerprints))


@router.post("", response_model=ImportResult, status_code=status.HTTP_201_CREATED)
def create(body: ImportRequest, session: SessionDep) -> ImportResult:
    """사용자가 승인한 신규 행을 한 트랜잭션으로 추가한다."""
    try:
        return commit_import(session, body)
    except ImportValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


@router.get("/recent", response_model=list[ImportBatchRead])
def recent(session: SessionDep, limit: Annotated[int, Query(ge=1, le=50)] = 5) -> list[ImportBatch]:
    """최근 가져오기 요약(시각·건수만)."""
    return list(session.scalars(select(ImportBatch).order_by(ImportBatch.imported_at.desc()).limit(limit)))
