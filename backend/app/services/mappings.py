"""타입·결제수단 매핑 조회와 저장. 타입 매핑 변경 시 auto 행의 흐름을 함께 재계산한다."""

from typing import cast

from sqlalchemy import case, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.models import PaymentMethodMapping, Transaction, TransactionTypeMapping
from app.schemas import (
    CardKind,
    PaymentMethodMappingRead,
    PaymentMethodMappingUpdate,
    TypeMappingRead,
    TypeMappingUpdate,
)
from app.services.flow import DEFAULT_TYPE_FLOWS, Flow


def load_type_mappings(session: Session) -> dict[str, Flow]:
    """저장된 사용자 타입 매핑."""
    rows = session.execute(select(TransactionTypeMapping.source_type, TransactionTypeMapping.flow))
    return {source: cast(Flow, flow) for source, flow in rows}


def list_type_mappings(session: Session) -> list[TypeMappingRead]:
    """거래에 나온 타입 ∪ 저장 매핑 ∪ 기본 매핑을 한 목록으로."""
    counts = dict(
        session.execute(
            select(Transaction.source_type, func.count()).group_by(Transaction.source_type)
        ).all()
    )
    saved = load_type_mappings(session)
    names = sorted(set(counts) | set(saved) | set(DEFAULT_TYPE_FLOWS))
    return [
        TypeMappingRead(
            source_type=name,
            flow=saved.get(name),
            default_flow=DEFAULT_TYPE_FLOWS.get(name),
            transaction_count=counts.get(name, 0),
        )
        for name in names
    ]


def _recompute_auto_flows(session: Session, source_type: str, flow: Flow) -> int:
    """같은 원본 타입의 auto 행 흐름을 매핑대로 다시 계산한다(manual 행 유지, 커밋 안 함)."""
    new_flow: ColumnElement[str] | str = flow
    if flow == "expense":
        new_flow = case((Transaction.amount > 0, "needs_review"), else_="expense")
    elif flow == "income":
        new_flow = case((Transaction.amount < 0, "needs_review"), else_="income")
    result = session.execute(
        update(Transaction)
        .where(Transaction.source_type == source_type, Transaction.flow_source == "auto")
        .values(flow=new_flow)
    )
    return int(getattr(result, "rowcount", 0) or 0)


def save_type_mapping(session: Session, change: TypeMappingUpdate) -> int:
    """
    매핑을 저장하고 같은 원본 타입의 auto 행 흐름을 다시 계산한다(manual 행은 유지).
    부호가 맞지 않는 행은 기존 규칙대로 needs_review로 둔다. 갱신된 행 수를 돌려준다.
    """
    try:
        session.execute(
            insert(TransactionTypeMapping)
            .values(source_type=change.source_type, flow=change.flow)
            .on_conflict_do_update(index_elements=["source_type"], set_={"flow": change.flow})
        )
        updated = _recompute_auto_flows(session, change.source_type, change.flow)
        session.commit()
    except Exception:
        session.rollback()
        raise
    return updated


def add_type_mapping_if_absent(session: Session, source_type: str, flow: Flow) -> bool:
    """저장된 매핑이 없을 때만 추가하고 auto 행을 재계산한다(복원용, 커밋 안 함)."""
    added = session.execute(
        insert(TransactionTypeMapping)
        .values(source_type=source_type, flow=flow)
        .on_conflict_do_nothing(index_elements=["source_type"])
        .returning(TransactionTypeMapping.id)
    ).first()
    if added is None:
        return False
    _recompute_auto_flows(session, source_type, flow)
    return True


def add_payment_mapping_if_absent(session: Session, source_label: str, card_kind: str) -> bool:
    """저장된 결제수단 매핑이 없을 때만 추가한다(복원용, 커밋 안 함)."""
    added = session.execute(
        insert(PaymentMethodMapping)
        .values(source_label=source_label, card_kind=card_kind)
        .on_conflict_do_nothing(index_elements=["source_label"])
        .returning(PaymentMethodMapping.id)
    ).first()
    return added is not None


def list_payment_mappings(session: Session) -> list[PaymentMethodMappingRead]:
    """거래에 나온 결제수단 라벨 ∪ 저장 매핑."""
    counts = dict(
        session.execute(
            select(Transaction.payment_method, func.count()).group_by(Transaction.payment_method)
        ).all()
    )
    saved = dict(
        session.execute(
            select(PaymentMethodMapping.source_label, PaymentMethodMapping.card_kind)
        ).all()
    )
    return [
        PaymentMethodMappingRead(
            source_label=label,
            card_kind=cast(CardKind | None, saved.get(label)),
            transaction_count=counts.get(label, 0),
        )
        for label in sorted(set(counts) | set(saved))
    ]


def save_payment_mapping(session: Session, change: PaymentMethodMappingUpdate) -> None:
    """결제수단 라벨의 카드 종류를 저장한다(라벨로 추측하지 않고 사용자 지정만 저장)."""
    try:
        session.execute(
            insert(PaymentMethodMapping)
            .values(source_label=change.source_label, card_kind=change.card_kind)
            .on_conflict_do_update(
                index_elements=["source_label"], set_={"card_kind": change.card_kind}
            )
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
