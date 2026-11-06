/**
 * 가져오기 검토 목록: 상태별 탭, 50행 페이지, 저장 대상 행의 흐름 지정.
 * 모바일에서는 행마다 카드로 보여 주고 표를 축소하지 않는다.
 */
import { useEffect, useMemo, useState } from "react";

import { formatMoney } from "../domain/money";
import { type Flow, FLOW_LABELS, FLOWS, VALIDATION_LABELS } from "../domain/transaction";
import { isImportable, type ReviewCounts, type ReviewRow } from "../import/plan";
import type { PreviewStatus } from "../import/preview";

export const REVIEW_PAGE_SIZE = 50;

/** 탭 정의. */
export type ReviewTab = "to_save" | "needs_review" | "duplicate_existing" | "duplicate_in_file" | "error" | "all";

const TABS: { tab: ReviewTab; label: string; count: (c: ReviewCounts) => number }[] = [
  { tab: "to_save", label: "저장 예정", count: (c) => c.toSave },
  { tab: "needs_review", label: "검토 필요", count: (c) => c.needs_review },
  { tab: "duplicate_existing", label: "기존 중복", count: (c) => c.duplicate_existing },
  { tab: "duplicate_in_file", label: "파일 내 중복", count: (c) => c.duplicate_in_file },
  { tab: "error", label: "오류", count: (c) => c.error },
  { tab: "all", label: "전체", count: (c) => c.total },
];

export const STATUS_LABELS: Record<PreviewStatus, string> = {
  new: "신규",
  needs_review: "검토 필요",
  duplicate_existing: "기존 중복 · 건너뜀",
  duplicate_in_file: "파일 내 중복 · 건너뜀",
  error: "오류 · 저장 안 함",
};

/** 탭에 속하는 행인지. */
function inTab(row: ReviewRow, tab: ReviewTab): boolean {
  if (tab === "all") return true;
  if (tab === "to_save") return isImportable(row.status);
  return row.status === tab;
}

interface ReviewListProps {
  rows: readonly ReviewRow[];
  counts: ReviewCounts;
  /** 행 흐름 지정(null이면 자동으로 되돌림) */
  onChooseFlow: (sourceRow: number, flow: Flow | null) => void;
  disabled?: boolean;
}

/** 검토 목록. */
export function ReviewList({ rows, counts, onChooseFlow, disabled }: ReviewListProps) {
  const [tab, setTab] = useState<ReviewTab>(() => (counts.needs_review > 0 ? "needs_review" : "to_save"));
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [tab]);

  const visible = useMemo(() => rows.filter((row) => inTab(row, tab)), [rows, tab]);
  const pages = Math.max(1, Math.ceil(visible.length / REVIEW_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const slice = visible.slice(current * REVIEW_PAGE_SIZE, (current + 1) * REVIEW_PAGE_SIZE);

  return (
    <section aria-labelledby="review-title" className="section">
      <div className="section-head">
        <h2 id="review-title">거래 미리보기</h2>
        <span className="muted">{tab === "to_save" ? `승인하면 ${counts.toSave}건을 저장합니다` : `${visible.length}건`}</span>
      </div>
      <div className="tabs" role="tablist" aria-label="미리보기 상태">
        {TABS.map((item) => (
          <button
            key={item.tab}
            type="button"
            role="tab"
            aria-selected={tab === item.tab}
            className="tab"
            onClick={() => setTab(item.tab)}
          >
            {item.label} <span className="tab__count">{item.count(counts)}</span>
          </button>
        ))}
      </div>
      {slice.length === 0 ? (
        <div className="status status--empty">이 상태의 행이 없습니다.</div>
      ) : (
        <ul className="tx-list" role="tabpanel">
          {slice.map((row) => (
            <ReviewItem key={row.sourceRow} row={row} onChooseFlow={onChooseFlow} disabled={disabled} />
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav className="pagination" aria-label="미리보기 페이지">
          <button type="button" className="btn" disabled={current === 0} onClick={() => setPage(current - 1)}>
            이전
          </button>
          <span aria-current="page">
            {current + 1} / {pages}
          </span>
          <button type="button" className="btn" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
            다음
          </button>
        </nav>
      )}
    </section>
  );
}

/** 검토 행 하나. */
function ReviewItem({ row, onChooseFlow, disabled }: { row: ReviewRow; onChooseFlow: ReviewListProps["onChooseFlow"]; disabled?: boolean }) {
  const category = [row.majorCategory, row.minorCategory].filter(Boolean).join(" · ");
  const importable = isImportable(row.status);
  const flowClass = row.status === "needs_review" ? "needs_review" : importable ? row.chosenFlow : "skipped";
  return (
    <li className={`tx tx--${flowClass}`}>
      <div className="tx__when">
        <span className="muted">{row.sourceRow}행</span>
        <span>{row.date ? row.date.replace(/-/g, ".") : "날짜 없음"}</span>
        {row.time && <span className="muted">{row.time.slice(0, 5)}</span>}
      </div>
      <div className="tx__main">
        <span className="tx__desc">{row.description || "(내용 없음)"}</span>
        <span className="muted">
          {row.sourceType || "(타입 없음)"}
          {category && ` · ${category}`} · {row.paymentMethod || "(결제수단 없음)"}
        </span>
        <span className="tags">
          <span className={`tag tag--status-${row.status}`}>{STATUS_LABELS[row.status]}</span>
          {row.validationCodes.map((code) => (
            <span key={code} className="tag tag--warn">
              {VALIDATION_LABELS[code] ?? code}
            </span>
          ))}
        </span>
      </div>
      <div className="tx__amount">{row.amount ? formatMoney(row.amount, row.currency) : "금액 오류"}</div>
      {importable ? (
        <label className="tx__flow">
          <span className="visually-hidden">{row.sourceRow}행 집계 분류</span>
          <select
            value={row.overridden ? row.chosenFlow : "auto"}
            disabled={disabled}
            onChange={(e) => onChooseFlow(row.sourceRow, e.target.value === "auto" ? null : (e.target.value as Flow))}
          >
            <option value="auto">자동: {FLOW_LABELS[row.flow]}</option>
            {FLOWS.filter((f) => f !== "needs_review").map((flow) => (
              <option key={flow} value={flow}>
                {FLOW_LABELS[flow]}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="tx__flow muted">저장하지 않음</span>
      )}
    </li>
  );
}
