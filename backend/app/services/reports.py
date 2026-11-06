"""
집계 규칙(SQL NUMERIC 합산, 통화별 분리, 환산 없음).
- 금액은 절댓값을 쓰고 방향은 flow로 정한다. 원본 부호는 저장값에 보존된다.
- transfer·needs_review는 수익·지출에서 제외한다.
- 대분류가 `카드대금`인 지출은 구매의 중복 정산이므로 지출·카드 사용액에서 제외한다.
- refund는 수익이 아니며 순지출·순 카드 사용액에서 차감하고 별도로 표시한다.
"""

from collections import defaultdict
from collections.abc import Sequence
from datetime import date
from decimal import Decimal
from typing import Any, cast

from sqlalchemy import and_, case, func, literal, not_, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.models import PaymentMethodMapping, Transaction
from app.schemas import CardKind
from app.services.periods import ComparisonMode, comparison_range, month_bounds, shift_month

CARD_SETTLEMENT_CATEGORY = "카드대금"
ZERO = Decimal(0)

_magnitude = func.abs(Transaction.amount)
_not_settlement: ColumnElement[bool] = or_(
    Transaction.major_category.is_(None),
    Transaction.major_category != CARD_SETTLEMENT_CATEGORY,
)
_is_purchase: ColumnElement[bool] = and_(Transaction.flow == "expense", _not_settlement)
_is_settlement: ColumnElement[bool] = and_(
    Transaction.flow == "expense", not_(_not_settlement)
)


def _sum_when(condition: ColumnElement[bool]) -> ColumnElement[Any]:
    return func.coalesce(func.sum(case((condition, _magnitude), else_=literal(0))), 0)


def _in_range(start: date, end: date) -> ColumnElement[bool]:
    return and_(Transaction.date >= start, Transaction.date <= end)


def totals_by_currency(session: Session, start: date, end: date) -> dict[str, dict[str, Decimal]]:
    """통화별 수익·총지출·환불·순지출·순현금흐름."""
    rows: Sequence[Any] = session.execute(
        select(
            Transaction.currency,
            _sum_when(Transaction.flow == "income"),
            _sum_when(_is_purchase),
            _sum_when(Transaction.flow == "refund"),
        )
        .where(_in_range(start, end))
        .group_by(Transaction.currency)
    ).all()
    result: dict[str, dict[str, Decimal]] = {}
    for currency, income, expense, refund in rows:
        income, expense, refund = Decimal(income), Decimal(expense), Decimal(refund)
        net_expense = expense - refund
        result[currency] = {
            "income": income,
            "gross_expense": expense,
            "refund": refund,
            "net_expense": net_expense,
            "net_cashflow": income - net_expense,
        }
    return result


def _counts(session: Session, start: date, end: date) -> tuple[int, int, int]:
    row = session.execute(
        select(
            func.count().filter(Transaction.flow == "needs_review"),
            func.count().filter(Transaction.flow == "transfer"),
            func.count().filter(_is_settlement),
        ).where(_in_range(start, end))
    ).one()
    return int(row[0]), int(row[1]), int(row[2])


def summary(session: Session, start: date, end: date, mode: ComparisonMode) -> dict[str, Any]:
    """현재·비교 기간 합계와 차이(통화별)."""
    prev_start, prev_end = comparison_range(start, end, mode)
    current = totals_by_currency(session, start, end)
    previous = totals_by_currency(session, prev_start, prev_end)
    keys = ("income", "gross_expense", "refund", "net_expense", "net_cashflow")
    empty = dict.fromkeys(keys, ZERO)
    currencies = sorted(set(current) | set(previous))
    unresolved, transfers, settlements = _counts(session, start, end)
    return {
        "start": start,
        "end": end,
        "comparison_mode": mode,
        "comparison_start": prev_start,
        "comparison_end": prev_end,
        "currencies": [
            {
                "currency": cur,
                "current": current.get(cur, empty),
                "previous": previous.get(cur, empty),
                "delta": {
                    k: current.get(cur, empty)[k] - previous.get(cur, empty)[k] for k in keys
                },
            }
            for cur in currencies
        ],
        "unresolved_count": unresolved,
        "transfer_count": transfers,
        "card_settlement_count": settlements,
    }


def categories(session: Session, start: date, end: date, flow: str) -> list[dict[str, Any]]:
    """원본 대분류·소분류별 합계(개명·병합 없음). expense는 카드대금 정산 제외."""
    condition: ColumnElement[bool] = _is_purchase if flow == "expense" else Transaction.flow == flow
    rows: Sequence[Any] = session.execute(
        select(
            Transaction.currency,
            Transaction.major_category,
            Transaction.minor_category,
            func.sum(_magnitude),
            func.count(),
        )
        .where(_in_range(start, end), condition)
        .group_by(Transaction.currency, Transaction.major_category, Transaction.minor_category)
        .order_by(Transaction.currency, func.sum(_magnitude).desc())
    ).all()
    return [
        {
            "currency": cur,
            "major_category": major,
            "minor_category": minor,
            "total": Decimal(total),
            "count": int(count),
        }
        for cur, major, minor, total, count in rows
    ]


def cards(session: Session, start: date, end: date) -> dict[str, Any]:
    """
    결제수단별 실제 구매·환불·순사용액. 카드 종류는 저장 매핑만 사용(없으면 null = 분류 필요).
    `other`는 카드 합계에서 제외하지만 목록에는 남긴다.
    """
    rows: Sequence[Any] = session.execute(
        select(
            Transaction.payment_method,
            Transaction.currency,
            PaymentMethodMapping.card_kind,
            _sum_when(_is_purchase),
            _sum_when(Transaction.flow == "refund"),
            func.count().filter(or_(_is_purchase, Transaction.flow == "refund")),
        )
        .outerjoin(
            PaymentMethodMapping, PaymentMethodMapping.source_label == Transaction.payment_method
        )
        .where(_in_range(start, end), or_(_is_purchase, Transaction.flow == "refund"))
        .group_by(Transaction.payment_method, Transaction.currency, PaymentMethodMapping.card_kind)
        .order_by(Transaction.currency, Transaction.payment_method)
    ).all()
    methods: list[dict[str, Any]] = []
    kinds: dict[tuple[str, str], dict[str, Decimal]] = defaultdict(
        lambda: {"purchase": ZERO, "refund": ZERO, "net": ZERO}
    )
    for label, cur, kind, purchase, refund, count in rows:
        purchase, refund = Decimal(purchase), Decimal(refund)
        methods.append(
            {
                "payment_method": label,
                "currency": cur,
                "card_kind": cast(CardKind | None, kind),
                "purchase": purchase,
                "refund": refund,
                "net": purchase - refund,
                "count": int(count),
            }
        )
        bucket = kinds[(cur, kind or "unmapped")]
        bucket["purchase"] += purchase
        bucket["refund"] += refund
        bucket["net"] += purchase - refund
    return {
        "start": start,
        "end": end,
        "methods": methods,
        "by_kind": [
            {"currency": cur, "card_kind": kind, **values}
            for (cur, kind), values in sorted(kinds.items())
        ],
    }


def monthly(session: Session, end: date, months: int) -> list[dict[str, Any]]:
    """종료일이 속한 달까지 최근 N개월의 통화별 수익·순지출(월별 흐름)."""
    first = shift_month(end.replace(day=1), -(months - 1))
    last = month_bounds(end)[1]
    month_key = func.date_trunc("month", Transaction.date)
    rows: Sequence[Any] = session.execute(
        select(
            month_key,
            Transaction.currency,
            _sum_when(Transaction.flow == "income"),
            _sum_when(_is_purchase),
            _sum_when(Transaction.flow == "refund"),
        )
        .where(_in_range(first, last))
        .group_by(month_key, Transaction.currency)
    ).all()
    found = {
        (m.strftime("%Y-%m"), cur): (Decimal(i), Decimal(e) - Decimal(r))
        for m, cur, i, e, r in rows
    }
    currencies = sorted({cur for _, cur in found}) or []
    result = []
    for offset in range(months):
        label = shift_month(first, offset).strftime("%Y-%m")
        for cur in currencies:
            income, net_expense = found.get((label, cur), (ZERO, ZERO))
            result.append(
                {"month": label, "currency": cur, "income": income, "net_expense": net_expense}
            )
    return result
