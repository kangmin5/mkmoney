/**
 * 카드 사용: 결제수단별 실제 구매·환불·순사용액과 신용/체크 합계.
 * 카드 종류는 사용자가 저장한 매핑만 쓰고 라벨로 추측하지 않는다. 미지정 라벨은 "분류 필요"로 표시한다.
 */
import { useState } from "react";

import { api, type CardKindUsage, type PaymentMethodUsage } from "../api/client";
import { useApp } from "../app/AppContext";
import { PeriodControls } from "../components/PeriodControls";
import { StatusView } from "../components/StatusView";
import { formatMoney, signOf } from "../domain/money";
import { formatRange } from "../domain/periods";
import type { CardKind } from "../domain/transaction";
import { useAsync } from "../hooks/useAsync";

export const CARD_KIND_LABELS: Record<CardKind | "unmapped", string> = {
  credit: "신용카드",
  debit: "체크카드",
  other: "기타(카드 아님)",
  unmapped: "분류 필요",
};
const KIND_ORDER: (CardKind | "unmapped")[] = ["credit", "debit", "unmapped", "other"];

/** 카드 사용 화면. */
export function CardsPage() {
  const { period, setPeriod, dataVersion, notifyDataChanged, navigate } = useApp();
  const result = useAsync((signal) => api.cards(period.start, period.end, signal), [period.start, period.end, dataVersion]);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">CARDS · {formatRange(period.start, period.end)}</p>
          <h1>카드 사용</h1>
        </div>
        <PeriodControls period={period} onChange={setPeriod} showComparison={false} />
      </div>
      <p className="basis">실제 구매 지출 기준입니다. 카드대금 정산 출금은 제외하고, 환불은 차감합니다. 기타로 지정한 결제수단은 카드 합계에서 뺍니다.</p>
      <StatusView state={result} isEmpty={(data) => data.methods.length === 0} empty="이 기간의 결제 내역이 없습니다.">
        {(data) => (
          <>
            {data.by_kind.some((k) => k.card_kind === "unmapped") && (
              <div className="notice notice--warn" role="note">
                카드 종류가 지정되지 않은 결제수단이 있습니다. 아래 목록에서 신용·체크·기타를 선택하세요. 선택은 다음 조회와 가져오기에도 유지됩니다.
              </div>
            )}
            <KindTotals rows={data.by_kind} />
            <ul className="method-list">
              {[...data.methods]
                .sort((a, b) => KIND_ORDER.indexOf(a.card_kind ?? "unmapped") - KIND_ORDER.indexOf(b.card_kind ?? "unmapped"))
                .map((method) => (
                  <MethodItem
                    key={`${method.payment_method}|${method.currency}`}
                    method={method}
                    onSaved={notifyDataChanged}
                    onOpen={() => navigate("transactions", { payment_method: method.payment_method })}
                  />
                ))}
            </ul>
          </>
        )}
      </StatusView>
    </>
  );
}

/** 카드 종류별 합계. */
function KindTotals({ rows }: { rows: CardKindUsage[] }) {
  const sorted = [...rows].sort((a, b) => a.currency.localeCompare(b.currency) || KIND_ORDER.indexOf(a.card_kind) - KIND_ORDER.indexOf(b.card_kind));
  const multi = new Set(rows.map((r) => r.currency)).size > 1;
  return (
    <dl className="kpis">
      {sorted.map((row) => (
        <div key={`${row.currency}|${row.card_kind}`} className={`metric metric--${row.card_kind}`}>
          <dt>
            {CARD_KIND_LABELS[row.card_kind]}
            {multi && ` · ${row.currency}`}
          </dt>
          <dd>
            <strong className="metric__value">{formatMoney(row.net, row.currency)}</strong>
            <span className="metric__note">
              구매 {formatMoney(row.purchase, row.currency)}
              {signOf(row.refund) !== 0 && ` − 환불 ${formatMoney(row.refund, row.currency)}`}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** 결제수단 한 줄 + 카드 종류 선택. */
function MethodItem({ method, onSaved, onOpen }: { method: PaymentMethodUsage; onSaved: () => void; onOpen: () => void }) {
  const [state, setState] = useState<"idle" | "saving" | { error: string }>("idle");
  const save = async (kind: CardKind) => {
    setState("saving");
    try {
      await api.savePaymentMapping(method.payment_method, kind);
      setState("idle");
      onSaved();
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "저장하지 못했습니다." });
    }
  };
  return (
    <li className="card method">
      <button type="button" className="method__name" onClick={onOpen} aria-label={`${method.payment_method} 거래 보기`}>
        {method.payment_method}
        <span className="muted">{method.count}건</span>
      </button>
      <div className="method__amount">
        <strong>{formatMoney(method.net, method.currency)}</strong>
        {signOf(method.refund) !== 0 && (
          <span className="muted">
            구매 {formatMoney(method.purchase, method.currency)} − 환불 {formatMoney(method.refund, method.currency)}
          </span>
        )}
      </div>
      <label className="method__kind">
        <span className="visually-hidden">{method.payment_method} 카드 종류</span>
        <select
          value={method.card_kind ?? ""}
          onChange={(e) => e.target.value && save(e.target.value as CardKind)}
          disabled={state === "saving"}
          className={method.card_kind ? undefined : "select--warn"}
        >
          {!method.card_kind && <option value="">분류 필요</option>}
          <option value="credit">신용카드</option>
          <option value="debit">체크카드</option>
          <option value="other">기타(카드 아님)</option>
        </select>
        {typeof state === "object" && (
          <span className="field-error" role="alert">
            {state.error}
          </span>
        )}
      </label>
    </li>
  );
}
