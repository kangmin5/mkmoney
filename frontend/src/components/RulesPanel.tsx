/**
 * 분류 규칙 관리: 목록(적용 순서)·추가·수정·삭제·사용 여부, 기존 거래에 적용(미리보기 → 승인).
 * 규칙은 가져오기 검토 화면에서 제안으로 쓰이며, 기존 거래는 승인한 경우에만 바뀐다.
 */
import { type FormEvent, useState } from "react";

import { api, type Rule, type RuleApplyPreview, type RuleInput } from "../api/client";
import { formatMoney } from "../domain/money";
import { type Flow, FLOW_LABELS, FLOWS } from "../domain/transaction";
import { useAsync } from "../hooks/useAsync";
import { StatusView } from "./StatusView";

const DIRECTION_LABELS: Record<RuleInput["direction"], string> = { in: "들어온 돈", out: "나간 돈", any: "전체" };
const EMPTY: RuleInput = {
  name: "",
  enabled: true,
  description_contains: "",
  source_type: null,
  direction: "in",
  min_amount: null,
  max_amount: null,
  flow: "income",
  user_category: null,
};

/** 금액 입력 정규화: 쉼표 제거. 비면 null, 형식이 틀리면 undefined. */
export function parseAmountInput(text: string): string | null | undefined {
  const value = text.replace(/,/g, "").trim();
  if (value === "") return null;
  return /^\d{1,16}(\.\d{1,4})?$/.test(value) ? value : undefined;
}

/** 규칙 조건을 한 줄로 요약한다. */
export function describeRule(rule: RuleInput): string {
  const parts = [`내용에 "${rule.description_contains}" 포함`];
  if (rule.source_type) parts.push(`타입 ${rule.source_type}`);
  if (rule.direction !== "any") parts.push(DIRECTION_LABELS[rule.direction]);
  if (rule.min_amount) parts.push(`${formatMoney(rule.min_amount, "KRW")} 이상`);
  if (rule.max_amount) parts.push(`${formatMoney(rule.max_amount, "KRW")} 미만`);
  return parts.join(" · ");
}

const toInput = (rule: Rule): RuleInput => ({
  name: rule.name,
  enabled: rule.enabled,
  description_contains: rule.description_contains,
  source_type: rule.source_type,
  direction: rule.direction,
  min_amount: rule.min_amount,
  max_amount: rule.max_amount,
  flow: rule.flow,
  user_category: rule.user_category,
});

/** 분류 규칙 패널. */
export function RulesPanel({ onChanged }: { onChanged: () => void }) {
  const [version, setVersion] = useState(0);
  const rules = useAsync((signal) => api.rules(signal), [version]);
  const [editing, setEditing] = useState<{ id: string | null; value: RuleInput } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setVersion((n) => n + 1);
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const move = (list: Rule[], index: number, delta: number) => {
    const ids = list.map((r) => r.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    void run(() => api.reorderRules(ids));
  };

  return (
    <section className="card section" aria-labelledby="rules-title">
      <h2 id="rules-title">분류 규칙</h2>
      <p className="muted">
        내용·금액 조건이 맞는 거래에 흐름과 내 분류 이름을 지정합니다. 예: "코어스톤" 입금 중 기준 금액 이상은 수익/급여, 미만은 경비 정산.
        가져오기 때는 제안으로만 쓰이고, 위에서부터 처음 맞는 규칙 하나만 적용됩니다.
      </p>
      <StatusView state={rules} isEmpty={(list) => list.length === 0 && !editing} empty="아직 규칙이 없습니다.">
        {(list) => (
          <ol className="rule-list">
            {list.map((rule, index) => (
              <li key={rule.id} className={rule.enabled ? "rule" : "rule rule--disabled"}>
                <div className="rule__main">
                  <b>
                    {index + 1}. {rule.name}
                  </b>
                  {!rule.enabled && <span className="tag">사용 안 함</span>}
                  <span className="muted">{describeRule(rule)}</span>
                  <span>
                    → {FLOW_LABELS[rule.flow]}
                    {rule.user_category && ` / ${rule.user_category}`}
                  </span>
                </div>
                <div className="rule__actions">
                  <button type="button" className="btn btn--icon" aria-label={`${rule.name} 위로`} disabled={busy || index === 0} onClick={() => move(list, index, -1)}>
                    ↑
                  </button>
                  <button type="button" className="btn btn--icon" aria-label={`${rule.name} 아래로`} disabled={busy || index === list.length - 1} onClick={() => move(list, index, 1)}>
                    ↓
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => setEditing({ id: rule.id, value: toInput(rule) })}>
                    수정
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`'${rule.name}' 규칙을 삭제할까요? 이미 지정된 거래는 바뀌지 않습니다.`)) void run(() => api.deleteRule(rule.id));
                    }}
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </StatusView>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {editing ? (
        <RuleForm
          initial={editing.value}
          isNew={editing.id === null}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSubmit={async (value) => {
            const ok = await run(() => (editing.id ? api.updateRule(editing.id, value) : api.createRule(value)));
            if (ok) setEditing(null);
          }}
        />
      ) : (
        <div className="actions">
          <button type="button" className="btn" onClick={() => setEditing({ id: null, value: EMPTY })}>
            규칙 추가
          </button>
        </div>
      )}

      <ApplyRules hasRules={rules.status === "success" && rules.data.some((r) => r.enabled)} onApplied={onChanged} />
    </section>
  );
}

/** 규칙 입력 폼. */
function RuleForm({ initial, isNew, busy, onSubmit, onCancel }: { initial: RuleInput; isNew: boolean; busy: boolean; onSubmit: (value: RuleInput) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [minText, setMinText] = useState(initial.min_amount ?? "");
  const [maxText, setMaxText] = useState(initial.max_amount ?? "");
  const min = parseAmountInput(minText);
  const max = parseAmountInput(maxText);
  const rangeError =
    min === undefined || max === undefined
      ? "금액은 숫자로 입력하세요(쉼표 가능, 소수 4자리까지)."
      : min !== null && max !== null && Number(min) >= Number(max)
        ? "'이상' 금액은 '미만' 금액보다 작아야 합니다."
        : null;
  const valid = value.name.trim() !== "" && value.description_contains.trim() !== "" && !rangeError;
  const set = <K extends keyof RuleInput>(key: K, v: RuleInput[K]) => setValue((prev) => ({ ...prev, [key]: v }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onSubmit({
      ...value,
      name: value.name.trim(),
      description_contains: value.description_contains.trim(),
      source_type: value.source_type?.trim() || null,
      user_category: value.user_category?.trim() || null,
      min_amount: min ?? null,
      max_amount: max ?? null,
    });
  };

  return (
    <form className="rule-form" onSubmit={submit} aria-label={isNew ? "규칙 추가" : "규칙 수정"}>
      <label className="field">
        <span>규칙 이름</span>
        <input type="text" value={value.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="예: 코어스톤 급여" required />
      </label>
      <label className="field">
        <span>내용에 포함된 글자</span>
        <input type="text" value={value.description_contains} maxLength={200} onChange={(e) => set("description_contains", e.target.value)} placeholder="예: 코어스톤" required />
      </label>
      <label className="field">
        <span>원본 타입(선택)</span>
        <input type="text" value={value.source_type ?? ""} maxLength={120} onChange={(e) => set("source_type", e.target.value || null)} placeholder="비우면 모든 타입" />
      </label>
      <label className="field">
        <span>방향</span>
        <select value={value.direction} onChange={(e) => set("direction", e.target.value as RuleInput["direction"])}>
          {(Object.keys(DIRECTION_LABELS) as RuleInput["direction"][]).map((d) => (
            <option key={d} value={d}>
              {DIRECTION_LABELS[d]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>금액 이상(선택, 원)</span>
        <input type="text" inputMode="decimal" value={minText} onChange={(e) => setMinText(e.target.value)} placeholder="예: 1,000,000" />
      </label>
      <label className="field">
        <span>금액 미만(선택, 원)</span>
        <input type="text" inputMode="decimal" value={maxText} onChange={(e) => setMaxText(e.target.value)} placeholder="예: 1,000,000" />
      </label>
      <label className="field">
        <span>집계 방향(결과)</span>
        <select value={value.flow} onChange={(e) => set("flow", e.target.value as Flow)}>
          {FLOWS.map((flow) => (
            <option key={flow} value={flow}>
              {FLOW_LABELS[flow]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>내 분류 이름(선택)</span>
        <input type="text" value={value.user_category ?? ""} maxLength={120} onChange={(e) => set("user_category", e.target.value || null)} placeholder="예: 급여, 회사 경비 정산" />
      </label>
      <label className="field field--inline">
        <input type="checkbox" checked={value.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        <span>사용</span>
      </label>
      {rangeError && <span className="field-error">{rangeError}</span>}
      <div className="actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          취소
        </button>
        <button type="submit" className="btn btn--primary" disabled={!valid || busy}>
          {isNew ? "추가" : "저장"}
        </button>
      </div>
    </form>
  );
}

/** 기존 거래에 적용: 미리보기(변경 없음) → 승인. */
function ApplyRules({ hasRules, onApplied }: { hasRules: boolean; onApplied: () => void }) {
  const [state, setState] = useState<
    { kind: "idle" | "loading" | "applying" } | { kind: "preview"; data: RuleApplyPreview } | { kind: "done"; updated: number } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const preview = async () => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "preview", data: await api.previewRules() });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "미리보기를 불러오지 못했습니다." });
    }
  };
  const apply = async () => {
    setState({ kind: "applying" });
    try {
      const result = await api.applyRules();
      onApplied();
      setState({ kind: "done", updated: result.updated });
    } catch (e) {
      setState({ kind: "error", message: `${e instanceof Error ? e.message : "적용하지 못했습니다."} 아무 거래도 바뀌지 않았습니다.` });
    }
  };
  return (
    <div className="backup-form" role="group" aria-labelledby="apply-rules-title">
      <h3 id="apply-rules-title">기존 거래에 적용</h3>
      <p className="muted">자동 분류된 거래 중 내 분류 이름이 없는 거래에만 적용합니다. 직접 지정한 거래는 바꾸지 않습니다.</p>
      {state.kind === "preview" ? (
        <div className="restore-preview">
          {state.data.matched === 0 ? (
            <p>규칙에 맞는 기존 거래가 없습니다.</p>
          ) : (
            <>
              <p>
                <b>{state.data.matched.toLocaleString("ko-KR")}건</b>이 바뀝니다.
              </p>
              <ul className="rows">
                {state.data.by_rule.map((r) => (
                  <li key={r.rule_id} className="row">
                    <span>{r.name}</span>
                    <b>{r.count.toLocaleString("ko-KR")}건</b>
                  </li>
                ))}
                {state.data.flow_changes.map((c) => (
                  <li key={`${c.from_flow}>${c.to_flow}`} className="row">
                    <span className="muted">
                      {FLOW_LABELS[c.from_flow]} → {FLOW_LABELS[c.to_flow]}
                    </span>
                    <span className="muted">{c.count.toLocaleString("ko-KR")}건</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="actions">
            <button type="button" className="btn" onClick={() => setState({ kind: "idle" })}>
              취소
            </button>
            <button type="button" className="btn btn--primary" disabled={state.data.matched === 0} onClick={apply}>
              {state.data.matched.toLocaleString("ko-KR")}건 적용 승인
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="btn" disabled={!hasRules || state.kind === "loading" || state.kind === "applying"} onClick={preview}>
            {state.kind === "loading" ? "확인 중…" : state.kind === "applying" ? "적용 중…" : "적용 미리보기"}
          </button>
        </div>
      )}
      {state.kind === "done" && <p role="status">{state.updated.toLocaleString("ko-KR")}건에 규칙을 적용했습니다.</p>}
      {state.kind === "error" && (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}
