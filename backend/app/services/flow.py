"""원본 타입 → 집계 흐름 판정. 프론트 `src/domain/transaction.ts`의 deriveFlow와 같은 규칙."""

from collections.abc import Mapping
from decimal import Decimal
from typing import Literal

Flow = Literal["income", "expense", "transfer", "refund", "needs_review"]
FlowSource = Literal["auto", "manual"]

DEFAULT_TYPE_FLOWS: dict[str, Flow] = {"수입": "income", "지출": "expense", "이체": "transfer"}


def mapped_flow(source_type: str, mappings: Mapping[str, Flow]) -> Flow | None:
    """사용자 매핑 → 기본 매핑 순으로 찾는다. 없으면 None."""
    return mappings.get(source_type) or DEFAULT_TYPE_FLOWS.get(source_type)


def derive_flow(source_type: str, amount: Decimal, mappings: Mapping[str, Flow]) -> Flow:
    """
    흐름을 정한다. 모르는 타입이나 타입과 부호가 맞지 않는 행(양수 지출, 음수 수익)은
    환불 등으로 추정하지 않고 `needs_review`로 둔다.
    """
    flow = mapped_flow(source_type, mappings)
    if flow is None:
        return "needs_review"
    if (flow == "expense" and amount > 0) or (flow == "income" and amount < 0):
        return "needs_review"
    return flow
