"""기간·월별·분류·카드 집계 API(양 끝 날짜 포함)."""

from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_session
from app.schemas import CardsResponse, CategoryTotal, MonthlyFlow, SummaryResponse
from app.security import require_session
from app.services import reports as service
from app.services.periods import ComparisonMode, validate_range

router = APIRouter(prefix="/api/reports", tags=["reports"], dependencies=[Depends(require_session)])
SessionDep = Annotated[Session, Depends(get_session)]


def _range(start: date, end: date) -> None:
    try:
        validate_range(start, end)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.get("/summary", response_model=SummaryResponse)
def summary(
    session: SessionDep, start: date, end: date, comparison: ComparisonMode = "previous_period"
) -> dict[str, Any]:
    """통화별 수익·지출·환불·차액과 비교 기간 차이, 미분류 건수."""
    _range(start, end)
    return service.summary(session, start, end, comparison)


@router.get("/categories", response_model=list[CategoryTotal])
def categories(
    session: SessionDep,
    start: date,
    end: date,
    flow: Literal["income", "expense", "refund"] = "expense",
) -> list[dict[str, Any]]:
    """원본 대·소분류별 합계."""
    _range(start, end)
    return service.categories(session, start, end, flow)


@router.get("/cards", response_model=CardsResponse)
def cards(session: SessionDep, start: date, end: date) -> dict[str, Any]:
    """결제수단·카드 종류별 실제 구매 사용액(카드대금 정산 제외)."""
    _range(start, end)
    return service.cards(session, start, end)


@router.get("/monthly", response_model=list[MonthlyFlow])
def monthly(
    session: SessionDep, end: date, months: Annotated[int, Query(ge=1, le=24)] = 6
) -> list[dict[str, Any]]:
    """최근 N개월 월별 수익·순지출."""
    return service.monthly(session, end, months)
