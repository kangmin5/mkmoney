/**
 * 백업 복원 계획(순수 함수 + 지문 재계산). 기존 거래·매핑은 바꾸지 않고 추가할 것만 고른다.
 */
import type { TransactionCreate } from "../api/client";
import { createFingerprint } from "../import/fingerprint";
import type { BackupPayload } from "./backup";

/** 복원 미리보기. */
export interface RestorePlan {
  total: number;
  /** 추가될 거래(지문 검증 통과, 미저장, 백업 내 첫 행) */
  rows: TransactionCreate[];
  existing: number;
  duplicateInBackup: number;
  /** 지문이 내용과 맞지 않는 행(손상·변조) — 복원하지 않음 */
  damaged: number;
  typeMappings: BackupPayload["type_mappings"];
  paymentMappings: BackupPayload["payment_mappings"];
}

/** 각 거래의 지문을 내용으로 다시 계산해 일치 여부를 돌려준다. */
export async function verifyBackupFingerprints(rows: readonly TransactionCreate[]): Promise<boolean[]> {
  const result: boolean[] = [];
  for (const row of rows) {
    const computed = await createFingerprint({
      date: row.date,
      time: row.time ?? "",
      sourceType: row.source_type,
      amount: row.amount,
      currency: row.currency,
      paymentMethod: row.payment_method,
      description: row.description,
    });
    result.push(computed === row.fingerprint);
  }
  return result;
}

/**
 * 복원 계획을 만든다.
 * @param payload 복호화·검증된 백업
 * @param valid 행별 지문 검증 결과
 * @param existing 서버에 이미 있는 지문
 * @param savedTypes 서버에 사용자 매핑이 있는 원본 타입
 * @param savedPayments 서버에 매핑이 있는 결제수단 라벨
 */
export function planRestore(
  payload: BackupPayload,
  valid: readonly boolean[],
  existing: ReadonlySet<string>,
  savedTypes: ReadonlySet<string>,
  savedPayments: ReadonlySet<string>,
): RestorePlan {
  const seen = new Set<string>();
  const rows: TransactionCreate[] = [];
  let existingCount = 0;
  let duplicateInBackup = 0;
  let damaged = 0;
  payload.transactions.forEach((row, index) => {
    if (!valid[index]) damaged += 1;
    else if (existing.has(row.fingerprint)) existingCount += 1;
    else if (seen.has(row.fingerprint)) duplicateInBackup += 1;
    else {
      seen.add(row.fingerprint);
      rows.push(row);
    }
  });
  return {
    total: payload.transactions.length,
    rows,
    existing: existingCount,
    duplicateInBackup,
    damaged,
    typeMappings: payload.type_mappings.filter((m) => !savedTypes.has(m.source_type)),
    paymentMappings: payload.payment_mappings.filter((m) => !savedPayments.has(m.source_label)),
  };
}
