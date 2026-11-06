/**
 * 같은 출처 FastAPI JSON 클라이언트. 외부 서비스는 호출하지 않는다.
 * 세션은 HttpOnly 쿠키로만 유지하며, 자격 증명을 브라우저 저장소에 두지 않는다.
 */
import type { CardKind, Flow } from "../domain/transaction";
import type { BackupPayload } from "../storage/backup";
import type { ComparisonMode } from "../domain/periods";

/** 값이 들어가지 않는 API 오류. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/** 401 응답 시 호출될 콜백 등록(앱 셸이 로그인 화면으로 전환). 해제 함수를 돌려준다. */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

/** 서버 오류 본문에서 사람이 읽을 메시지를 꺼낸다(값 없는 detail 문자열만). */
async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") return body.detail;
  } catch {
    // 본문이 JSON이 아니면 기본 메시지
  }
  if (response.status === 422) return "입력값을 확인하세요.";
  if (response.status >= 500) return "서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
  return `요청이 실패했습니다(${response.status}).`;
}

/**
 * JSON 요청을 보낸다.
 * @param path `/api/...` 경로
 * @param init method·body·signal
 */
export async function request<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: init.body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "서버에 연결할 수 없습니다. 네트워크를 확인하세요.");
  }
  if (response.status === 401 && !path.startsWith("/api/auth/")) unauthorizedListeners.forEach((fn) => fn());
  if (!response.ok) throw new ApiError(response.status, await errorMessage(response));
  return (await response.json()) as T;
}

/** 쿼리 문자열 생성(빈 값 제외). */
function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

// ── 응답 타입 ────────────────────────────────────────────────
/** 기간 합계(금액은 십진 문자열). */
export interface FlowTotals {
  income: string;
  gross_expense: string;
  refund: string;
  net_expense: string;
  net_cashflow: string;
}

export interface CurrencySummary {
  currency: string;
  current: FlowTotals;
  previous: FlowTotals;
  delta: FlowTotals;
}

export interface SummaryResponse {
  start: string;
  end: string;
  comparison_mode: ComparisonMode;
  comparison_start: string;
  comparison_end: string;
  currencies: CurrencySummary[];
  unresolved_count: number;
  transfer_count: number;
  card_settlement_count: number;
}

export interface MonthlyFlow {
  month: string;
  currency: string;
  income: string;
  net_expense: string;
}

export interface CategoryTotal {
  currency: string;
  major_category: string | null;
  minor_category: string | null;
  total: string;
  count: number;
}

export interface PaymentMethodUsage {
  payment_method: string;
  currency: string;
  card_kind: CardKind | null;
  purchase: string;
  refund: string;
  net: string;
  count: number;
}

export interface CardKindUsage {
  currency: string;
  card_kind: CardKind | "unmapped";
  purchase: string;
  refund: string;
  net: string;
}

export interface CardsResponse {
  start: string;
  end: string;
  methods: PaymentMethodUsage[];
  by_kind: CardKindUsage[];
}

export interface Transaction {
  id: string;
  date: string;
  time: string | null;
  source_type: string;
  flow: Flow;
  flow_source: "auto" | "manual";
  major_category: string | null;
  minor_category: string | null;
  description: string;
  amount: string;
  currency: string;
  payment_method: string;
  memo: string | null;
}

export interface TransactionPage {
  items: Transaction[];
  total: number;
  limit: number;
  offset: number;
}

export interface TransactionFilters {
  start?: string;
  end?: string;
  flow?: Flow;
  major_category?: string;
  payment_method?: string;
}

export interface ImportBatch {
  id: string;
  file_name: string;
  imported_at: string;
  inserted_count: number;
  duplicate_count: number;
  in_file_duplicate_count: number;
  review_count: number;
  error_count: number;
}

/** 승인 후 전송하는 정규화 행(서버 TransactionCreate와 동일). */
export interface TransactionCreate {
  date: string;
  time: string | null;
  source_type: string;
  flow: Flow;
  major_category: string | null;
  minor_category: string | null;
  description: string;
  amount: string;
  currency: string;
  payment_method: string;
  memo: string | null;
  fingerprint: string;
}

/** 저장하지 않은 행 건수 요약(가져오기 기록용). */
export interface ImportSummary {
  in_file_duplicate: number;
  review: number;
  error: number;
}

export interface ImportResult {
  batch_id: string;
  inserted: number;
  duplicate: number;
}

export interface RestoreResult {
  batch_id: string;
  inserted: number;
  duplicate: number;
  type_mappings_added: number;
  payment_mappings_added: number;
}

export interface TypeMapping {
  source_type: string;
  flow: Flow | null;
  default_flow: Flow | null;
  transaction_count: number;
}

export interface PaymentMethodMapping {
  source_label: string;
  card_kind: CardKind | null;
  transaction_count: number;
}

// ── 엔드포인트 ───────────────────────────────────────────────
export const api = {
  /** 세션 인증 여부. */
  me: (signal?: AbortSignal) => request<{ authenticated: boolean }>("/api/auth/me", { signal }),
  login: (password: string) => request<{ authenticated: boolean }>("/api/auth/login", { method: "POST", body: { password } }),
  logout: () => request<{ authenticated: boolean }>("/api/auth/logout", { method: "POST" }),

  summary: (start: string, end: string, comparison: ComparisonMode, signal?: AbortSignal) =>
    request<SummaryResponse>(`/api/reports/summary${query({ start, end, comparison })}`, { signal }),
  monthly: (end: string, months: number, signal?: AbortSignal) =>
    request<MonthlyFlow[]>(`/api/reports/monthly${query({ end, months })}`, { signal }),
  categories: (start: string, end: string, flow: "income" | "expense" | "refund", signal?: AbortSignal) =>
    request<CategoryTotal[]>(`/api/reports/categories${query({ start, end, flow })}`, { signal }),
  cards: (start: string, end: string, signal?: AbortSignal) =>
    request<CardsResponse>(`/api/reports/cards${query({ start, end })}`, { signal }),

  transactions: (filters: TransactionFilters, limit: number, offset: number, signal?: AbortSignal) =>
    request<TransactionPage>(`/api/transactions${query({ ...filters, limit, offset })}`, { signal }),
  /** 행 흐름 지정. null이면 자동(타입 매핑)으로 되돌린다. */
  setFlow: (id: string, flow: Flow | null) =>
    request<Transaction>(`/api/transactions/${encodeURIComponent(id)}/flow`, { method: "PATCH", body: { flow } }),

  /** 지문만 보내 이미 저장된 것을 확인한다(거래 값은 보내지 않음). */
  checkFingerprints: (fingerprints: string[]) =>
    request<{ existing: string[] }>("/api/imports/check", { method: "POST", body: { fingerprints } }),
  /** 사용자가 승인한 신규 행만 저장한다(서버는 한 트랜잭션으로 반영). */
  commitImport: (file_name: string, rows: TransactionCreate[], summary: ImportSummary) =>
    request<ImportResult>("/api/imports", { method: "POST", body: { file_name, rows, summary } }),
  /** 백업용 전체 데이터(브라우저가 즉시 암호화한다). */
  exportBackup: () => request<BackupPayload>("/api/backup/export"),
  /** 승인한 백업 행·매핑 병합(추가만). */
  restoreBackup: (file_name: string, rows: TransactionCreate[], type_mappings: BackupPayload["type_mappings"], payment_mappings: BackupPayload["payment_mappings"]) =>
    request<RestoreResult>("/api/backup/restore", { method: "POST", body: { file_name, rows, type_mappings, payment_mappings } }),
  recentImports: (limit: number, signal?: AbortSignal) => request<ImportBatch[]>(`/api/imports/recent${query({ limit })}`, { signal }),

  typeMappings: (signal?: AbortSignal) => request<TypeMapping[]>("/api/type-mappings", { signal }),
  saveTypeMapping: (source_type: string, flow: Flow) =>
    request<TypeMapping[]>("/api/type-mappings", { method: "PUT", body: { source_type, flow } }),
  paymentMappings: (signal?: AbortSignal) => request<PaymentMethodMapping[]>("/api/payment-method-mappings", { signal }),
  savePaymentMapping: (source_label: string, card_kind: CardKind) =>
    request<PaymentMethodMapping[]>("/api/payment-method-mappings", { method: "PUT", body: { source_label, card_kind } }),
};

/** 지문을 1만 개씩 나눠 이미 저장된 것을 확인한다(서버 요청 한도 대비). */
export async function checkAllFingerprints(fingerprints: readonly string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let start = 0; start < fingerprints.length; start += 10_000) {
    const chunk = fingerprints.slice(start, start + 10_000);
    for (const fp of (await api.checkFingerprints(chunk)).existing) existing.add(fp);
  }
  return existing;
}
