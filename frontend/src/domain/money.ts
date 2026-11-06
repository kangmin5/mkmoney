/**
 * 금액 표시. 서버가 준 십진 문자열을 부동소수점으로 바꾸지 않고 그대로 포맷한다.
 */

const SYMBOLS: Record<string, string> = { KRW: "₩", USD: "$", EUR: "€", JPY: "¥" };
/** 통화별 최소 소수 자릿수(표시용). */
const MIN_FRACTION: Record<string, number> = { USD: 2, EUR: 2 };

/** 십진 문자열을 부호·정수부·소수부로 나눈다. 형식이 아니면 null. */
function splitDecimal(value: string): { negative: boolean; int: string; frac: string } | null {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  return { negative: match[1] === "-", int: match[2].replace(/^0+(?=\d)/, ""), frac: (match[3] ?? "").replace(/0+$/, "") };
}

/**
 * 금액을 통화 기호와 천 단위 구분으로 표시한다(예: "3482000.0000", KRW → ₩3,482,000).
 * @param value 십진 문자열
 * @param currency ISO 통화 코드
 * @param options.signed 양수에도 + 표시
 */
export function formatMoney(value: string, currency: string, options: { signed?: boolean; abs?: boolean } = {}): string {
  const parts = splitDecimal(value);
  if (!parts) return value;
  const grouped = parts.int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = parts.frac.padEnd(MIN_FRACTION[currency] ?? 0, "0");
  const isZero = /^0$/.test(parts.int) && frac.replace(/0/g, "") === "";
  const sign = options.abs || isZero ? "" : parts.negative ? "−" : options.signed ? "+" : "";
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  return `${sign}${symbol}${grouped}${frac ? `.${frac}` : ""}`;
}

/** 십진 문자열의 부호(-1, 0, 1). */
export function signOf(value: string): -1 | 0 | 1 {
  const parts = splitDecimal(value);
  if (!parts || (parts.int === "0" && parts.frac === "")) return 0;
  return parts.negative ? -1 : 1;
}

/**
 * 변화율 표시(예: 4.2%). 비율 계산은 표시용으로만 Number를 쓴다(금액 합산에는 쓰지 않음).
 * 이전 값이 0이면 null.
 */
export function percentChange(current: string, previous: string): string | null {
  const prev = Number(previous);
  const cur = Number(current);
  if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev === 0) return null;
  const ratio = ((cur - prev) / Math.abs(prev)) * 100;
  return `${Math.abs(ratio).toFixed(1)}%`;
}

/** 막대 그래프용 상대 높이(0~100). 표시용 근사치. */
export function relativeHeight(value: string, max: string): number {
  const v = Math.abs(Number(value));
  const m = Math.abs(Number(max));
  if (!Number.isFinite(v) || !Number.isFinite(m) || m === 0 || v === 0) return 0;
  return Math.max(2, Math.round((v / m) * 100));
}

/** 십진 문자열 → 1/10000 단위 정수(DB 소수 4자리와 같음). 형식이 아니면 0. */
export function toUnits(value: string): bigint {
  const match = /^([+-]?)(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!match) return 0n;
  const units = BigInt(match[2]) * 10000n + BigInt((match[3] ?? "").padEnd(4, "0"));
  return match[1] === "-" ? -units : units;
}

/** 1/10000 단위 정수 → 십진 문자열(소수 4자리). */
export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const text = `${abs / 10000n}.${(abs % 10000n).toString().padStart(4, "0")}`;
  return negative ? `-${text}` : text;
}
