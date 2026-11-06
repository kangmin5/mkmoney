/**
 * 비동기 데이터 로딩 상태(로딩·오류·성공)를 관리한다. 의존값이 바뀌면 이전 요청을 취소한다.
 */
import { useCallback, useEffect, useState } from "react";

/** 로딩 상태. */
export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "success"; data: T };

/**
 * @param load AbortSignal을 받는 로더
 * @param deps 다시 불러올 기준 값
 * @returns 상태와 수동 재시도 함수
 */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: "success", data });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", error: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다." });
      },
    );
    return () => controller.abort();
    // load는 매 렌더 새로 만들어지므로 deps로만 재실행을 제어한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  return { ...state, reload };
}
