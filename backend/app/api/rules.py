"""분류 규칙 API: 목록·추가·수정·삭제·순서, 기존 거래 적용 미리보기와 승인 적용."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_session
from app.schemas import RuleApplyPreview, RuleApplyResult, RuleCreate, RuleOrder, RuleRead
from app.security import require_session
from app.services import rules as service

router = APIRouter(prefix="/api/rules", tags=["rules"], dependencies=[Depends(require_session)])
SessionDep = Annotated[Session, Depends(get_session)]


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "규칙을 찾을 수 없습니다.")


@router.get("", response_model=list[RuleRead])
def list_rules(session: SessionDep) -> list[RuleRead]:
    """규칙 목록(위에서부터 먼저 적용)."""
    return service.list_rules(session)


@router.post("", response_model=list[RuleRead], status_code=status.HTTP_201_CREATED)
def create_rule(body: RuleCreate, session: SessionDep) -> list[RuleRead]:
    """규칙을 추가하고 전체 목록을 돌려준다."""
    try:
        service.add_rule(session, body)
    except service.RuleConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return service.list_rules(session)


@router.put("/order", response_model=list[RuleRead])
def reorder(body: RuleOrder, session: SessionDep) -> list[RuleRead]:
    """적용 순서를 바꾼다."""
    try:
        service.reorder_rules(session, body.ids)
    except service.RuleNotFoundError as exc:
        raise _not_found() from exc
    return service.list_rules(session)


@router.put("/{rule_id}", response_model=list[RuleRead])
def update_rule(rule_id: UUID, body: RuleCreate, session: SessionDep) -> list[RuleRead]:
    """규칙을 수정한다(이미 저장된 거래는 그대로)."""
    try:
        service.update_rule(session, rule_id, body)
    except service.RuleNotFoundError as exc:
        raise _not_found() from exc
    except service.RuleConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return service.list_rules(session)


@router.delete("/{rule_id}", response_model=list[RuleRead])
def delete_rule(rule_id: UUID, session: SessionDep) -> list[RuleRead]:
    """규칙을 삭제한다(이미 저장된 거래는 그대로)."""
    try:
        service.delete_rule(session, rule_id)
    except service.RuleNotFoundError as exc:
        raise _not_found() from exc
    return service.list_rules(session)


@router.post("/apply/preview", response_model=RuleApplyPreview)
def apply_preview(session: SessionDep) -> RuleApplyPreview:
    """기존 거래에 적용하면 바뀔 건수(아무것도 바꾸지 않음)."""
    return service.preview_apply(session)


@router.post("/apply", response_model=RuleApplyResult)
def apply(session: SessionDep) -> RuleApplyResult:
    """사용자가 미리보기를 승인한 뒤 기존 거래에 규칙을 적용한다."""
    return service.apply_rules(session)
