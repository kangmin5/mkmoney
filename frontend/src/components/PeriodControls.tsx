/**
 * 기간 선택: 월별(이전/다음 달) 또는 직접 지정, 비교 기준 선택.
 */
import { useEffect, useState } from "react";

import {
  COMPARISON_LABELS,
  type ComparisonMode,
  formatYearMonth,
  isValidRange,
  monthPeriod,
  type Period,
  shiftYearMonth,
  todayInSeoul,
} from "../domain/periods";

interface PeriodControlsProps {
  period: Period;
  onChange: (period: Period) => void;
  /** 비교 기준 선택 표시 여부 */
  showComparison?: boolean;
}

/** 기간·비교 기준 컨트롤. 터치 크기(44px)와 키보드 조작을 지원한다. */
export function PeriodControls({ period, onChange, showComparison = true }: PeriodControlsProps) {
  const today = todayInSeoul();
  const month = period.start.slice(0, 7);
  const [draft, setDraft] = useState({ start: period.start, end: period.end });
  useEffect(() => {
    setDraft({ start: period.start, end: period.end });
  }, [period.start, period.end]);
  const draftValid = isValidRange(draft.start, draft.end);

  const setKind = (kind: Period["kind"]) => {
    if (kind === period.kind) return;
    if (kind === "month") onChange(monthPeriod(month, today));
    else onChange({ ...period, kind: "custom", comparison: "previous_period" });
  };

  return (
    <div className="period-controls">
      <div className="segmented" role="group" aria-label="기간 단위">
        <button type="button" aria-pressed={period.kind === "month"} onClick={() => setKind("month")}>
          월별
        </button>
        <button type="button" aria-pressed={period.kind === "custom"} onClick={() => setKind("custom")}>
          기간별
        </button>
      </div>

      {period.kind === "month" ? (
        <div className="month-stepper" role="group" aria-label="조회 월">
          <button type="button" className="btn btn--icon" aria-label="이전 달" onClick={() => onChange(monthPeriod(shiftYearMonth(month, -1), today, period.comparison))}>
            ‹
          </button>
          <span className="month-stepper__label" aria-live="polite">
            {formatYearMonth(month)}
          </span>
          <button
            type="button"
            className="btn btn--icon"
            aria-label="다음 달"
            disabled={month >= today.slice(0, 7)}
            onClick={() => onChange(monthPeriod(shiftYearMonth(month, 1), today, period.comparison))}
          >
            ›
          </button>
        </div>
      ) : (
        <form
          className="range-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (draftValid) onChange({ ...period, start: draft.start, end: draft.end });
          }}
        >
          <label>
            <span>시작일</span>
            <input type="date" value={draft.start} max={draft.end || undefined} onChange={(e) => setDraft({ ...draft, start: e.target.value })} required />
          </label>
          <label>
            <span>종료일</span>
            <input type="date" value={draft.end} min={draft.start || undefined} onChange={(e) => setDraft({ ...draft, end: e.target.value })} required />
          </label>
          <button type="submit" className="btn btn--primary" disabled={!draftValid}>
            적용
          </button>
          {!draftValid && <span className="field-error">시작일이 종료일보다 늦을 수 없습니다.</span>}
        </form>
      )}

      {showComparison && (
        <label className="comparison-select">
          <span>비교</span>
          <select value={period.comparison} onChange={(e) => onChange({ ...period, comparison: e.target.value as ComparisonMode })}>
            {(Object.keys(COMPARISON_LABELS) as ComparisonMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {COMPARISON_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
