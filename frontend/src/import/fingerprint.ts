/**
 * 중복 판정 지문(fingerprint). 백엔드 `app/services/fingerprint.py`와 바이트 단위로 같아야 한다.
 * 키: 날짜, 시간, 타입, 금액, 화폐, 결제수단, 내용 (대분류·소분류·메모 제외).
 */
import type { ParsedRow } from "../domain/transaction";

/**
 * JS `\s` + BOM과 같은 명시적 공백 코드 포인트 집합. Python 쪽(`EDGE_SPACE_CODEPOINTS`)과 동일하게 유지한다.
 */
export const EDGE_SPACE_CODEPOINTS: readonly number[] = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];
const EDGE_SPACE = new Set(EDGE_SPACE_CODEPOINTS);

/** 텍스트를 NFC 정규화하고 앞뒤 공백을 제거한다. */
export function normalizeText(value: string): string {
  const text = value.normalize("NFC");
  let start = 0;
  let end = text.length;
  while (start < end && EDGE_SPACE.has(text.charCodeAt(start))) start += 1;
  while (end > start && EDGE_SPACE.has(text.charCodeAt(end - 1))) end -= 1;
  return text.slice(start, end);
}

/**
 * 십진 문자열을 정규형으로 바꾼다: `+` 제거, 선행·후행 0 제거, `-0`은 `0`.
 * 형식이 아니면 빈 문자열을 반환한다. 부동소수점을 거치지 않는다.
 */
export function canonicalAmount(value: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(value.trim().replace(/,/g, ""));
  if (!match) return "";
  const intPart = match[2].replace(/^0+(?=\d)/, "");
  const fracPart = (match[3] ?? "").replace(/0+$/, "");
  const body = fracPart ? `${intPart}.${fracPart}` : intPart;
  if (/^0(\.0*)?$/.test(body)) return "0";
  return match[1] === "-" ? `-${body}` : body;
}

/** 지문 대상 필드만 뽑은 형태. */
export type FingerprintFields = Pick<
  ParsedRow,
  "date" | "time" | "sourceType" | "amount" | "currency" | "paymentMethod" | "description"
>;

/** 지문 입력 JSON 문자열(테스트·디버깅용, 로그로 남기지 않는다). */
export function fingerprintPayload<T extends FingerprintFields>(row: T): string {
  return JSON.stringify([
    row.date,
    row.time,
    normalizeText(row.sourceType),
    canonicalAmount(row.amount),
    normalizeText(row.currency).toUpperCase(),
    normalizeText(row.paymentMethod),
    normalizeText(row.description),
  ]);
}

/** SHA-256 hex 지문을 만든다. Web Crypto가 필요하므로 HTTPS 또는 localhost에서만 동작한다. */
export async function createFingerprint<T extends FingerprintFields>(row: T): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("보안 연결(HTTPS)에서만 가져오기를 사용할 수 있습니다.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(fingerprintPayload(row)),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
