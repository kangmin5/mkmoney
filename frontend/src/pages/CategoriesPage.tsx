/**
 * 분류: 사용자 분류 이름(규칙·직접 지정)이 있으면 그것으로, 없으면 원본 대분류로 묶은 합계.
 * 원본 대분류·소분류는 개명·병합하지 않고 함께 표시한다. 지출은 카드대금 정산 제외.
 */
import { useState } from "react";

import { api, type CategoryTotal } from "../api/client";
import { useApp } from "../app/AppContext";
import { PeriodControls } from "../components/PeriodControls";
import { StatusView } from "../components/StatusView";
import { formatMoney, fromUnits, relativeHeight, toUnits } from "../domain/money";
import { formatRange } from "../domain/periods";
import { useAsync } from "../hooks/useAsync";

type CategoryFlow = "expense" | "income" | "refund" | "reimbursement";
const FLOW_TABS: { flow: CategoryFlow; label: string }[] = [
  { flow: "expense", label: "지출" },
  { flow: "income", label: "수익" },
  { flow: "refund", label: "환불" },
  { flow: "reimbursement", label: "경비 정산" },
];

/** 분류 묶음. */
export interface MajorGroup {
  currency: string;
  /** 묶음 이름: 사용자 분류 이름 또는 원본 대분류(null이면 분류 없음) */
  major: string | null;
  /** 사용자 분류가 붙은 거래가 포함됐는지 */
  isUserCategory: boolean;
  total: string;
  count: number;
  minors: CategoryTotal[];
}

/**
 * 행을 통화·묶음 이름(사용자 분류 우선, 없으면 원본 대분류)으로 묶는다(정수 단위 합산). 큰 순서.
 * 사용자 분류 "급여"와 원본 대분류 "급여"처럼 이름이 같으면 한 묶음으로 합치고, 각 행에 원본을 표시한다.
 */
export function groupByMajor(rows: readonly CategoryTotal[]): MajorGroup[] {
  const groups = new Map<string, { currency: string; major: string | null; isUserCategory: boolean; units: bigint; count: number; minors: CategoryTotal[] }>();
  for (const row of rows) {
    const name = row.category ?? row.major_category;
    const isUser = row.user_category !== null && row.user_category !== undefined;
    const key = `${row.currency}|${name ?? ""}|${name === null ? "null" : "v"}`;
    const group = groups.get(key) ?? { currency: row.currency, major: name, isUserCategory: false, units: 0n, count: 0, minors: [] };
    group.isUserCategory ||= isUser;
    group.units += toUnits(row.total);
    group.count += row.count;
    group.minors.push(row);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => (a.currency !== b.currency ? a.currency.localeCompare(b.currency) : b.units > a.units ? 1 : b.units < a.units ? -1 : 0))
    .map((g) => ({ currency: g.currency, major: g.major, isUserCategory: g.isUserCategory, total: fromUnits(g.units), count: g.count, minors: g.minors }));
}

/** 분류 화면. */
export function CategoriesPage() {
  const { period, setPeriod, dataVersion, navigate } = useApp();
  const [flow, setFlow] = useState<CategoryFlow>("expense");
  const result = useAsync((signal) => api.categories(period.start, period.end, flow, signal), [period.start, period.end, flow, dataVersion]);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">CATEGORIES · {formatRange(period.start, period.end)}</p>
          <h1>분류별 금액</h1>
        </div>
        <PeriodControls period={period} onChange={setPeriod} showComparison={false} />
      </div>
      <div className="segmented" role="group" aria-label="집계 종류">
        {FLOW_TABS.map((tab) => (
          <button key={tab.flow} type="button" aria-pressed={flow === tab.flow} onClick={() => setFlow(tab.flow)}>
            {tab.label}
          </button>
        ))}
      </div>
      <p className="basis">
        사용자 분류(규칙·직접 지정)가 있으면 그 이름으로, 없으면 원본 대분류 그대로 묶습니다. 원본 분류는 각 행에 함께 표시합니다.
        {flow === "expense" && " 카드대금 정산 출금과 이체·미분류는 제외합니다."}
      </p>
      <StatusView state={result} isEmpty={(rows) => rows.length === 0} empty="이 기간에 해당하는 거래가 없습니다.">
        {(rows) => {
          const groups = groupByMajor(rows);
          const max = groups.reduce((m, g) => (Number(g.total) > m ? Number(g.total) : m), 0);
          return (
            <ul className="category-list">
              {groups.map((group) => (
                <li key={`${group.currency}|${group.major ?? "null"}`} className="card category">
                  <button
                    type="button"
                    className="category__head"
                    onClick={() => navigate("transactions", { flow, category: group.major ?? "" })}
                    aria-label={`${group.major ?? "분류 없음"} 거래 보기`}
                  >
                    <span className="category__name">
                      {group.major ?? "(분류 없음)"}
                      {group.isUserCategory && <span className="tag tag--user">내 분류</span>}
                    </span>
                    <span className="category__total">{formatMoney(group.total, group.currency)}</span>
                  </button>
                  <span className="meter" aria-hidden="true">
                    <span style={{ width: `${relativeHeight(group.total, String(max))}%` }} />
                  </span>
                  <ul className="rows rows--compact">
                    {group.minors.map((minor) => (
                      <li key={`${minor.user_category ?? ""}|${minor.major_category ?? "null"}|${minor.minor_category ?? "null"}`} className="row">
                        <span>
                          {minor.user_category ? (
                            <span className="muted">원본: {[minor.major_category ?? "(대분류 없음)", minor.minor_category].filter(Boolean).join(" / ")}</span>
                          ) : (
                            minor.minor_category ?? "(소분류 없음)"
                          )}{" "}
                          <span className="muted">{minor.count}건</span>
                        </span>
                        <span>{formatMoney(minor.total, minor.currency)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          );
        }}
      </StatusView>
    </>
  );
}
