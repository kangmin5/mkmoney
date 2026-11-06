from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Base, ImportBatch, PaymentMethodMapping, Transaction, TransactionTypeMapping
from app.schemas import TransactionCreate


def test_transaction_preserves_fixed_precision_and_requires_unique_fingerprint() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        row = Transaction(
            date=date(2026, 11, 6), source_type="지출", flow="expense", major_category="식비",
            minor_category="점심", description="테스트 거래", amount=Decimal("12500.1234"),
            currency="KRW", payment_method="테스트카드", fingerprint="abc123",
        )
        session.add(row)
        session.commit()
        assert session.get(Transaction, row.id).amount == Decimal("12500.1234")
        session.add(Transaction(
            date=date(2026, 11, 6), source_type="지출", flow="expense", description="중복",
            amount=Decimal(1), currency="KRW", payment_method="현금", fingerprint="abc123",
        ))
        with pytest.raises(IntegrityError):
            session.commit()


def test_mapping_models_persist_exact_labels() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add_all([
            TransactionTypeMapping(source_type="이체", flow="transfer"),
            PaymentMethodMapping(source_label="내 카드", card_kind="credit"),
            ImportBatch(file_name="expense-2026-11-06.xlsx", inserted_count=1, duplicate_count=0),
        ])
        session.commit()
        assert session.query(TransactionTypeMapping).one().flow == "transfer"
        assert session.query(PaymentMethodMapping).one().card_kind == "credit"


def test_transaction_schema_rejects_unknown_flow_and_accepts_decimal() -> None:
    values = {
        "date": "2026-11-06",
        "source_type": "입금",
        "flow": "income",
        "amount": "0.1234",
        "currency": "KRW",
        "payment_method": "급여",
        "description": "급여",
        "fingerprint": "f" * 64,
    }
    assert TransactionCreate(**values).amount == Decimal("0.1234")
    with pytest.raises(ValueError):
        TransactionCreate(**{**values, "flow": "other"})
