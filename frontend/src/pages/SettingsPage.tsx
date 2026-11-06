/**
 * 설정: 원본 타입 → 집계 방향, 결제수단 → 카드 종류 매핑, 암호화 백업·병합 복원.
 * 매핑은 사용자가 고른 값만 저장하며 라벨로 추측하지 않는다.
 */
import { useState } from "react";

import { api, type PaymentMethodMapping, type TypeMapping } from "../api/client";
import { useApp } from "../app/AppContext";
import { BackupPanel } from "../components/BackupPanel";
import { StatusView } from "../components/StatusView";
import { type CardKind, type Flow, FLOW_LABELS, FLOWS } from "../domain/transaction";
import { useAsync } from "../hooks/useAsync";
import { APP_VERSION } from "../version";
import { CARD_KIND_LABELS } from "./CardsPage";

/** 설정 화면. */
export function SettingsPage() {
  const { dataVersion, notifyDataChanged } = useApp();
  const types = useAsync((signal) => api.typeMappings(signal), [dataVersion]);
  const payments = useAsync((signal) => api.paymentMappings(signal), [dataVersion]);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>설정</h1>
        </div>
      </div>

      <section className="card section" aria-labelledby="types-title">
        <h2 id="types-title">원본 타입 집계 방향</h2>
        <p className="muted">
          뱅크샐러드의 '타입'을 수익·지출·이체·환불 중 무엇으로 집계할지 정합니다. 바꾸면 그 타입의 자동 분류 거래가 다시 계산되고, 거래내역에서 직접 지정한 거래는 유지됩니다.
        </p>
        <StatusView state={types} isEmpty={(rows) => rows.length === 0} empty="아직 타입이 없습니다.">
          {(rows) => (
            <ul className="rows">
              {rows.map((row) => (
                <TypeRow key={row.source_type} row={row} onSaved={notifyDataChanged} />
              ))}
            </ul>
          )}
        </StatusView>
      </section>

      <section className="card section" aria-labelledby="payments-title">
        <h2 id="payments-title">결제수단 카드 종류</h2>
        <p className="muted">카드 사용 화면의 신용·체크 구분에 쓰입니다. 기타는 카드 합계에서 제외됩니다.</p>
        <StatusView state={payments} isEmpty={(rows) => rows.length === 0} empty="아직 가져온 결제수단이 없습니다.">
          {(rows) => (
            <ul className="rows">
              {rows.map((row) => (
                <PaymentRow key={row.source_label} row={row} onSaved={notifyDataChanged} />
              ))}
            </ul>
          )}
        </StatusView>
      </section>

      <BackupPanel onRestored={notifyDataChanged} />

      <section className="card section" aria-labelledby="about-title">
        <h2 id="about-title">정보</h2>
        <ul className="rows">
          <li className="row">
            <span>앱 버전</span>
            <b>{APP_VERSION}</b>
          </li>
          <li className="row">
            <span>데이터 저장 위치</span>
            <span>집 안 서버의 PostgreSQL(브라우저에는 저장하지 않음)</span>
          </li>
        </ul>
      </section>
    </>
  );
}

/** 저장 상태 표시용. */
type SaveState = "idle" | "saving" | "saved" | { error: string };

function SaveNote({ state }: { state: SaveState }) {
  if (state === "saving") return <span className="muted">저장 중…</span>;
  if (state === "saved") return <span className="muted">저장됨</span>;
  if (typeof state === "object")
    return (
      <span className="field-error" role="alert">
        {state.error}
      </span>
    );
  return null;
}

/** 타입 매핑 한 줄. */
function TypeRow({ row, onSaved }: { row: TypeMapping; onSaved: () => void }) {
  const [state, setState] = useState<SaveState>("idle");
  const effective = row.flow ?? row.default_flow;
  const save = async (flow: Flow) => {
    setState("saving");
    try {
      await api.saveTypeMapping(row.source_type, flow);
      setState("saved");
      onSaved();
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "저장하지 못했습니다." });
    }
  };
  return (
    <li className="row mapping-row">
      <span>
        <b>{row.source_type}</b> <span className="muted">{row.transaction_count}건</span>
        {!row.flow && row.default_flow && <span className="muted"> · 기본값</span>}
      </span>
      <span className="mapping-row__control">
        <label>
          <span className="visually-hidden">{row.source_type} 집계 방향</span>
          <select value={effective ?? ""} onChange={(e) => e.target.value && save(e.target.value as Flow)} disabled={state === "saving"} className={effective ? undefined : "select--warn"}>
            {!effective && <option value="">미분류(선택 필요)</option>}
            {FLOWS.filter((f) => f !== "needs_review").map((flow) => (
              <option key={flow} value={flow}>
                {FLOW_LABELS[flow]}
              </option>
            ))}
          </select>
        </label>
        <SaveNote state={state} />
      </span>
    </li>
  );
}

/** 결제수단 매핑 한 줄. */
function PaymentRow({ row, onSaved }: { row: PaymentMethodMapping; onSaved: () => void }) {
  const [state, setState] = useState<SaveState>("idle");
  const save = async (kind: CardKind) => {
    setState("saving");
    try {
      await api.savePaymentMapping(row.source_label, kind);
      setState("saved");
      onSaved();
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "저장하지 못했습니다." });
    }
  };
  return (
    <li className="row mapping-row">
      <span>
        <b>{row.source_label}</b> <span className="muted">{row.transaction_count}건</span>
      </span>
      <span className="mapping-row__control">
        <label>
          <span className="visually-hidden">{row.source_label} 카드 종류</span>
          <select value={row.card_kind ?? ""} onChange={(e) => e.target.value && save(e.target.value as CardKind)} disabled={state === "saving"} className={row.card_kind ? undefined : "select--warn"}>
            {!row.card_kind && <option value="">{CARD_KIND_LABELS.unmapped}</option>}
            {(["credit", "debit", "other"] as const).map((kind) => (
              <option key={kind} value={kind}>
                {CARD_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
        <SaveNote state={state} />
      </span>
    </li>
  );
}
