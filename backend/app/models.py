"""SQLAlchemy ORM 엔티티. 스키마 변경은 반드시 Alembic 마이그레이션과 함께 한다."""

from datetime import UTC, date, datetime
from datetime import time as datetime_time
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy import (
    Time as TimeType,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """ORM 기반 클래스."""


class Transaction(Base):
    """승인된 정규화 거래. 가져오기는 추가만 하고 기존 행을 수정하지 않는다."""

    __tablename__ = "transactions"
    __table_args__ = (
        UniqueConstraint("fingerprint", name="uq_transactions_fingerprint"),
        CheckConstraint(
            "flow IN ('income', 'expense', 'transfer', 'refund', 'needs_review')",
            name="ck_transactions_flow",
        ),
        CheckConstraint("flow_source IN ('auto', 'manual')", name="ck_transactions_flow_source"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    time: Mapped[datetime_time | None] = mapped_column(TimeType, nullable=True)
    source_type: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    flow: Mapped[str] = mapped_column(String(20), nullable=False)
    # auto: 타입 매핑으로 정해짐(매핑 변경 시 재계산), manual: 사용자가 행 단위로 지정
    flow_source: Mapped[str] = mapped_column(
        String(10), nullable=False, default="auto", server_default="auto"
    )
    major_category: Mapped[str | None] = mapped_column(String(120))
    minor_category: Mapped[str | None] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(20, 4), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(200), nullable=False)
    memo: Mapped[str | None] = mapped_column(String(1000))
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


class TransactionTypeMapping(Base):
    """원본 타입 → 집계 흐름 사용자 매핑."""

    __tablename__ = "transaction_type_mappings"
    __table_args__ = (
        CheckConstraint(
            "flow IN ('income', 'expense', 'transfer', 'refund', 'needs_review')",
            name="ck_type_mapping_flow",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    source_type: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    flow: Mapped[str] = mapped_column(String(20), nullable=False)


class PaymentMethodMapping(Base):
    """원본 결제수단 라벨 → 카드 종류 사용자 매핑."""

    __tablename__ = "payment_method_mappings"
    __table_args__ = (
        CheckConstraint("card_kind IN ('credit', 'debit', 'other')", name="ck_payment_card_kind"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    source_label: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    card_kind: Mapped[str] = mapped_column(String(10), nullable=False)


class ImportBatch(Base):
    """가져오기 1회 요약(건수만, 거래 내용 없음)."""

    __tablename__ = "import_batches"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True, default=lambda: datetime.now(UTC)
    )
    inserted_count: Mapped[int] = mapped_column(Integer, nullable=False)
    duplicate_count: Mapped[int] = mapped_column(Integer, nullable=False)
    in_file_duplicate_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    review_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
