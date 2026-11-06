"""백업 내보내기와 병합 복원. 복원은 추가만 하며 기존 거래·매핑을 덮어쓰거나 삭제하지 않는다."""

from datetime import UTC, datetime
from typing import cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import __version__
from app.models import (
    ClassificationRule,
    ImportBatch,
    PaymentMethodMapping,
    Transaction,
    TransactionTypeMapping,
)
from app.schemas import (
    BackupPayload,
    BackupPaymentMapping,
    BackupTypeMapping,
    CardKind,
    RestoreRequest,
    RestoreResult,
    RuleCreate,
    TransactionCreate,
)
from app.services.flow import Flow
from app.services.imports import insert_rows, verify_fingerprints
from app.services.mappings import add_payment_mapping_if_absent, add_type_mapping_if_absent
from app.services.rules import add_rule, list_rules


def export_payload(session: Session) -> BackupPayload:
    """저장된 거래와 사용자 매핑 전체(날짜순)."""
    transactions = [
        TransactionCreate(
            date=row.date,
            time=row.time,
            source_type=row.source_type,
            flow=cast(Flow, row.flow),
            major_category=row.major_category,
            minor_category=row.minor_category,
            description=row.description,
            amount=row.amount,
            currency=row.currency,
            payment_method=row.payment_method,
            memo=row.memo,
            user_category=row.user_category,
            fingerprint=row.fingerprint,
        )
        for row in session.scalars(
            select(Transaction).order_by(Transaction.date, Transaction.time, Transaction.created_at)
        )
    ]
    type_mappings = [
        BackupTypeMapping(source_type=m.source_type, flow=cast(Flow, m.flow))
        for m in session.scalars(select(TransactionTypeMapping).order_by(TransactionTypeMapping.source_type))
    ]
    payment_mappings = [
        BackupPaymentMapping(source_label=m.source_label, card_kind=cast(CardKind, m.card_kind))
        for m in session.scalars(select(PaymentMethodMapping).order_by(PaymentMethodMapping.source_label))
    ]
    rules = [
        RuleCreate.model_validate(rule.model_dump(exclude={"id", "position"}))
        for rule in list_rules(session)
    ]
    return BackupPayload(
        version=2,
        exported_at=datetime.now(UTC),
        app_version=__version__,
        transactions=transactions,
        type_mappings=type_mappings,
        payment_mappings=payment_mappings,
        rules=rules,
    )


def restore(session: Session, request: RestoreRequest) -> RestoreResult:
    """
    한 트랜잭션으로 병합한다: 없는 매핑·규칙(이름 기준)만 추가 → 신규 거래만 추가 → 기록.
    지문 불일치나 DB 오류가 있으면 전체를 되돌린다.
    """
    verify_fingerprints(request.rows)
    try:
        type_added = sum(
            add_type_mapping_if_absent(session, m.source_type, m.flow) for m in request.type_mappings
        )
        payment_added = sum(
            add_payment_mapping_if_absent(session, m.source_label, m.card_kind)
            for m in request.payment_mappings
        )
        existing_names = set(session.scalars(select(ClassificationRule.name)))
        rules_added = 0
        for rule in request.rules:
            if rule.name not in existing_names:
                add_rule(session, rule, commit=False)
                existing_names.add(rule.name)
                rules_added += 1
        inserted = insert_rows(session, request.rows) if request.rows else 0
        batch = ImportBatch(
            file_name=request.file_name,
            inserted_count=inserted,
            duplicate_count=len(request.rows) - inserted,
        )
        session.add(batch)
        session.commit()
    except Exception:
        session.rollback()
        raise
    return RestoreResult(
        batch_id=batch.id,
        inserted=inserted,
        duplicate=len(request.rows) - inserted,
        type_mappings_added=type_added,
        payment_mappings_added=payment_added,
        rules_added=rules_added,
    )
