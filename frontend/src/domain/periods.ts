/**
 * 조회 기간 규칙(Asia/Seoul 달력, 양 끝 날짜 포함). 백엔드 `services/periods.py`와 같은 의미.
 */

/** 비교 기준. */
export type ComparisonMode = "previous_month" | "same_range" | "previous_period";

/** 비교 기준 한국어 라벨. */
export const COMPARISON_LABELS: Record<ComparisonMode, string> = {
  same_range: "전월 같은 기간",
  previous_month: "전월 전체",
  previous_period: "직전 같은 일수",
};

/** 화면 공용 기간 상태. */
export interface Period {
  /** month: 한 달 단위, custom: 직접 지정 */
  kind: "month" | "custom";
  /** `YYYY-MM-DD` */
  start: string;
  /** `YYYY-MM-DD` */
  end: string;
  comparison: ComparisonMode;
}

const TIME_ZONE = "Asia/Seoul";
const pad = (n: number): string => String(n).padStart(2, "0");

/** 서울 기준 오늘(`YYYY-MM-DD`). */
export function todayInSeoul(now: Date = new Date()): string {
  // en-CA 로캘은 YYYY-MM-DD 형식을 돌려준다.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** 해당 월의 말일 숫자. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `YYYY-MM`의 첫날과 말일. */
export function monthBounds(yearMonth: string): { start: string; end: string } {
  const [y, m] = yearMonth.split("-").map(Number);
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}` };
}

/** `YYYY-MM`을 n개월 이동. */
export function shiftYearMonth(yearMonth: string, months: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/**
 * 월 단위 기간. 이번 달이면 오늘까지(전월 같은 기간과 비교), 지난 달이면 말일까지.
 * @param yearMonth `YYYY-MM`
 * @param today 서울 기준 오늘
 */
export function monthPeriod(yearMonth: string, today: string = todayInSeoul(), comparison: ComparisonMode = "same_range"): Period {
  const bounds = monthBounds(yearMonth);
  const end = today.startsWith(yearMonth) ? today : bounds.end;
  return { kind: "month", start: bounds.start, end, comparison };
}

/** 기본 기간: 이번 달 1일~오늘, 전월 같은 기간 비교. */
export function defaultPeriod(today: string = todayInSeoul()): Period {
  return monthPeriod(today.slice(0, 7), today);
}

/** 기간이 올바른지(형식, 시작 ≤ 종료). */
export function isValidRange(start: string, end: string): boolean {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  return re.test(start) && re.test(end) && start <= end;
}

/** 화면 표시용 기간 문자열(예: 2026.11.01 – 11.07). */
export function formatRange(start: string, end: string): string {
  const s = start.replace(/-/g, ".");
  if (start === end) return s;
  const e = start.slice(0, 4) === end.slice(0, 4) ? end.slice(5).replace("-", ".") : end.replace(/-/g, ".");
  return `${s} – ${e}`;
}

/** 월 라벨(예: 2026-11 → 2026년 11월). */
export function formatYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  return `${y}년 ${Number(m)}월`;
}
