/**
 * 암호화 백업 내보내기와 병합 복원. 암호는 이 컴포넌트 상태에만 잠시 두고 작업 후 지운다.
 * 복원은 미리보기 → 승인 순서이며 기존 거래·매핑을 덮어쓰거나 삭제하지 않는다.
 */
import { type FormEvent, useState } from "react";

import { api, checkAllFingerprints, type RestoreResult } from "../api/client";
import { todayInSeoul } from "../domain/periods";
import { backupFileName, decryptBackup, encryptBackup, MIN_PASSPHRASE_LENGTH } from "../storage/backup";
import { planRestore, type RestorePlan, verifyBackupFingerprints } from "../storage/restore";

const errorText = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback);

/** 백업·복원 패널. */
export function BackupPanel({ onRestored }: { onRestored: () => void }) {
  return (
    <section className="card section" aria-labelledby="backup-title">
      <h2 id="backup-title">암호화 백업·복원</h2>
      <p className="muted">
        백업 파일은 이 브라우저에서 암호화한 뒤 내려받습니다. 서버에는 암호도 백업 파일도 남지 않습니다.{" "}
        <b>암호를 잊으면 백업을 복원할 수 없습니다.</b>
      </p>
      <ExportForm />
      <RestoreForm onRestored={onRestored} />
    </section>
  );
}

/** 백업 내보내기. */
function ExportForm() {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "working" } | { kind: "done"; count: number; name: string } | { kind: "error"; message: string }>({ kind: "idle" });
  const tooShort = passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== passphrase;
  const ready = passphrase.length >= MIN_PASSPHRASE_LENGTH && confirm === passphrase;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setState({ kind: "working" });
    try {
      const payload = await api.exportBackup();
      const blob = await encryptBackup(payload, passphrase);
      const name = backupFileName(todayInSeoul());
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setState({ kind: "done", count: payload.transactions.length, name });
    } catch (error) {
      setState({ kind: "error", message: errorText(error, "백업을 만들지 못했습니다.") });
    } finally {
      setPassphrase("");
      setConfirm("");
    }
  };

  return (
    <form className="backup-form" onSubmit={submit} aria-labelledby="export-title">
      <h3 id="export-title">백업 만들기</h3>
      <label className="field">
        <span>백업 암호({MIN_PASSPHRASE_LENGTH}자 이상)</span>
        <input type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      </label>
      <label className="field">
        <span>암호 확인</span>
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      {tooShort && <span className="field-error">암호는 {MIN_PASSPHRASE_LENGTH}자 이상이어야 합니다.</span>}
      {mismatch && <span className="field-error">암호 확인이 일치하지 않습니다.</span>}
      <div className="actions">
        <button type="submit" className="btn btn--primary" disabled={!ready || state.kind === "working"}>
          {state.kind === "working" ? "암호화하는 중…" : "암호화 백업 내려받기"}
        </button>
      </div>
      {state.kind === "done" && (
        <p role="status">
          거래 {state.count.toLocaleString("ko-KR")}건을 암호화해 {state.name}로 내려받았습니다. 안전한 곳에 보관하세요.
        </p>
      )}
      {state.kind === "error" && (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}

type RestoreState =
  | { kind: "idle" }
  | { kind: "working"; label: string }
  | { kind: "preview"; fileName: string; plan: RestorePlan; exportedAt: string; commitError?: string }
  | { kind: "committing"; fileName: string; plan: RestorePlan; exportedAt: string }
  | { kind: "done"; result: RestoreResult }
  | { kind: "error"; message: string };

/** 백업 복원(미리보기 후 승인). */
function RestoreForm({ onRestored }: { onRestored: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [state, setState] = useState<RestoreState>({ kind: "idle" });
  const [inputKey, setInputKey] = useState(0);

  const reset = () => {
    setFile(null);
    setPassphrase("");
    setState({ kind: "idle" });
    setInputKey((n) => n + 1);
  };

  const preview = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || !passphrase) return;
    try {
      setState({ kind: "working", label: "복호화하는 중…" });
      const payload = await decryptBackup(file, passphrase);
      setPassphrase("");
      setState({ kind: "working", label: "백업 내용을 검증하는 중…" });
      const valid = await verifyBackupFingerprints(payload.transactions);
      setState({ kind: "working", label: "저장된 거래와 비교하는 중…" });
      const fingerprints = [...new Set(payload.transactions.filter((_, i) => valid[i]).map((t) => t.fingerprint))];
      const [existing, types, payments, rules] = await Promise.all([
        checkAllFingerprints(fingerprints),
        api.typeMappings(),
        api.paymentMappings(),
        api.rules(),
      ]);
      const plan = planRestore(
        payload,
        valid,
        existing,
        new Set(types.filter((t) => t.flow).map((t) => t.source_type)),
        new Set(payments.filter((p) => p.card_kind).map((p) => p.source_label)),
        new Set(rules.map((r) => r.name)),
      );
      setState({ kind: "preview", fileName: file.name, plan, exportedAt: payload.exported_at });
    } catch (error) {
      setPassphrase("");
      setState({ kind: "error", message: errorText(error, "백업을 읽지 못했습니다.") });
    }
  };

  const approve = async () => {
    if (state.kind !== "preview") return;
    const { fileName, plan, exportedAt } = state;
    setState({ kind: "committing", fileName, plan, exportedAt });
    try {
      const result = await api.restoreBackup(`백업 복원: ${fileName}`.slice(0, 255), plan.rows, plan.typeMappings, plan.paymentMappings, plan.rules);
      onRestored();
      setState({ kind: "done", result });
    } catch (error) {
      setState({ kind: "preview", fileName, plan, exportedAt, commitError: errorText(error, "복원하지 못했습니다.") });
    }
  };

  const showForm = state.kind === "idle" || state.kind === "error" || state.kind === "working";
  return (
    <div className="backup-form" aria-labelledby="restore-title" role="group">
      <h3 id="restore-title">백업에서 복원(병합)</h3>
      <p className="muted">백업에만 있는 거래를 추가합니다. 이미 있는 거래와 설정은 바꾸거나 지우지 않습니다.</p>
      {showForm && (
        <form onSubmit={preview} className="backup-form__fields">
          <label className="field">
            <span>백업 파일</span>
            <input key={inputKey} type="file" accept=".json,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={state.kind === "working"} />
          </label>
          <label className="field">
            <span>백업 암호</span>
            <input type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} disabled={state.kind === "working"} />
          </label>
          <div className="actions">
            <button type="submit" className="btn" disabled={!file || !passphrase || state.kind === "working"}>
              복호화하고 미리보기
            </button>
          </div>
          {state.kind === "working" && (
            <div className="status status--loading" role="status">
              <span className="spinner" aria-hidden="true" />
              {state.label}
            </div>
          )}
          {state.kind === "error" && (
            <p className="field-error" role="alert">
              {state.message} 현재 데이터는 변경되지 않았습니다.
            </p>
          )}
        </form>
      )}

      {(state.kind === "preview" || state.kind === "committing") && (
        <div className="restore-preview">
          <p>
            <b>{state.fileName}</b>
            {state.exportedAt && <span className="muted"> · 백업 시각 {new Date(state.exportedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</span>}
          </p>
          <dl className="counts">
            <div className="count"><dt>백업 거래</dt><dd>{state.plan.total.toLocaleString("ko-KR")}</dd></div>
            <div className="count count--new"><dt>추가될 거래</dt><dd>{state.plan.rows.length.toLocaleString("ko-KR")}</dd></div>
            <div className="count"><dt>이미 있음(건너뜀)</dt><dd>{state.plan.existing.toLocaleString("ko-KR")}</dd></div>
            <div className="count"><dt>백업 내 중복</dt><dd>{state.plan.duplicateInBackup.toLocaleString("ko-KR")}</dd></div>
            <div className={state.plan.damaged ? "count count--error" : "count"}><dt>손상(복원 안 함)</dt><dd>{state.plan.damaged.toLocaleString("ko-KR")}</dd></div>
            <div className="count"><dt>추가될 설정</dt><dd>{(state.plan.typeMappings.length + state.plan.paymentMappings.length + state.plan.rules.length).toLocaleString("ko-KR")}</dd></div>
          </dl>
          {state.plan.typeMappings.length > 0 && (
            <p className="muted">타입 매핑 {state.plan.typeMappings.length}개를 추가하면 해당 타입의 자동 분류 거래가 다시 계산될 수 있습니다.</p>
          )}
          {state.kind === "preview" && state.commitError && (
            <p className="field-error" role="alert">
              복원하지 못했습니다: {state.commitError} 아무것도 반영되지 않았습니다.
            </p>
          )}
          <div className="actions">
            <button type="button" className="btn" onClick={reset} disabled={state.kind === "committing"}>
              취소
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={approve}
              disabled={state.kind === "committing" || (state.plan.rows.length === 0 && state.plan.typeMappings.length + state.plan.paymentMappings.length + state.plan.rules.length === 0)}
            >
              {state.kind === "committing"
                ? "복원하는 중…"
                : state.plan.rows.length === 0 && state.plan.typeMappings.length + state.plan.paymentMappings.length + state.plan.rules.length === 0
                  ? "복원할 새 항목 없음"
                  : `신규 ${state.plan.rows.length.toLocaleString("ko-KR")}건 복원 승인`}
            </button>
          </div>
        </div>
      )}

      {state.kind === "done" && (
        <div role="status" className="restore-preview">
          <p>
            거래 <b>{state.result.inserted.toLocaleString("ko-KR")}건</b>을 복원했습니다.
            {state.result.duplicate > 0 && ` 저장 중 이미 있던 ${state.result.duplicate}건은 건너뛰었습니다.`}
            {state.result.type_mappings_added + state.result.payment_mappings_added + state.result.rules_added > 0 &&
              ` 설정 ${state.result.type_mappings_added + state.result.payment_mappings_added + state.result.rules_added}개를 추가했습니다.`}
          </p>
          <div className="actions">
            <button type="button" className="btn" onClick={reset}>
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
