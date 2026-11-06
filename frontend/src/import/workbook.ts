/**
 * 뱅크샐러드 `.xlsx`를 브라우저에서 읽는다. 네트워크 호출이나 원본 바이트 전송이 없다.
 * `가계부 내역` 시트만 파싱하며(다른 시트 값은 읽지 않음) 열은 헤더 이름으로 찾는다.
 */
import * as XLSX from "xlsx";

import { deriveFlow, type Flow, type ParsedRow } from "../domain/transaction";
import { canonicalAmount, normalizeText } from "./fingerprint";

/** 가져올 시트 이름(고정). */
export const LEDGER_SHEET = "가계부 내역";
/** 필수 헤더. */
export const REQUIRED_HEADERS = ["날짜", "시간", "타입", "대분류", "소분류", "내용", "금액", "화폐", "결제수단", "메모"] as const;
/** 파일 크기 한도(바이트). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** 거래 행 한도. */
export const MAX_ROWS = 20_000;

type Header = (typeof REQUIRED_HEADERS)[number];

/** 값이 들어가지 않는 사용자 안내용 가져오기 오류. */
export class WorkbookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbookError";
  }
}

/** 파싱 결과. */
export interface ParsedWorkbook {
  fileName: string;
  /** 실제로 읽은 시트 이름(항상 `가계부 내역`). */
  sheetName: string;
  /** 파일에 있던 시트 이름 목록(값은 읽지 않음). 사용자가 대상 시트를 확인하는 용도. */
  sheetNames: string[];
  rows: ParsedRow[];
}

/** 필드 길이 한도(DB 스키마와 동일). */
const MAX_LEN: Partial<Record<Header, number>> = {
  타입: 120,
  대분류: 120,
  소분류: 120,
  내용: 500,
  결제수단: 200,
  메모: 1000,
};

const pad = (n: number): string => String(n).padStart(2, "0");

/** 실존하는 달력 날짜인지 확인한다. */
function isRealDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** 엑셀 serial 또는 `YYYY-MM-DD`/`YYYY.MM.DD`/`YYYY/MM/DD` 텍스트를 ISO 날짜로. 실패 시 빈 문자열. */
export function parseDateCell(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const parts = XLSX.SSF.parse_date_code(value);
    if (!parts || !isRealDate(parts.y, parts.m, parts.d)) return "";
    return `${parts.y}-${pad(parts.m)}-${pad(parts.d)}`;
  }
  if (typeof value === "string") {
    const match = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?$/.exec(value.trim());
    if (!match) return "";
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return isRealDate(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : "";
  }
  return "";
}

/** 엑셀 시간(하루의 비율) 또는 `HH:MM[:SS]` 텍스트를 `HH:MM:SS`로. 비어 있으면 "", 오류면 null. */
export function parseTimeCell(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    // 날짜 부분이 섞여 있으면 소수부만 사용하고 초 단위로 반올림한다.
    let seconds = Math.round((value - Math.floor(value)) * 86_400);
    if (seconds >= 86_400) seconds = 86_399;
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return "";
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
    if (!match) return null;
    const [h, m, s] = [Number(match[1]), Number(match[2]), Number(match[3] ?? "0")];
    if (h > 23 || m > 59 || s > 59) return null;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  return null;
}

/** 금액 셀을 정규 십진 문자열로. 소수 4자리·정수 16자리 초과나 형식 오류는 빈 문자열. */
export function parseAmountCell(value: unknown): string {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    text = String(value);
    if (/e/i.test(text)) return "";
  } else if (typeof value === "string") {
    text = value;
  } else {
    return "";
  }
  const amount = canonicalAmount(text);
  if (!amount) return "";
  const [intPart, fracPart = ""] = amount.replace("-", "").split(".");
  if (fracPart.length > 4 || intPart.length > 16) return "";
  return amount;
}

/** 셀 값을 문자열로 정규화(NFC + 앞뒤 공백 제거). */
function textCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return normalizeText(String(value));
}

/** 브라우저 File을 ArrayBuffer로 읽는다(구형 환경은 FileReader 사용). */
async function readBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new WorkbookError("파일을 읽지 못했습니다."));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 워크북을 파싱해 정규화 행을 돌려준다.
 * @param file 사용자가 고른 `.xlsx` 파일
 * @param typeMappings 사용자 저장 타입 매핑(기본 매핑보다 우선)
 * @throws WorkbookError 지원하지 않는 파일, 시트 없음, 필수 헤더 누락·중복, 행 수 초과
 */
export async function parseWorkbook(
  file: File,
  typeMappings: Readonly<Record<string, Flow>> = {},
): Promise<ParsedWorkbook> {
  if (!/\.xlsx$/i.test(file.name)) throw new WorkbookError("지원하지 않는 파일입니다. .xlsx 파일을 선택하세요.");
  if (file.size > MAX_FILE_BYTES) throw new WorkbookError("파일이 너무 큽니다(최대 10MB).");

  let workbook: XLSX.WorkBook;
  try {
    // sheets 옵션으로 거래 시트만 파싱한다. 다른 시트(예: 뱅샐현황)의 값은 읽지 않는다.
    workbook = XLSX.read(await readBytes(file), { type: "array", sheets: [LEDGER_SHEET], cellDates: false });
  } catch {
    throw new WorkbookError("엑셀 파일을 해석하지 못했습니다. 손상되었거나 지원하지 않는 형식입니다.");
  }
  const sheet = workbook.Sheets[LEDGER_SHEET];
  if (!workbook.SheetNames.includes(LEDGER_SHEET) || !sheet) {
    throw new WorkbookError(`'${LEDGER_SHEET}' 시트를 찾을 수 없습니다.`);
  }

  const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true });
  const headerRow = (table[0] ?? []).map((cell) => textCell(cell));
  const index = new Map<Header, number>();
  const duplicated: string[] = [];
  for (const header of REQUIRED_HEADERS) {
    const positions = headerRow.flatMap((name, i) => (name === header ? [i] : []));
    if (positions.length > 1) duplicated.push(header);
    if (positions.length >= 1) index.set(header, positions[0]);
  }
  const missing = REQUIRED_HEADERS.filter((h) => !index.has(h));
  if (duplicated.length) throw new WorkbookError(`중복 열이 있습니다: ${duplicated.join(", ")}`);
  if (missing.length) throw new WorkbookError(`필수 열이 없습니다: ${missing.join(", ")}`);

  const body = table.slice(1);
  const rows: ParsedRow[] = [];
  body.forEach((cells, offset) => {
    const get = (h: Header): unknown => cells?.[index.get(h) as number] ?? null;
    if (REQUIRED_HEADERS.every((h) => textCell(get(h)) === "")) return; // 빈 행 건너뜀
    if (rows.length >= MAX_ROWS) throw new WorkbookError(`거래 행이 너무 많습니다(최대 ${MAX_ROWS.toLocaleString()}행).`);

    const codes: string[] = [];
    const date = parseDateCell(get("날짜"));
    if (!date) codes.push("invalid_date");
    const time = parseTimeCell(get("시간"));
    if (time === null) codes.push("invalid_time");
    const amount = parseAmountCell(get("금액"));
    if (!amount) codes.push("invalid_amount");
    const currency = textCell(get("화폐")).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) codes.push("invalid_currency");
    const sourceType = textCell(get("타입"));
    if (!sourceType) codes.push("missing_type");
    const description = textCell(get("내용"));
    if (!description) codes.push("missing_description");
    const paymentMethod = textCell(get("결제수단"));
    if (!paymentMethod) codes.push("missing_payment_method");
    for (const [header, limit] of Object.entries(MAX_LEN) as [Header, number][]) {
      if (textCell(get(header)).length > limit && !codes.includes("too_long")) codes.push("too_long");
    }

    const derived = sourceType ? deriveFlow(sourceType, amount, typeMappings) : { flow: "needs_review" as const, codes: [] };
    rows.push({
      sourceRow: offset + 2,
      date,
      time: time ?? "",
      sourceType,
      majorCategory: textCell(get("대분류")),
      minorCategory: textCell(get("소분류")),
      description,
      amount,
      currency,
      paymentMethod,
      memo: textCell(get("메모")),
      flow: derived.flow,
      validationCodes: [...codes, ...derived.codes],
    });
  });

  return { fileName: file.name, sheetName: LEDGER_SHEET, sheetNames: [...workbook.SheetNames], rows };
}
