/**
 * 가져오기 미리보기 분류(순수 함수). 네트워크 호출 없음.
 */
import { ERROR_CODES, type ParsedRow } from "../domain/transaction";

/** 미리보기 상태. */
export type PreviewStatus = "new" | "duplicate_existing" | "duplicate_in_file" | "needs_review" | "error";

/** 지문이 붙은 행. 오류 행은 지문이 빈 문자열이다. */
export type FingerprintedRow = ParsedRow & { fingerprint: string };

/** 미리보기 행. */
export type PreviewRow = FingerprintedRow & { status: PreviewStatus };

/** 행이 저장할 수 없는 오류 코드를 가졌는지. */
export function hasError(row: ParsedRow): boolean {
  return row.validationCodes.some((code) => ERROR_CODES.has(code));
}

/**
 * 행을 상태별로 나눈다. 판정 순서: 오류 → 기존 DB 중복 → 파일 내부 중복 → 검토 필요 → 신규.
 * 같은 지문은 파일 안에서 처음 나온 행만 후보가 된다.
 * @param rows 지문이 붙은 파싱 행
 * @param existingFingerprints 서버가 이미 있다고 답한 지문 집합
 */
export function buildPreview(
  rows: readonly FingerprintedRow[],
  existingFingerprints: ReadonlySet<string>,
): PreviewRow[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    let status: PreviewStatus;
    if (hasError(row) || !row.fingerprint) status = "error";
    else if (existingFingerprints.has(row.fingerprint)) status = "duplicate_existing";
    else if (seen.has(row.fingerprint)) status = "duplicate_in_file";
    else status = row.flow === "needs_review" ? "needs_review" : "new";
    if (row.fingerprint && status !== "error") seen.add(row.fingerprint);
    return { ...row, status };
  });
}

/** 상태별 건수 요약. */
export function countByStatus(rows: readonly PreviewRow[]): Record<PreviewStatus, number> {
  const counts: Record<PreviewStatus, number> = {
    new: 0,
    duplicate_existing: 0,
    duplicate_in_file: 0,
    needs_review: 0,
    error: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}
