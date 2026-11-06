/**
 * 가져오기 승인 계획(순수 함수). 검토 화면의 선택을 반영해 저장할 행과 요약 건수를 만든다.
 */
import type { ImportSummary, TransactionCreate } from "../api/client";
import { deriveFlow, type Flow } from "../domain/transaction";
import { buildPreview, type FingerprintedRow, type PreviewRow, type PreviewStatus } from "./preview";

/** 흐름 판정에서 나오는 검토 코드(매핑이 바뀌면 다시 계산). */
const FLOW_CODES = new Set(["unknown_type", "sign_mismatch"]);

/**
 * 타입 매핑이 바뀌었을 때 행의 흐름과 검토 코드를 다시 계산한다(지문은 흐름과 무관하므로 그대로).
 * @param rows 지문이 붙은 파싱 행
 * @param mappings 사용자 저장 타입 매핑
 */
export function reclassify(rows: readonly FingerprintedRow[], mappings: Readonly<Record<string, Flow>>): FingerprintedRow[] {
  return rows.map((row) => {
    const kept = row.validationCodes.filter((code) => !FLOW_CODES.has(code));
    if (!row.sourceType) return { ...row, validationCodes: kept };
    const derived = deriveFlow(row.sourceType, row.amount, mappings);
    return { ...row, flow: derived.flow, validationCodes: [...kept, ...derived.codes] };
  });
}

/** 사용자가 행 단위로 지정한 흐름(엑셀 행 번호 → 흐름). */
export type FlowOverrides = ReadonlyMap<number, Flow>;

/** 검토 화면에 표시할 행: 지정 흐름 반영 후 상태. */
export type ReviewRow = PreviewRow & { chosenFlow: Flow; overridden: boolean };

/** 저장 대상 상태인지(신규 또는 검토 필요). */
export function isImportable(status: PreviewStatus): boolean {
  return status === "new" || status === "needs_review";
}

/**
 * 미리보기에 행 단위 지정을 적용한다. 검토 필요 행에 흐름을 지정하면 신규로 바뀐다.
 * 중복·오류 행은 지정할 수 없다.
 */
export function applyOverrides(rows: readonly FingerprintedRow[], existing: ReadonlySet<string>, overrides: FlowOverrides): ReviewRow[] {
  return buildPreview(rows, existing).map((row) => {
    const chosen = isImportable(row.status) ? overrides.get(row.sourceRow) : undefined;
    if (!chosen) return { ...row, chosenFlow: row.flow, overridden: false };
    return { ...row, chosenFlow: chosen, overridden: true, status: chosen === "needs_review" ? "needs_review" : "new" };
  });
}

/** 상태별 건수. */
export type ReviewCounts = Record<PreviewStatus, number> & { total: number; toSave: number };

/** 건수 요약. 저장 예정 = 신규 + 검토 필요(미분류로 저장). */
export function countReview(rows: readonly ReviewRow[]): ReviewCounts {
  const counts: ReviewCounts = { total: rows.length, new: 0, needs_review: 0, duplicate_existing: 0, duplicate_in_file: 0, error: 0, toSave: 0 };
  for (const row of rows) {
    counts[row.status] += 1;
    if (isImportable(row.status)) counts.toSave += 1;
  }
  return counts;
}

/** 빈 문자열을 null로. */
const orNull = (value: string): string | null => (value === "" ? null : value);

/** 검토 행 → 서버 전송 형식. */
export function toTransactionCreate(row: ReviewRow): TransactionCreate {
  return {
    date: row.date,
    time: orNull(row.time),
    source_type: row.sourceType,
    flow: row.chosenFlow,
    major_category: orNull(row.majorCategory),
    minor_category: orNull(row.minorCategory),
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    payment_method: row.paymentMethod,
    memo: orNull(row.memo),
    fingerprint: row.fingerprint,
  };
}

/** 승인 시 보낼 행과 요약. 기존 중복·파일 내부 중복·오류 행은 절대 포함하지 않는다. */
export function planCommit(rows: readonly ReviewRow[]): { rows: TransactionCreate[]; summary: ImportSummary } {
  const counts = countReview(rows);
  return {
    rows: rows.filter((row) => isImportable(row.status)).map(toTransactionCreate),
    summary: { in_file_duplicate: counts.duplicate_in_file, review: counts.needs_review, error: counts.error },
  };
}
