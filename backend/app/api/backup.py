"""백업 내보내기(평문 JSON → 브라우저가 암호화)와 병합 복원."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.db import get_session
from app.schemas import BackupPayload, RestoreRequest, RestoreResult
from app.security import require_session
from app.services import backup as service
from app.services.imports import ImportValidationError

router = APIRouter(prefix="/api/backup", tags=["backup"], dependencies=[Depends(require_session)])
SessionDep = Annotated[Session, Depends(get_session)]


@router.get("/export", response_model=BackupPayload)
def export(session: SessionDep, response: Response) -> BackupPayload:
    """로그인한 같은 출처 클라이언트에만 전체 데이터를 준다. 캐시하지 않는다."""
    response.headers["Cache-Control"] = "no-store"
    return service.export_payload(session)


@router.post("/restore", response_model=RestoreResult)
def restore(body: RestoreRequest, session: SessionDep) -> RestoreResult:
    """사용자가 미리보기를 승인한 백업 행·매핑을 병합한다(추가만)."""
    try:
        return service.restore(session, body)
    except ImportValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
