/**
 * 단일 사용자 로그인. 비밀번호는 전송 후 메모리에서도 지우며 브라우저 저장소에 두지 않는다.
 */
import { type FormEvent, useState } from "react";

import { api } from "../api/client";
import { APP_VERSION } from "../version";

interface LoginPageProps {
  onSuccess: () => void;
}

/** 로그인 화면. 금융 데이터는 표시하지 않는다. */
export function LoginPage({ onSuccess }: LoginPageProps) {
  const [password, setPassword] = useState("");
  const [state, setState] = useState<{ status: "idle" | "submitting" } | { status: "error"; message: string }>({ status: "idle" });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) return;
    setState({ status: "submitting" });
    try {
      await api.login(password);
      setPassword("");
      onSuccess();
    } catch (error) {
      setPassword("");
      setState({ status: "error", message: error instanceof Error ? error.message : "로그인에 실패했습니다." });
    }
  };

  return (
    <main className="login">
      <form className="login__card" onSubmit={submit} aria-labelledby="login-title">
        <p className="brand" aria-hidden="true">
          m<span>:</span>money
        </p>
        <h1 id="login-title">로그인</h1>
        <p className="muted">집 안 서버에 저장된 가계부에 접속합니다.</p>
        <label className="field">
          <span>비밀번호</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
        </label>
        {state.status === "error" && (
          <p className="field-error" role="alert">
            {state.message}
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--block" disabled={state.status === "submitting" || !password}>
          {state.status === "submitting" ? "확인 중…" : "로그인"}
        </button>
        <p className="login__version">{APP_VERSION}</p>
      </form>
    </main>
  );
}
