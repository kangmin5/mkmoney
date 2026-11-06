from datetime import date
from decimal import Decimal
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import PaymentMethodMapping, Transaction


def add(db: Session, day: str, flow: str, amount: str, **extra: Any) -> None:
    """합성 거래를 직접 추가한다(지문은 고유값이면 충분)."""
    db.add(Transaction(
        date=date.fromisoformat(day), source_type=extra.pop("source_type", "합성"), flow=flow,
        description="합성", amount=Decimal(amount), currency=extra.pop("currency", "KRW"),
        payment_method=extra.pop("payment_method", "합성카드"), fingerprint=uuid4().hex + uuid4().hex,
        **extra,
    ))
    db.commit()


def seed(db: Session) -> None:
    add(db, "2026-10-31", "expense", "-999")                       # 기간 밖(전날)
    add(db, "2026-11-01", "income", "3000000", major_category="급여")
    add(db, "2026-11-01", "income", "500000", major_category="임대수익")
    add(db, "2026-11-15", "expense", "-12000", major_category="식비", minor_category="점심")
    add(db, "2026-11-30", "expense", "-8000", major_category="식비", minor_category="저녁", payment_method="합성체크")
    add(db, "2026-11-20", "expense", "-700000", major_category="카드대금")   # 정산 출금: 제외
    add(db, "2026-11-20", "transfer", "-1000000", major_category="저축")     # 이체: 제외
    add(db, "2026-11-21", "refund", "2000", major_category="식비")          # 환불: 차감
    add(db, "2026-11-22", "needs_review", "5000")                          # 미분류: 제외
    add(db, "2026-11-23", "expense", "-10.5", currency="USD", major_category="구독")
    add(db, "2026-12-01", "expense", "-999")                               # 기간 밖(다음날)
    add(db, "2026-10-05", "income", "100000")                              # 전월 비교용
    add(db, "2026-10-06", "expense", "-50000", major_category="식비", minor_category="점심")


NOV = {"start": "2026-11-01", "end": "2026-11-30"}


def test_summary_applies_accounting_rules_per_currency(authed: TestClient, db: Session) -> None:
    seed(db)
    data = authed.get("/api/reports/summary", params={**NOV, "comparison": "previous_month"}).json()
    krw = next(c for c in data["currencies"] if c["currency"] == "KRW")
    assert {k: Decimal(v) for k, v in krw["current"].items()} == {
        "income": Decimal(3500000), "gross_expense": Decimal(20000), "refund": Decimal(2000),
        "net_expense": Decimal(18000), "net_cashflow": Decimal(3482000),
    }
    assert Decimal(krw["previous"]["net_expense"]) == Decimal(50999)  # 10/31 행 포함
    assert Decimal(krw["delta"]["net_expense"]) == Decimal(-32999)
    usd = next(c for c in data["currencies"] if c["currency"] == "USD")
    assert Decimal(usd["current"]["gross_expense"]) == Decimal("10.5")
    assert (data["comparison_start"], data["comparison_end"]) == ("2026-10-01", "2026-10-31")
    assert (data["unresolved_count"], data["transfer_count"], data["card_settlement_count"]) == (1, 1, 1)


def test_categories_keep_original_labels_and_exclude_settlement(authed: TestClient, db: Session) -> None:
    seed(db)
    rows = authed.get("/api/reports/categories", params={**NOV, "flow": "expense"}).json()
    labels = {(r["currency"], r["major_category"], r["minor_category"]): Decimal(r["total"]) for r in rows}
    assert labels == {
        ("KRW", "식비", "점심"): Decimal(12000), ("KRW", "식비", "저녁"): Decimal(8000),
        ("USD", "구독", None): Decimal("10.5"),
    }
    income = authed.get("/api/reports/categories", params={**NOV, "flow": "income"}).json()
    assert {r["major_category"] for r in income} == {"급여", "임대수익"}


def test_cards_group_by_saved_mapping_and_subtract_refunds(authed: TestClient, db: Session) -> None:
    seed(db)
    db.add(PaymentMethodMapping(source_label="합성카드", card_kind="credit"))
    db.commit()
    data = authed.get("/api/reports/cards", params=NOV).json()
    methods = {(m["payment_method"], m["currency"]): m for m in data["methods"]}
    card = methods[("합성카드", "KRW")]
    assert (Decimal(card["purchase"]), Decimal(card["refund"]), Decimal(card["net"])) == (
        Decimal(12000), Decimal(2000), Decimal(10000))
    assert methods[("합성체크", "KRW")]["card_kind"] is None
    kinds = {(k["currency"], k["card_kind"]): Decimal(k["net"]) for k in data["by_kind"]}
    assert kinds[("KRW", "credit")] == Decimal(10000) and kinds[("KRW", "unmapped")] == Decimal(8000)


def test_monthly_flow_fills_empty_months(authed: TestClient, db: Session) -> None:
    seed(db)
    rows = authed.get("/api/reports/monthly", params={"end": "2026-11-30", "months": 3}).json()
    krw = [(r["month"], Decimal(r["income"]), Decimal(r["net_expense"])) for r in rows if r["currency"] == "KRW"]
    assert krw == [("2026-09", 0, 0), ("2026-10", Decimal(100000), Decimal(50999)),
                   ("2026-11", Decimal(3500000), Decimal(18000))]


def test_report_ranges_are_validated(authed: TestClient) -> None:
    assert authed.get("/api/reports/summary", params={"start": "2026-12-01", "end": "2026-11-01"}).status_code == 422
    assert authed.get("/api/reports/summary", params=NOV).json()["currencies"] == []
