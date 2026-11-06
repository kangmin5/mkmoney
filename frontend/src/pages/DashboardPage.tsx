/**
 * 자금 현황: 기간별 수익·지출·차액(통화별), 비교 기준, 월별 흐름, 분류별 지출, 최근 가져오기.
 */
import { api, type CategoryTotal, type CurrencySummary, type ImportBatch, type MonthlyFlow, type SummaryResponse } from "../api/client";
import { useApp } from "../app/AppContext";
import { MetricCard } from "../components/MetricCard";
import { PeriodControls } from "../components/PeriodControls";
import { StatusView } from "../components/StatusView";
import { formatMoney, fromUnits, percentChange, relativeHeight, toUnits } from "../domain/money";
import { COMPARISON_LABELS, formatRange, type Period, todayInSeoul } from "../domain/periods";
import { useAsync } from "../hooks/useAsync";

/** 기간에 맞는 제목. */
export function periodTitle(period: Period, today: string = todayInSeoul()): string {
  if (period.kind === "custom") return "기간 자금 흐름";
  if (period.start.slice(0, 7) === today.slice(0, 7)) return "이번 달 자금 흐름";
  return `${Number(period.start.slice(5, 7))}월 자금 흐름`;
}

/** 비교 변화 문구(예: 전월 같은 기간보다 4.2% ↑). */
function changeNote(current: string, previous: string, label: string): string {
  const pct = percentChange(current, previous);
  if (pct === null) return `${label} 데이터 없음`;
  const diff = toUnits(current) - toUnits(previous);
  if (diff === 0n) return `${label}과 같음`;
  return `${label}보다 ${pct} ${diff > 0n ? "↑" : "↓"}`;
}

/** 대시보드. */
export function DashboardPage() {
  const { period, setPeriod, dataVersion, navigate } = useApp();
  const summary = useAsync((signal) => api.summary(period.start, period.end, period.comparison, signal), [period, dataVersion]);
  const monthly = useAsync((signal) => api.monthly(period.end, 6, signal), [period.end, dataVersion]);
  const categories = useAsync((signal) => api.categories(period.start, period.end, "expense", signal), [period.start, period.end, dataVersion]);
  const imports = useAsync((signal) => api.recentImports(3, signal), [dataVersion]);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">PERSONAL FINANCE · {formatRange(period.start, period.end)}</p>
          <h1>{periodTitle(period)}</h1>
        </div>
        <PeriodControls period={period} onChange={setPeriod} />
      </div>

      <section aria-labelledby="summary-title" className="section">
        <h2 id="summary-title" className="visually-hidden">
          기간 요약
        </h2>
        <StatusView
          state={summary}
          isEmpty={(data) => data.currencies.length === 0 && data.unresolved_count === 0}
          empty={
            <>
              이 기간에 반영된 거래가 없습니다. <a href="#import">엑셀 가져오기</a>로 시작해 보세요.
            </>
          }
        >
          {(data) => <SummaryView data={data} onReview={() => navigate("transactions", { flow: "needs_review" })} />}
        </StatusView>
      </section>

      <section aria-labelledby="monthly-title" className="card section">
        <div className="section-head">
          <h2 id="monthly-title">월별 수익과 지출</h2>
          <span className="muted">최근 6개월 · 순지출 기준</span>
        </div>
        <StatusView state={monthly} isEmpty={(rows) => rows.length === 0} empty="최근 6개월 거래가 없습니다.">
          {(rows) => <MonthlyChart rows={rows} />}
        </StatusView>
      </section>

      <div className="grid-2 section">
        <section aria-labelledby="category-title" className="card">
          <div className="section-head">
            <h2 id="category-title">분류별 지출</h2>
            <a href="#categories" className="muted">
              전체 보기 →
            </a>
          </div>
          <StatusView state={categories} isEmpty={(rows) => rows.length === 0} empty="이 기간의 지출이 없습니다.">
            {(rows) => <TopCategories rows={rows} />}
          </StatusView>
        </section>
        <section aria-labelledby="imports-title" className="card">
          <div className="section-head">
            <h2 id="imports-title">최근 가져오기</h2>
            <a href="#import" className="muted">
              가져오기 →
            </a>
          </div>
          <StatusView state={imports} isEmpty={(rows) => rows.length === 0} empty="아직 가져온 파일이 없습니다.">
            {(rows) => <RecentImports rows={rows} />}
          </StatusView>
        </section>
      </div>
    </>
  );
}

/** 통화별 KPI와 비교·제외 안내. */
function SummaryView({ data, onReview }: { data: SummaryResponse; onReview: () => void }) {
  const label = COMPARISON_LABELS[data.comparison_mode];
  return (
    <>
      {data.unresolved_count > 0 && (
        <div className="notice notice--warn" role="note">
          <span>미분류 거래 {data.unresolved_count}건은 합계에서 제외되었습니다.</span>
          <button type="button" className="btn" onClick={onReview}>
            분류하기
          </button>
        </div>
      )}
      {data.currencies.map((cur) => (
        <CurrencyKpis key={cur.currency} summary={cur} label={label} showCurrency={data.currencies.length > 1} />
      ))}
      <p className="basis">
        비교: {label} ({formatRange(data.comparison_start, data.comparison_end)}) · {exclusionNote(data)}통화별 합계(환산 없음)
      </p>
    </>
  );
}

/** 합계에서 뺀 이체·카드대금 정산 안내(없으면 빈 문자열). */
function exclusionNote(data: SummaryResponse): string {
  const parts = [
    data.transfer_count > 0 ? `이체 ${data.transfer_count}건` : "",
    data.card_settlement_count > 0 ? `카드대금 정산 ${data.card_settlement_count}건` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")}은 수익·지출에서 제외 · ` : "";
}

/** 한 통화의 KPI 3개. */
function CurrencyKpis({ summary, label, showCurrency }: { summary: CurrencySummary; label: string; showCurrency: boolean }) {
  const { current, previous, currency } = summary;
  const hasRefund = toUnits(current.refund) !== 0n;
  const hasReimbursement = toUnits(current.reimbursement) !== 0n;
  return (
    <div className="kpi-block">
      {showCurrency && <h3 className="kpi-block__currency">{currency}</h3>}
      <dl className="kpis">
        <MetricCard label="수익" value={formatMoney(current.income, currency)} note={changeNote(current.income, previous.income, label)} />
        <MetricCard
          label="지출"
          value={formatMoney(current.net_expense, currency)}
          note={
            <>
              {changeNote(current.net_expense, previous.net_expense, label)}
              {(hasRefund || hasReimbursement) && (
                <span className="metric__sub">
                  총지출 {formatMoney(current.gross_expense, currency)}
                  {hasRefund && ` − 환불 ${formatMoney(current.refund, currency)}`}
                  {hasReimbursement && ` − 경비 정산 ${formatMoney(current.reimbursement, currency)}`}
                </span>
              )}
            </>
          }
        />
        <MetricCard wide label="차액" value={formatMoney(current.net_cashflow, currency)} note="수익 − 지출" />
      </dl>
    </div>
  );
}

/** CSS 막대 월별 차트(통화별). 막대마다 접근 가능한 설명을 둔다. */
function MonthlyChart({ rows }: { rows: MonthlyFlow[] }) {
  const currencies = [...new Set(rows.map((r) => r.currency))];
  return (
    <>
      {currencies.map((currency) => {
        const items = rows.filter((r) => r.currency === currency);
        const max = items.reduce((m, r) => Math.max(m, Math.abs(Number(r.income)), Math.abs(Number(r.net_expense))), 0);
        return (
          <figure key={currency} className="chart">
            {currencies.length > 1 && <figcaption>{currency}</figcaption>}
            <ul className="chart__bars">
              {items.map((r) => (
                <li key={r.month} aria-label={`${Number(r.month.slice(5))}월 수익 ${formatMoney(r.income, currency)}, 지출 ${formatMoney(r.net_expense, currency)}`}>
                  <span className="bar bar--in" style={{ height: `${relativeHeight(r.income, String(max))}%` }} />
                  <span className="bar bar--out" style={{ height: `${relativeHeight(r.net_expense, String(max))}%` }} />
                  <span className="chart__label" aria-hidden="true">
                    {Number(r.month.slice(5))}월
                  </span>
                </li>
              ))}
            </ul>
            <div className="chart__legend" aria-hidden="true">
              <span className="legend legend--in">수익</span>
              <span className="legend legend--out">지출</span>
            </div>
          </figure>
        );
      })}
    </>
  );
}

/** 대분류 상위 5개(원본 라벨 그대로). */
function TopCategories({ rows }: { rows: CategoryTotal[] }) {
  const totals = new Map<string, { currency: string; major: string; total: bigint }>();
  // 소분류를 대분류로 묶는다. 합산은 정수(최소 단위 1/10000)로 해서 부동소수점 오차를 피한다.
  for (const row of rows) {
    const major = row.category ?? row.major_category ?? "(분류 없음)";
    const key = `${row.currency}|${major}`;
    const units = toUnits(row.total);
    const prev = totals.get(key);
    totals.set(key, { currency: row.currency, major, total: (prev?.total ?? 0n) + units });
  }
  const top = [...totals.values()].sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0)).slice(0, 5);
  return (
    <ul className="rows">
      {top.map((item) => (
        <li key={`${item.currency}|${item.major}`} className="row">
          <span>{item.major}</span>
          <b>{formatMoney(fromUnits(item.total), item.currency)}</b>
        </li>
      ))}
    </ul>
  );
}

/** 최근 가져오기 요약. */
function RecentImports({ rows }: { rows: ImportBatch[] }) {
  return (
    <ul className="rows">
      {rows.map((batch) => (
        <li key={batch.id} className="row row--stack">
          <span className="row__title">
            {batch.file_name}
            <time className="muted" dateTime={batch.imported_at}>
              {new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(batch.imported_at))}
            </time>
          </span>
          <span className="tags">
            <span className="tag tag--new">신규 {batch.inserted_count}건</span>
            <span className="tag">중복 제외 {batch.duplicate_count + batch.in_file_duplicate_count}건</span>
            {batch.review_count > 0 && <span className="tag tag--warn">검토 {batch.review_count}건</span>}
            {batch.error_count > 0 && <span className="tag tag--error">오류 {batch.error_count}건</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
