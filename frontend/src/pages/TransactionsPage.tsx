/**
 * 거래내역: 기간·흐름·분류·결제수단 필터, 페이지네이션(50건), 행 단위 흐름 지정.
 * 원본 값(날짜·타입·분류·내용·금액·결제수단)은 바꾸지 않고, 집계 방향(흐름)만 사용자가 정한다.
 */
import { useEffect, useState } from "react";

import { api, type Transaction } from "../api/client";
import { useApp } from "../app/AppContext";
import { PeriodControls } from "../components/PeriodControls";
import { StatusView } from "../components/StatusView";
import { formatMoney } from "../domain/money";
import { formatRange } from "../domain/periods";
import { type Flow, FLOW_LABELS, FLOWS } from "../domain/transaction";
import { useAsync } from "../hooks/useAsync";

export const PAGE_SIZE = 50;

/** 거래내역 화면. */
export function TransactionsPage() {
  const { period, setPeriod, dataVersion, notifyDataChanged, transactionFilters, setTransactionFilters } = useApp();
  const [page, setPage] = useState(0);
  // 필터나 기간이 바뀌면 첫 페이지로.
  useEffect(() => setPage(0), [period.start, period.end, transactionFilters]);

  const filters = { ...transactionFilters, start: period.start, end: period.end };
  const result = useAsync(
    (signal) => api.transactions(filters, PAGE_SIZE, page * PAGE_SIZE, signal),
    [period.start, period.end, transactionFilters, page, dataVersion],
  );

  const removeFilter = (key: "major_category" | "payment_method") => {
    const next = { ...transactionFilters };
    delete next[key];
    setTransactionFilters(next);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">LEDGER · {formatRange(period.start, period.end)}</p>
          <h1>거래내역</h1>
        </div>
        <PeriodControls period={period} onChange={setPeriod} showComparison={false} />
      </div>

      <div className="filters" role="group" aria-label="거래 필터">
        <label className="field field--inline">
          <span>분류 상태</span>
          <select
            value={transactionFilters.flow ?? ""}
            onChange={(e) => setTransactionFilters({ ...transactionFilters, flow: (e.target.value || undefined) as Flow | undefined })}
          >
            <option value="">전체</option>
            {FLOWS.map((flow) => (
              <option key={flow} value={flow}>
                {FLOW_LABELS[flow]}
              </option>
            ))}
          </select>
        </label>
        {transactionFilters.major_category !== undefined && (
          <button type="button" className="chip" onClick={() => removeFilter("major_category")} aria-label={`대분류 필터 ${transactionFilters.major_category} 해제`}>
            대분류: {transactionFilters.major_category || "(없음)"} ✕
          </button>
        )}
        {transactionFilters.payment_method !== undefined && (
          <button type="button" className="chip" onClick={() => removeFilter("payment_method")} aria-label={`결제수단 필터 ${transactionFilters.payment_method} 해제`}>
            결제수단: {transactionFilters.payment_method} ✕
          </button>
        )}
      </div>

      <StatusView state={result} isEmpty={(data) => data.items.length === 0} empty="조건에 맞는 거래가 없습니다.">
        {(data) => (
          <>
            <p className="muted" aria-live="polite">
              총 {data.total.toLocaleString("ko-KR")}건 중 {data.offset + 1}–{data.offset + data.items.length}
            </p>
            <ul className="tx-list">
              {data.items.map((tx) => (
                <TransactionItem key={tx.id} tx={tx} onChanged={notifyDataChanged} />
              ))}
            </ul>
            <Pagination total={data.total} page={page} onPage={setPage} />
          </>
        )}
      </StatusView>
    </>
  );
}

/** 거래 한 건(모바일에서는 카드, 넓은 화면에서는 한 줄). */
function TransactionItem({ tx, onChanged }: { tx: Transaction; onChanged: () => void }) {
  const [saving, setSaving] = useState<"idle" | "saving" | { error: string }>("idle");
  const change = async (value: string) => {
    setSaving("saving");
    try {
      await api.setFlow(tx.id, value === "auto" ? null : (value as Flow));
      setSaving("idle");
      onChanged();
    } catch (error) {
      setSaving({ error: error instanceof Error ? error.message : "저장하지 못했습니다." });
    }
  };
  const category = [tx.major_category, tx.minor_category].filter(Boolean).join(" · ");
  return (
    <li className={`tx tx--${tx.flow}`}>
      <div className="tx__when">
        <time dateTime={tx.date}>{tx.date.replace(/-/g, ".")}</time>
        {tx.time && <span className="muted">{tx.time.slice(0, 5)}</span>}
      </div>
      <div className="tx__main">
        <span className="tx__desc">{tx.description}</span>
        <span className="muted">
          {tx.source_type}
          {category && ` · ${category}`} · {tx.payment_method}
        </span>
        {tx.memo && <span className="muted tx__memo">{tx.memo}</span>}
      </div>
      <div className="tx__amount">{formatMoney(tx.amount, tx.currency)}</div>
      <label className="tx__flow">
        <span className="visually-hidden">집계 분류</span>
        <select value={tx.flow_source === "manual" ? tx.flow : "auto"} onChange={(e) => change(e.target.value)} disabled={saving === "saving"}>
          <option value="auto">자동: {FLOW_LABELS[tx.flow_source === "auto" ? tx.flow : "needs_review"]}</option>
          {FLOWS.filter((f) => f !== "needs_review").map((flow) => (
            <option key={flow} value={flow}>
              {FLOW_LABELS[flow]}
            </option>
          ))}
        </select>
        {saving === "saving" && <span className="muted">저장 중…</span>}
        {typeof saving === "object" && (
          <span className="field-error" role="alert">
            {saving.error}
          </span>
        )}
      </label>
    </li>
  );
}

/** 이전/다음 페이지. */
function Pagination({ total, page, onPage }: { total: number; page: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages === 1) return null;
  return (
    <nav className="pagination" aria-label="페이지">
      <button type="button" className="btn" disabled={page === 0} onClick={() => onPage(page - 1)}>
        이전
      </button>
      <span aria-current="page">
        {page + 1} / {pages}
      </span>
      <button type="button" className="btn" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
        다음
      </button>
    </nav>
  );
}
