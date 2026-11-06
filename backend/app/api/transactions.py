"""거래 목록(페이지네이션)과 행 단위 흐름 지정."""

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Transaction
from app.schemas import Flow, FlowUpdate, TransactionPage, TransactionRead
from app.security import require_session
from app.services.flow import derive_flow
from app.services.mappings import load_type_mappings

router = APIRouter(prefix="/api/transactions", tags=["transactions"], dependencies=[Depends(require_session)])
SessionDep = Annotated[Session, Depends(get_session)]


@router.get("", response_model=TransactionPage)
def list_transactions(
    session: SessionDep,
    start: date | None = None,
    end: date | None = None,
    flow: Flow | None = None,
    major_category: Annotated[str | None, Query(max_length=120)] = None,
    payment_method: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> TransactionPage:
    """기간·흐름·분류·결제수단으로 거른 거래를 최신순으로 반환한다(양 끝 날짜 포함)."""
    if start and end and start > end:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "시작일이 종료일보다 늦습니다.")
    conditions = []
    if start:
        conditions.append(Transaction.date >= start)
    if end:
        conditions.append(Transaction.date <= end)
    if flow:
        conditions.append(Transaction.flow == flow)
    if major_category == "":
        # 빈 값은 "대분류 없음"(NULL 또는 빈 문자열)을 뜻한다.
        conditions.append(or_(Transaction.major_category.is_(None), Transaction.major_category == ""))
    elif major_category is not None:
        conditions.append(Transaction.major_category == major_category)
    if payment_method is not None:
        conditions.append(Transaction.payment_method == payment_method)
    total = session.scalar(select(func.count()).select_from(Transaction).where(*conditions)) or 0
    rows = session.scalars(
        select(Transaction)
        .where(*conditions)
        .order_by(
            Transaction.date.desc(),
            Transaction.time.desc().nulls_last(),
            Transaction.created_at.desc(),
            Transaction.id,
        )
        .limit(limit)
        .offset(offset)
    )
    return TransactionPage(
        items=[TransactionRead.model_validate(r) for r in rows], total=total, limit=limit, offset=offset
    )


@router.patch("/{transaction_id}/flow", response_model=TransactionRead)
def update_flow(transaction_id: UUID, body: FlowUpdate, session: SessionDep) -> TransactionRead:
    """
    사용자가 행의 흐름을 지정한다(예: 양수 지출을 환불로). 원본 값은 바꾸지 않는다.
    flow가 null이면 자동(타입 매핑) 판정으로 되돌린다.
    """
    row = session.get(Transaction, transaction_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "거래를 찾을 수 없습니다.")
    if body.flow is None:
        row.flow = derive_flow(row.source_type, row.amount, load_type_mappings(session))
        row.flow_source = "auto"
    else:
        row.flow = body.flow
        row.flow_source = "manual"
    session.commit()
    return TransactionRead.model_validate(row)
