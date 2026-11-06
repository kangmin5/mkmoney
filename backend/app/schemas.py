"""API 입출력 스키마. 모든 입력은 명시적으로 검증하고 알 수 없는 필드는 거부한다."""

from datetime import date, datetime
from datetime import time as datetime_time
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

Flow = Literal["income", "expense", "transfer", "refund", "needs_review"]
CardKind = Literal["credit", "debit", "other"]
FINGERPRINT_PATTERN = r"^[a-f0-9]{64}$"
MAX_IMPORT_ROWS = 20_000
Fingerprint = Annotated[str, Field(pattern=FINGERPRINT_PATTERN)]


class StrictModel(BaseModel):
    """알 수 없는 필드를 거부하는 기본 모델."""

    model_config = ConfigDict(extra="forbid")


class TransactionCreate(StrictModel):
    """승인된 가져오기 행. 서버가 지문을 다시 계산해 일치를 확인한다."""

    date: date
    time: datetime_time | None = None
    source_type: str = Field(min_length=1, max_length=120)
    flow: Flow
    major_category: str | None = Field(default=None, max_length=120)
    minor_category: str | None = Field(default=None, max_length=120)
    description: str = Field(min_length=1, max_length=500)
    amount: Decimal = Field(max_digits=20, decimal_places=4)
    currency: str = Field(min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    payment_method: str = Field(min_length=1, max_length=200)
    memo: str | None = Field(default=None, max_length=1000)
    fingerprint: str = Field(pattern=FINGERPRINT_PATTERN)


class TransactionRead(BaseModel):
    """거래 조회 응답."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    date: date
    time: datetime_time | None
    source_type: str
    flow: Flow
    flow_source: Literal["auto", "manual"]
    major_category: str | None
    minor_category: str | None
    description: str
    amount: Decimal
    currency: str
    payment_method: str
    memo: str | None


class TransactionPage(BaseModel):
    """페이지네이션된 거래 목록."""

    items: list[TransactionRead]
    total: int
    limit: int
    offset: int


class FlowUpdate(StrictModel):
    """행 단위 흐름 지정(사용자 분류). `auto`로 되돌리면 타입 매핑을 다시 따른다."""

    flow: Flow | None = Field(default=None, description="null이면 자동(타입 매핑)으로 되돌린다")


# ── 인증 ─────────────────────────────────────────────────────
class LoginRequest(StrictModel):
    """로그인 요청."""

    password: str = Field(min_length=1, max_length=256)


class AuthStatus(BaseModel):
    """세션 인증 여부만 반환한다."""

    authenticated: bool


# ── 가져오기 ─────────────────────────────────────────────────
class FingerprintCheckRequest(StrictModel):
    """중복 확인 요청: 지문만 받는다(거래 필드 없음)."""

    fingerprints: list[Fingerprint] = Field(max_length=MAX_IMPORT_ROWS)


class FingerprintCheckResponse(BaseModel):
    """이미 저장된 지문 목록."""

    existing: list[str]


class ImportSummary(StrictModel):
    """브라우저 미리보기에서 저장하지 않은 행의 건수(요약 기록용)."""

    in_file_duplicate: int = Field(default=0, ge=0, le=MAX_IMPORT_ROWS)
    review: int = Field(default=0, ge=0, le=MAX_IMPORT_ROWS)
    error: int = Field(default=0, ge=0, le=MAX_IMPORT_ROWS)


class ImportRequest(StrictModel):
    """승인된 신규 행 묶음."""

    file_name: str = Field(min_length=1, max_length=255)
    rows: list[TransactionCreate] = Field(min_length=1, max_length=MAX_IMPORT_ROWS)
    summary: ImportSummary = Field(default_factory=ImportSummary)


class ImportResult(BaseModel):
    """가져오기 반영 결과."""

    batch_id: UUID
    inserted: int
    duplicate: int


class ImportBatchRead(BaseModel):
    """최근 가져오기 요약."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    file_name: str
    imported_at: datetime
    inserted_count: int
    duplicate_count: int
    in_file_duplicate_count: int
    review_count: int
    error_count: int


# ── 매핑 ─────────────────────────────────────────────────────
class TypeMappingRead(BaseModel):
    """원본 타입별 흐름 상태."""

    source_type: str
    flow: Flow | None = Field(description="저장된 사용자 매핑(없으면 null)")
    default_flow: Flow | None = Field(description="내장 기본 매핑(없으면 null)")
    transaction_count: int


class TypeMappingUpdate(StrictModel):
    """원본 타입 매핑 저장."""

    source_type: str = Field(min_length=1, max_length=120)
    flow: Flow


class PaymentMethodMappingRead(BaseModel):
    """결제수단 라벨별 카드 종류 상태."""

    source_label: str
    card_kind: CardKind | None
    transaction_count: int


class PaymentMethodMappingUpdate(StrictModel):
    """결제수단 매핑 저장."""

    source_label: str = Field(min_length=1, max_length=200)
    card_kind: CardKind


# ── 집계 ─────────────────────────────────────────────────────
class FlowTotals(BaseModel):
    """한 기간·한 통화의 합계(금액은 십진 문자열로 직렬화)."""

    income: Decimal
    gross_expense: Decimal
    refund: Decimal
    net_expense: Decimal
    net_cashflow: Decimal


class CurrencySummary(BaseModel):
    """통화별 현재·비교·차이."""

    currency: str
    current: FlowTotals
    previous: FlowTotals
    delta: FlowTotals


class SummaryResponse(BaseModel):
    """기간 요약. 비교 기준과 기간을 함께 반환해 화면에 표시한다."""

    start: date
    end: date
    comparison_mode: Literal["previous_month", "same_range", "previous_period"]
    comparison_start: date
    comparison_end: date
    currencies: list[CurrencySummary]
    unresolved_count: int
    transfer_count: int
    card_settlement_count: int


class CategoryTotal(BaseModel):
    """원본 대·소분류 합계."""

    currency: str
    major_category: str | None
    minor_category: str | None
    total: Decimal
    count: int


class PaymentMethodUsage(BaseModel):
    """결제수단별 구매·환불·순사용액."""

    payment_method: str
    currency: str
    card_kind: CardKind | None
    purchase: Decimal
    refund: Decimal
    net: Decimal
    count: int


class CardKindUsage(BaseModel):
    """카드 종류별 합계. `unmapped`는 사용자 분류가 필요한 라벨."""

    currency: str
    card_kind: Literal["credit", "debit", "other", "unmapped"]
    purchase: Decimal
    refund: Decimal
    net: Decimal


class CardsResponse(BaseModel):
    """카드 사용 화면 데이터."""

    start: date
    end: date
    methods: list[PaymentMethodUsage]
    by_kind: list[CardKindUsage]


class MonthlyFlow(BaseModel):
    """월별 흐름 한 점."""

    month: str
    currency: str
    income: Decimal
    net_expense: Decimal
