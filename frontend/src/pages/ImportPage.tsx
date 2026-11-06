/**
 * 엑셀 가져오기: 파일 선택 → 브라우저 파싱 → 지문만 보내 중복 확인 → 검토 → 명시적 승인 → 신규 행 저장.
 * 원본 파일은 서버로 보내지 않으며, 승인 전에는 거래 값을 전송하지 않는다.
 */
import { type ChangeEvent, useMemo, useState } from "react";

import { api, type ImportResult, type Rule } from "../api/client";
import { useApp } from "../app/AppContext";
import { ReviewList } from "../components/ReviewList";
import { StatusView } from "../components/StatusView";
import { type Flow, FLOW_LABELS, FLOWS } from "../domain/transaction";
import { createFingerprint } from "../import/fingerprint";
import { applyOverrides, countReview, planCommit, reclassify } from "../import/plan";
import { type FingerprintedRow, hasError } from "../import/preview";
import { LEDGER_SHEET, parseWorkbook, WorkbookError } from "../import/workbook";
import { useAsync } from "../hooks/useAsync";

/** 검토 대상 파일 상태(브라우저 메모리에만 존재). */
interface ReviewData {
  fileName: string;
  sheetNames: string[];
  rows: FingerprintedRow[];
  existing: Set<string>;
}

type Stage =
  | { kind: "idle" }
  | { kind: "working"; label: string }
  | { kind: "failed"; message: string }
  | { kind: "review"; data: ReviewData; commitError?: string }
  | { kind: "committing"; data: ReviewData }
  | { kind: "done"; fileName: string; result: ImportResult; skipped: number };

/** 가져오기 화면. */
export function ImportPage() {
  const { notifyDataChanged, navigate } = useApp();
  // 타입 매핑과 분류 규칙을 함께 불러온다(규칙은 검토 화면에서 제안으로 쓴다).
  const mappingsState = useAsync(async (signal) => {
    const [types, rules] = await Promise.all([api.typeMappings(signal), api.rules(signal)]);
    return { types, rules };
  }, []);
  const [savedMappings, setSavedMappings] = useState<Record<string, Flow> | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [overrides, setOverrides] = useState<Map<number, Flow>>(new Map());
  const [inputKey, setInputKey] = useState(0);

  // 서버에 저장된 사용자 타입 매핑(기본 매핑 제외)
  const mappings = useMemo<Record<string, Flow>>(() => {
    if (savedMappings) return savedMappings;
    if (mappingsState.status !== "success") return {};
    return Object.fromEntries(mappingsState.data.types.filter((m) => m.flow).map((m) => [m.source_type, m.flow as Flow]));
  }, [savedMappings, mappingsState]);
  const rules = useMemo<Rule[]>(() => (mappingsState.status === "success" ? mappingsState.data.rules : []), [mappingsState]);

  const reset = () => {
    setStage({ kind: "idle" });
    setOverrides(new Map());
    setInputKey((n) => n + 1); // 같은 파일을 다시 고를 수 있게 input 초기화
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setOverrides(new Map());
    try {
      setStage({ kind: "working", label: "파일을 브라우저에서 읽는 중…" });
      const parsed = await parseWorkbook(file, mappings);
      setStage({ kind: "working", label: `${parsed.rows.length.toLocaleString("ko-KR")}행의 중복 지문을 계산하는 중…` });
      const rows: FingerprintedRow[] = [];
      for (const row of parsed.rows) {
        rows.push({ ...row, fingerprint: hasError(row) ? "" : await createFingerprint(row) });
      }
      const fingerprints = [...new Set(rows.map((r) => r.fingerprint).filter(Boolean))];
      setStage({ kind: "working", label: "저장된 거래와 중복을 확인하는 중…" });
      const existing = fingerprints.length ? (await api.checkFingerprints(fingerprints)).existing : [];
      setStage({ kind: "review", data: { fileName: parsed.fileName, sheetNames: parsed.sheetNames, rows, existing: new Set(existing) } });
    } catch (error) {
      const message =
        error instanceof WorkbookError || error instanceof Error ? error.message : "파일을 처리하지 못했습니다.";
      setStage({ kind: "failed", message });
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">IMPORT</p>
          <h1>거래 가져오기</h1>
          <p className="basis">파일은 이 브라우저에서만 읽습니다. 검토 후 승인한 새 거래만 집 서버에 저장합니다.</p>
        </div>
      </div>

      {(stage.kind === "idle" || stage.kind === "failed") && (
        <StatusView state={mappingsState} loadingLabel="분류 설정을 불러오는 중…">
          {() => (
            <div className="card file-pick">
              <label className="field">
                <span>뱅크샐러드 엑셀 파일(.xlsx)</span>
                <input key={inputKey} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} />
              </label>
              <p className="muted">
                '{LEDGER_SHEET}' 시트만 읽습니다. 다른 시트(예: 뱅샐현황)의 값은 읽거나 전송하지 않습니다. 최대 10MB.
              </p>
              {stage.kind === "failed" && (
                <p className="field-error" role="alert">
                  {stage.message}
                </p>
              )}
            </div>
          )}
        </StatusView>
      )}

      {stage.kind === "working" && (
        <div className="status status--loading" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          {stage.label}
        </div>
      )}

      {(stage.kind === "review" || stage.kind === "committing") && (
        <ReviewStage
          data={stage.data}
          mappings={mappings}
          rules={rules}
          overrides={overrides}
          committing={stage.kind === "committing"}
          commitError={stage.kind === "review" ? stage.commitError : undefined}
          onChooseFlow={(sourceRow, flow) =>
            setOverrides((prev) => {
              const next = new Map(prev);
              if (flow) next.set(sourceRow, flow);
              else next.delete(sourceRow);
              return next;
            })
          }
          onMappingSaved={(next) => {
            setSavedMappings(next);
            notifyDataChanged();
            setStage({ kind: "review", data: { ...stage.data, rows: reclassify(stage.data.rows, next) } });
          }}
          onCancel={reset}
          onApprove={async () => {
            const data = stage.data;
            const plan = planCommit(applyOverrides(data.rows, data.existing, overrides, rules));
            setStage({ kind: "committing", data });
            try {
              const result = await api.commitImport(data.fileName, plan.rows, plan.summary);
              notifyDataChanged();
              setStage({ kind: "done", fileName: data.fileName, result, skipped: data.rows.length - plan.rows.length });
            } catch (error) {
              const message = error instanceof Error ? error.message : "저장하지 못했습니다.";
              setStage({ kind: "review", data, commitError: message });
            }
          }}
        />
      )}

      {stage.kind === "done" && (
        <div className="card section" role="status">
          <h2>저장 완료</h2>
          <p>
            {stage.fileName}에서 새 거래 <b>{stage.result.inserted.toLocaleString("ko-KR")}건</b>을 저장했습니다.
          </p>
          <ul className="rows">
            <li className="row">
              <span>저장하지 않은 행(중복·오류)</span>
              <b>{stage.skipped.toLocaleString("ko-KR")}건</b>
            </li>
            {stage.result.duplicate > 0 && (
              <li className="row">
                <span>저장 중 이미 있던 거래로 확인되어 건너뜀</span>
                <b>{stage.result.duplicate.toLocaleString("ko-KR")}건</b>
              </li>
            )}
          </ul>
          <div className="actions">
            <button type="button" className="btn" onClick={reset}>
              다른 파일 가져오기
            </button>
            <button type="button" className="btn btn--primary" onClick={() => navigate("dashboard")}>
              현황 보기
            </button>
          </div>
        </div>
      )}
    </>
  );
}

interface ReviewStageProps {
  data: ReviewData;
  mappings: Record<string, Flow>;
  rules: Rule[];
  overrides: Map<number, Flow>;
  committing: boolean;
  commitError?: string;
  onChooseFlow: (sourceRow: number, flow: Flow | null) => void;
  onMappingSaved: (mappings: Record<string, Flow>) => void;
  onCancel: () => void;
  onApprove: () => void;
}

/** 검토 단계: 파일·시트, 건수, 규칙 안내, 모르는 타입 매핑, 미리보기, 승인. */
function ReviewStage({ data, mappings, rules, overrides, committing, commitError, onChooseFlow, onMappingSaved, onCancel, onApprove }: ReviewStageProps) {
  const rows = useMemo(() => applyOverrides(data.rows, data.existing, overrides, rules), [data, overrides, rules]);
  const ruleHits = rows.filter((r) => r.ruleName && !r.overridden).length;
  const counts = useMemo(() => countReview(rows), [rows]);
  const unknownTypes = useMemo(
    () => [...new Set(data.rows.filter((r) => r.validationCodes.includes("unknown_type")).map((r) => r.sourceType))].sort(),
    [data.rows],
  );
  const otherSheets = data.sheetNames.filter((name) => name !== LEDGER_SHEET);

  return (
    <>
      <div className="card file-summary">
        <div>
          <strong>{data.fileName}</strong>
          <p className="muted">
            가져올 시트: <b>{LEDGER_SHEET} ✓</b>
            {otherSheets.length > 0 && ` · 읽지 않은 시트: ${otherSheets.join(", ")}`}
          </p>
        </div>
      </div>

      <dl className="counts">
        <Count label="전체 행" value={counts.total} />
        <Count label="신규 추가" value={counts.new} tone="new" />
        <Count label="검토 필요" value={counts.needs_review} tone={counts.needs_review ? "warn" : undefined} />
        <Count label="기존 중복 제외" value={counts.duplicate_existing} />
        <Count label="파일 내 중복 제외" value={counts.duplicate_in_file} />
        <Count label="오류(저장 안 함)" value={counts.error} tone={counts.error ? "error" : undefined} />
      </dl>

      <div className="notice notice--warn" role="note">
        중복 판정: 날짜·시간·타입·금액·화폐·결제수단·내용이 모두 같은 거래는 건너뜁니다. 대분류·소분류·메모가 달라도 기존 거래는 수정하지 않습니다.
      </div>

      {ruleHits > 0 && (
        <p className="basis">
          분류 규칙으로 {ruleHits}건의 흐름·분류 이름을 제안했습니다. 행마다 바꿀 수 있고, 승인해야 저장됩니다.
        </p>
      )}

      {unknownTypes.length > 0 && <UnknownTypes types={unknownTypes} mappings={mappings} onSaved={onMappingSaved} disabled={committing} />}

      <ReviewList rows={rows} counts={counts} onChooseFlow={onChooseFlow} disabled={committing} />

      <div className="approve-bar">
        {commitError && (
          <p className="field-error" role="alert">
            저장하지 못했습니다: {commitError} 아무 거래도 반영되지 않았습니다. 다시 시도해도 중복은 추가되지 않습니다.
          </p>
        )}
        {counts.needs_review > 0 && (
          <p className="muted">검토 필요 {counts.needs_review}건은 미분류로 저장되어 합계에서 빠지며, 거래내역에서 나중에 분류할 수 있습니다.</p>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel} disabled={committing}>
            취소
          </button>
          <button type="button" className="btn btn--primary" onClick={onApprove} disabled={committing || counts.toSave === 0}>
            {committing ? "저장 중…" : counts.toSave === 0 ? "저장할 새 거래 없음" : `신규 ${counts.toSave.toLocaleString("ko-KR")}건 저장 승인`}
          </button>
        </div>
      </div>
    </>
  );
}

/** 건수 칸. */
function Count({ label, value, tone }: { label: string; value: number; tone?: "new" | "warn" | "error" }) {
  return (
    <div className={tone ? `count count--${tone}` : "count"}>
      <dt>{label}</dt>
      <dd>{value.toLocaleString("ko-KR")}</dd>
    </div>
  );
}

/** 알 수 없는 원본 타입의 흐름 지정(저장하면 다음 가져오기에도 적용). */
function UnknownTypes({ types, mappings, onSaved, disabled }: { types: string[]; mappings: Record<string, Flow>; onSaved: (m: Record<string, Flow>) => void; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "saving" | { error: string }>("idle");
  const save = async (sourceType: string, flow: Flow) => {
    setState("saving");
    try {
      await api.saveTypeMapping(sourceType, flow);
      setState("idle");
      onSaved({ ...mappings, [sourceType]: flow });
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "저장하지 못했습니다." });
    }
  };
  return (
    <section className="card section" aria-labelledby="unknown-types-title">
      <h2 id="unknown-types-title">알 수 없는 타입</h2>
      <p className="muted">원본 타입의 집계 방향을 정하면 이 파일과 다음 가져오기에 적용됩니다. 정하지 않으면 미분류로 둡니다.</p>
      <ul className="rows">
        {types.map((type) => (
          <li key={type} className="row">
            <span>{type}</span>
            <label>
              <span className="visually-hidden">{type} 집계 방향</span>
              <select defaultValue="" disabled={disabled || state === "saving"} onChange={(e) => e.target.value && save(type, e.target.value as Flow)}>
                <option value="">선택</option>
                {FLOWS.filter((f) => f !== "needs_review").map((flow) => (
                  <option key={flow} value={flow}>
                    {FLOW_LABELS[flow]}
                  </option>
                ))}
              </select>
            </label>
          </li>
        ))}
      </ul>
      {typeof state === "object" && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </section>
  );
}
