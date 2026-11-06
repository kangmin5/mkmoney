/**
 * 로딩·오류·빈 상태 공용 표시. 사용자가 "멈춘 것인지/없는 것인지" 구분할 수 있게 한다.
 */
import type { ReactNode } from "react";

import type { AsyncState } from "../hooks/useAsync";

interface StatusViewProps<T> {
  state: AsyncState<T> & { reload: () => void };
  /** 데이터가 비었는지 판정 */
  isEmpty?: (data: T) => boolean;
  /** 빈 상태 안내 문구 */
  empty?: ReactNode;
  /** 로딩 문구 */
  loadingLabel?: string;
  children: (data: T) => ReactNode;
}

/** 상태에 따라 로딩/오류/빈 안내 또는 내용을 그린다. */
export function StatusView<T>({ state, isEmpty, empty, loadingLabel = "불러오는 중…", children }: StatusViewProps<T>) {
  if (state.status === "loading") {
    return (
      <div className="status status--loading" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        {loadingLabel}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="status status--error" role="alert">
        <span>{state.error}</span>
        <button type="button" className="btn" onClick={state.reload}>
          다시 시도
        </button>
      </div>
    );
  }
  if (isEmpty?.(state.data)) {
    return <div className="status status--empty">{empty ?? "표시할 데이터가 없습니다."}</div>;
  }
  return <>{children(state.data)}</>;
}
