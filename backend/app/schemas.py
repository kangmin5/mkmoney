"""API 입출력 스키마. 모든 입력은 명시적으로 검증하고 알 수 없는 필드는 거부한다."""

from datetime import date, datetime
from datetime import time as datetime_time
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

Flow = Literal["income", "expense", "transfer", "refund", "reimbursement", "needs_review"]
CardKind = Literal["credit", "debit", "account", "prepaid", "point", "other"]
RuleDirection = Literal["in", "out", "any"]
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
    # 사용자 분류 이름(규칙 제안 또는 사용자 지정). 원본 대·소분류와 별도로 보존된다.
    user_category: str | None = Field(default=None, min_length=1, max_length=120)
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
    user_category: str | None


class TransactionPage(BaseModel):
    """페이지네이션된 거래 목록."""

    items: list[TransactionRead]
    total: int
    limit: int
    offset: int


class FlowUpdate(StrictModel):
    """행 단위 흐름 지정(사용자 분류). `auto`로 되돌리면 타입 매핑을 다시 따른다."""

    flow: Flow | None = Field(default=None, description="null이면 자동(타입 매핑)으로 되돌린다")
    # 보내지 않으면 유지, null이면 지움, 문자열이면 지정
    user_category: str | None = Field(default=None, min_length=1, max_length=120)


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
    reimbursement: Decimal
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
    """분류 합계. category는 사용자 분류 이름이 있으면 그것, 없으면 원본 대분류."""

    currency: str
    category: str | None
    user_category: str | None
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
    card_kind: Literal["credit", "debit", "account", "prepaid", "point", "other", "unmapped"]
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


# ── 백업·복원 ───────────────────────────────────────────────
MAX_RESTORE_ROWS = 200_000


class BackupTypeMapping(StrictModel):
    """백업에 담기는 타입 매핑."""

    source_type: str = Field(min_length=1, max_length=120)
    flow: Flow


class BackupPaymentMapping(StrictModel):
    """백업에 담기는 결제수단 매핑."""

    source_label: str = Field(min_length=1, max_length=200)
    card_kind: CardKind


class BackupPayload(BaseModel):
    """암호화 전 백업 내용(브라우저가 암호화한다). 버전이 바뀌면 version을 올린다."""

    format: Literal["mkmoney-backup"] = "mkmoney-backup"
    version: Literal[1, 2] = 2
    exported_at: datetime
    app_version: str
    transactions: list[TransactionCreate]
    type_mappings: list[BackupTypeMapping]
    payment_mappings: list[BackupPaymentMapping]
    rules: list["RuleCreate"] = Field(default_factory=list)


class RestoreRequest(StrictModel):
    """복원 승인 요청: 신규 행과 매핑(없는 것만 추가)."""

    file_name: str = Field(min_length=1, max_length=255)
    rows: list[TransactionCreate] = Field(max_length=MAX_RESTORE_ROWS)
    type_mappings: list[BackupTypeMapping] = Field(default_factory=list, max_length=10_000)
    payment_mappings: list[BackupPaymentMapping] = Field(default_factory=list, max_length=10_000)
    rules: list["RuleCreate"] = Field(default_factory=list, max_length=1_000)


class RestoreResult(BaseModel):
    """복원 결과."""

    batch_id: UUID
    inserted: int
    duplicate: int
    type_mappings_added: int
    payment_mappings_added: int
    rules_added: int = 0


# ── 분류 규칙 ───────────────────────────────────────────────
class RuleCreate(StrictModel):
    """분류 규칙 입력. 조건이 모두 맞으면 flow·user_category를 제안/적용한다."""

    name: str = Field(min_length=1, max_length=80)
    enabled: bool = True
    description_contains: str = Field(min_length=1, max_length=200)
    source_type: str | None = Field(default=None, min_length=1, max_length=120)
    direction: RuleDirection = "any"
    min_amount: Decimal | None = Field(default=None, ge=0, max_digits=20, decimal_places=4)
    max_amount: Decimal | None = Field(default=None, gt=0, max_digits=20, decimal_places=4)
    flow: Flow
    user_category: str | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def _check_range(self) -> "RuleCreate":
        """이상(min) < 미만(max)이어야 한다."""
        if self.min_amount is not None and self.max_amount is not None and self.min_amount >= self.max_amount:
            raise ValueError("min_amount must be less than max_amount")
        return self


class RuleRead(RuleCreate):
    """저장된 규칙."""

    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: UUID
    position: int


class RuleOrder(StrictModel):
    """규칙 순서(위에서부터 먼저 적용)."""

    ids: list[UUID] = Field(max_length=1_000)


class RuleApplyCount(BaseModel):
    """규칙별 일치 건수."""

    rule_id: UUID
    name: str
    count: int


class FlowChange(BaseModel):
    """흐름 변화 요약."""

    from_flow: Flow
    to_flow: Flow
    count: int


class RuleApplyPreview(BaseModel):
    """기존 거래 적용 미리보기(대상: 자동 분류이고 사용자 분류가 없는 행)."""

    matched: int
    by_rule: list[RuleApplyCount]
    flow_changes: list[FlowChange]


class RuleApplyResult(BaseModel):
    """기존 거래 적용 결과."""

    updated: int


# 앞쪽 참조(RuleCreate) 확정
BackupPayload.model_rebuild()
RestoreRequest.model_rebuild()
