"""
사용자 분류 규칙: 일치 판정(프론트 `src/domain/rules.ts`와 같은 규칙), 저장, 기존 거래 적용.
규칙은 사용자가 명시적으로 만든 것만 쓰며, 기존 거래 적용은 미리보기 후 승인으로만 실행한다.
"""

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import cast
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import ClassificationRule, Transaction
from app.schemas import (
    FlowChange,
    RuleApplyCount,
    RuleApplyPreview,
    RuleApplyResult,
    RuleCreate,
    RuleRead,
)
from app.services.fingerprint import normalize_text
from app.services.flow import Flow


class RuleNotFoundError(LookupError):
    """규칙이 없음."""


class RuleConflictError(ValueError):
    """같은 이름의 규칙이 이미 있음."""


@dataclass(frozen=True)
class RuleSpec:
    """일치 판정에 필요한 규칙 조건과 결과."""

    id: UUID | None
    name: str
    description_contains: str
    source_type: str | None
    direction: str
    min_amount: Decimal | None
    max_amount: Decimal | None
    flow: Flow
    user_category: str | None


def _fold(text: str | None) -> str:
    """비교용 정규화: NFC + 앞뒤 공백 제거 + 소문자."""
    return normalize_text(text).lower()


def matches(rule: RuleSpec, *, description: str, source_type: str, amount: Decimal) -> bool:
    """
    규칙 조건이 모두 맞는지.
    - 내용 포함(대소문자 무시), 원본 타입 일치(지정 시)
    - 방향: in=양수, out=음수, any=전체(0원은 in·out 모두 아님)
    - 금액(절댓값): min 이상, max 미만
    """
    if _fold(rule.description_contains) not in _fold(description):
        return False
    if rule.source_type is not None and normalize_text(rule.source_type) != normalize_text(source_type):
        return False
    if rule.direction == "in" and not amount > 0:
        return False
    if rule.direction == "out" and not amount < 0:
        return False
    magnitude = abs(amount)
    if rule.min_amount is not None and magnitude < rule.min_amount:
        return False
    return not (rule.max_amount is not None and magnitude >= rule.max_amount)


def first_match(
    rules: Sequence[RuleSpec], *, description: str, source_type: str, amount: Decimal
) -> RuleSpec | None:
    """순서상 처음 일치하는 규칙."""
    for rule in rules:
        if matches(rule, description=description, source_type=source_type, amount=amount):
            return rule
    return None


def _spec(rule: ClassificationRule) -> RuleSpec:
    return RuleSpec(
        id=rule.id,
        name=rule.name,
        description_contains=rule.description_contains,
        source_type=rule.source_type,
        direction=rule.direction,
        min_amount=rule.min_amount,
        max_amount=rule.max_amount,
        flow=cast(Flow, rule.flow),
        user_category=rule.user_category,
    )


# ── 저장 ─────────────────────────────────────────────────────
def list_rules(session: Session) -> list[RuleRead]:
    """규칙 목록(적용 순서)."""
    rows = session.scalars(
        select(ClassificationRule).order_by(ClassificationRule.position, ClassificationRule.created_at)
    )
    return [RuleRead.model_validate(row) for row in rows]


def _enabled_specs(session: Session) -> list[RuleSpec]:
    rows = session.scalars(
        select(ClassificationRule)
        .where(ClassificationRule.enabled.is_(True))
        .order_by(ClassificationRule.position, ClassificationRule.created_at)
    )
    return [_spec(row) for row in rows]


def _ensure_unique_name(session: Session, name: str, exclude: UUID | None = None) -> None:
    query = select(ClassificationRule.id).where(ClassificationRule.name == name)
    if exclude is not None:
        query = query.where(ClassificationRule.id != exclude)
    if session.scalar(query) is not None:
        raise RuleConflictError("같은 이름의 규칙이 이미 있습니다.")


def add_rule(session: Session, data: RuleCreate, *, commit: bool = True) -> ClassificationRule:
    """규칙을 맨 뒤 순서로 추가한다."""
    _ensure_unique_name(session, data.name)
    position = (session.scalar(select(func.max(ClassificationRule.position))) or 0) + 1
    rule = ClassificationRule(position=position, **data.model_dump())
    session.add(rule)
    if commit:
        session.commit()
    else:
        session.flush()
    return rule


def update_rule(session: Session, rule_id: UUID, data: RuleCreate) -> ClassificationRule:
    """규칙을 수정한다. 이미 저장된 거래는 바뀌지 않는다."""
    rule = session.get(ClassificationRule, rule_id)
    if rule is None:
        raise RuleNotFoundError
    _ensure_unique_name(session, data.name, exclude=rule_id)
    for key, value in data.model_dump().items():
        setattr(rule, key, value)
    session.commit()
    return rule


def delete_rule(session: Session, rule_id: UUID) -> None:
    """규칙을 삭제한다. 이미 저장된 거래는 바뀌지 않는다."""
    rule = session.get(ClassificationRule, rule_id)
    if rule is None:
        raise RuleNotFoundError
    session.delete(rule)
    session.commit()


def reorder_rules(session: Session, ids: Sequence[UUID]) -> None:
    """주어진 순서대로 position을 다시 매긴다(목록에 없는 규칙은 뒤로)."""
    rules = {r.id: r for r in session.scalars(select(ClassificationRule))}
    if set(ids) - set(rules):
        raise RuleNotFoundError
    ordered = list(ids) + [rid for rid in sorted(rules, key=lambda r: rules[r].position) if rid not in ids]
    for index, rid in enumerate(ordered, start=1):
        rules[rid].position = index
    session.commit()


# ── 기존 거래 적용 ───────────────────────────────────────────
def _candidates(session: Session) -> list[tuple[UUID, str, str, Decimal, str]]:
    """적용 대상: 자동 분류이고 사용자 분류가 없는 행."""
    rows = session.execute(
        select(
            Transaction.id, Transaction.description, Transaction.source_type, Transaction.amount, Transaction.flow
        ).where(Transaction.flow_source == "auto", Transaction.user_category.is_(None))
    ).all()
    return [(r[0], r[1], r[2], r[3], r[4]) for r in rows]


def _plan(session: Session) -> list[tuple[UUID, str, RuleSpec]]:
    specs = _enabled_specs(session)
    if not specs:
        return []
    plan: list[tuple[UUID, str, RuleSpec]] = []
    for tx_id, description, source_type, amount, flow in _candidates(session):
        rule = first_match(specs, description=description, source_type=source_type, amount=amount)
        if rule is not None:
            plan.append((tx_id, flow, rule))
    return plan


def preview_apply(session: Session) -> RuleApplyPreview:
    """적용하면 바뀔 건수(규칙별·흐름 변화별). 아무것도 바꾸지 않는다."""
    plan = _plan(session)
    by_rule = Counter((rule.id, rule.name) for _, _, rule in plan)
    changes = Counter((old, rule.flow) for _, old, rule in plan)
    return RuleApplyPreview(
        matched=len(plan),
        by_rule=[RuleApplyCount(rule_id=rid, name=name, count=n) for (rid, name), n in by_rule.items() if rid],
        flow_changes=[
            FlowChange(from_flow=cast(Flow, old), to_flow=new, count=n) for (old, new), n in changes.items()
        ],
    )


def apply_rules(session: Session) -> RuleApplyResult:
    """
    승인된 적용: 일치하는 행의 흐름·사용자 분류를 규칙대로 지정하고 manual로 표시한다(한 트랜잭션).
    원본 값(타입·대분류·소분류·금액·내용)은 바꾸지 않는다.
    """
    plan = _plan(session)
    try:
        groups: dict[tuple[str, str | None], list[UUID]] = {}
        for tx_id, _, rule in plan:
            groups.setdefault((rule.flow, rule.user_category), []).append(tx_id)
        for (flow, user_category), ids in groups.items():
            for start in range(0, len(ids), 1000):
                session.execute(
                    update(Transaction)
                    .where(
                        Transaction.id.in_(ids[start : start + 1000]),
                        Transaction.flow_source == "auto",
                        Transaction.user_category.is_(None),
                    )
                    .values(flow=flow, user_category=user_category, flow_source="manual")
                )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return RuleApplyResult(updated=len(plan))
