/**
 * 거래 도메인 공용 타입과 흐름(집계 방향) 판정 규칙.
 * 백엔드 `app/services/flow.py`와 같은 규칙을 유지해야 한다.
 */

/** 집계상 거래 성격. `needs_review`는 사용자가 정하기 전까지 합계에서 제외한다. */
export type Flow = "income" | "expense" | "transfer" | "refund" | "reimbursement" | "needs_review";

/** 사용자가 지정할 수 있는 흐름 목록(표시 순서). */
export const FLOWS: readonly Flow[] = ["income", "expense", "transfer", "refund", "reimbursement", "needs_review"];

/** 흐름 한국어 라벨. */
export const FLOW_LABELS: Record<Flow, string> = {
  income: "수익",
  expense: "지출",
  transfer: "이체",
  refund: "환불",
  reimbursement: "경비 정산",
  needs_review: "미분류",
};

/** 결제수단 종류. 카드 합계는 credit·debit만 센다. */
export type CardKind = "credit" | "debit" | "account" | "prepaid" | "point" | "other";

/** 결제수단 종류 목록(표시 순서). */
export const CARD_KINDS: readonly CardKind[] = ["credit", "debit", "account", "prepaid", "point", "other"];

/** 원본 타입 → 흐름 기본 매핑. 사용자 저장 매핑이 있으면 그것이 우선한다. */
export const DEFAULT_TYPE_FLOWS: Readonly<Record<string, Flow>> = {
  수입: "income",
  지출: "expense",
  이체: "transfer",
};

/** 가져오기 행의 정규화 결과. 값은 브라우저 메모리에만 있고 승인 전에는 전송하지 않는다. */
export interface ParsedRow {
  /** 엑셀 행 번호(헤더가 1행). */
  sourceRow: number;
  /** `YYYY-MM-DD`, 해석 실패 시 빈 문자열. */
  date: string;
  /** `HH:MM:SS`, 없으면 빈 문자열. */
  time: string;
  sourceType: string;
  majorCategory: string;
  minorCategory: string;
  description: string;
  /** 부호를 보존한 정규 십진 문자열. 해석 실패 시 빈 문자열. */
  amount: string;
  currency: string;
  paymentMethod: string;
  memo: string;
  flow: Flow;
  /** 행 값이 들어가지 않는 검증 코드 목록. */
  validationCodes: string[];
}

/** 저장할 수 없는 오류 코드. 나머지 코드는 검토 필요(저장은 가능)다. */
export const ERROR_CODES: ReadonlySet<string> = new Set([
  "invalid_date",
  "invalid_time",
  "invalid_amount",
  "invalid_currency",
  "missing_type",
  "missing_description",
  "missing_payment_method",
  "too_long",
]);

/** 검증 코드 한국어 설명. */
export const VALIDATION_LABELS: Record<string, string> = {
  invalid_date: "날짜 형식 오류",
  invalid_time: "시간 형식 오류",
  invalid_amount: "금액 형식 오류",
  invalid_currency: "화폐 형식 오류",
  missing_type: "타입 없음",
  missing_description: "내용 없음",
  missing_payment_method: "결제수단 없음",
  too_long: "값이 너무 김",
  unknown_type: "알 수 없는 타입",
  sign_mismatch: "타입과 금액 부호 불일치(환불 여부 확인)",
};

/**
 * 원본 타입과 금액 부호로 흐름을 정한다.
 * 모르는 타입, 부호가 타입과 맞지 않는 행(양수 지출·음수 수익)은 추정하지 않고 검토 대상으로 둔다.
 * @param sourceType 정규화한 원본 타입
 * @param amount 정규 십진 문자열(빈 문자열이면 부호 검사 생략)
 * @param mappings 사용자 저장 매핑(기본 매핑보다 우선)
 */
export function deriveFlow(
  sourceType: string,
  amount: string,
  mappings: Readonly<Record<string, Flow>> = {},
): { flow: Flow; codes: string[] } {
  const mapped = mappings[sourceType] ?? DEFAULT_TYPE_FLOWS[sourceType];
  if (!mapped) return { flow: "needs_review", codes: ["unknown_type"] };
  const negative = amount.startsWith("-");
  const positive = amount !== "" && !negative && amount !== "0";
  if ((mapped === "expense" && positive) || (mapped === "income" && negative)) {
    return { flow: "needs_review", codes: ["sign_mismatch"] };
  }
  return { flow: mapped, codes: [] };
}
