/**
 * 분류: 원본 대분류·소분류별 합계(개명·병합 없음). 지출은 카드대금 정산 제외.
 */
import { useState } from "react";

import { api, type CategoryTotal } from "../api/client";
import { useApp } from "../app/AppContext";
import { PeriodControls } from "../components/PeriodControls";
import { StatusView } from "../components/StatusView";
import { formatMoney, fromUnits, relativeHeight, toUnits } from "../domain/money";
import { formatRange } from "../domain/periods";
import { useAsync } from "../hooks/useAsync";

type CategoryFlow = "expense" | "income" | "refund";
const FLOW_TABS: { flow: CategoryFlow; label: string }[] = [
  { flow: "expense", label: "지출" },
  { flow: "income", label: "수익" },
  { flow: "refund", label: "환불" },
];

/** 대분류 묶음. */
export interface MajorGroup {
  currency: string;
  /** 원본 대분류(null이면 대분류 없음) */
  major: string | null;
  total: string;
  count: number;
  minors: CategoryTotal[];
}

/** 소분류 행을 통화·대분류로 묶는다(정수 단위 합산). 큰 순서. */
export function groupByMajor(rows: readonly CategoryTotal[]): MajorGroup[] {
  const groups = new Map<string, { currency: string; major: string | null; units: bigint; count: number; minors: CategoryTotal[] }>();
  for (const row of rows) {
    const key = `${row.currency}|${row.major_category ?? ""}|${row.major_category === null ? "null" : "v"}`;
    const group = groups.get(key) ?? { currency: row.currency, major: row.major_category, units: 0n, count: 0, minors: [] };
    group.units += toUnits(row.total);
    group.count += row.count;
    group.minors.push(row);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => (a.currency !== b.currency ? a.currency.localeCompare(b.currency) : b.units > a.units ? 1 : b.units < a.units ? -1 : 0))
    .map((g) => ({ currency: g.currency, major: g.major, total: fromUnits(g.units), count: g.count, minors: g.minors }));
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
        원본 대분류·소분류 이름 그대로 집계합니다.{flow === "expense" && " 카드대금 정산 출금과 이체·미분류는 제외합니다."}
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
                    onClick={() => navigate("transactions", { flow, major_category: group.major ?? "" })}
                    aria-label={`${group.major ?? "대분류 없음"} 거래 보기`}
                  >
                    <span className="category__name">{group.major ?? "(대분류 없음)"}</span>
                    <span className="category__total">{formatMoney(group.total, group.currency)}</span>
                  </button>
                  <span className="meter" aria-hidden="true">
                    <span style={{ width: `${relativeHeight(group.total, String(max))}%` }} />
                  </span>
                  <ul className="rows rows--compact">
                    {group.minors.map((minor) => (
                      <li key={minor.minor_category ?? "null"} className="row">
                        <span>
                          {minor.minor_category ?? "(소분류 없음)"} <span className="muted">{minor.count}건</span>
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
