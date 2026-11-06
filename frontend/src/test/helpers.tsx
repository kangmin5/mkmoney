/**
 * 테스트 헬퍼: 경로별 fetch 모킹과 AppContext 렌더. 모든 값은 합성 데이터다.
 */
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";

import { AppContext, type AppContextValue } from "../app/AppContext";

type Handler = (url: URL, init: RequestInit | undefined) => unknown;

/** JSON 응답 생성(상태 코드 지정 가능). */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * `METHOD /path` 키로 핸들러를 등록한 fetch 모킹. 핸들러가 Response를 돌려주면 그대로 쓴다.
 * 등록되지 않은 경로는 404.
 */
export function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://app.test");
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) return jsonResponse({ detail: "not found" }, 404);
    const result = await handler(url, init);
    return result instanceof Response ? result : jsonResponse(result);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** 특정 경로로 간 호출들. */
export function callsTo(fn: ReturnType<typeof mockFetch>, method: string, path: string): { url: URL; body: unknown }[] {
  return fn.mock.calls
    .map(([input, init]) => ({ url: new URL(String(input), "https://app.test"), init }))
    .filter(({ url, init }) => url.pathname === path && (init?.method ?? "GET") === method)
    .map(({ url, init }) => ({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined }));
}

/** 기본 컨텍스트(2026년 11월, 전월 같은 기간 비교). */
export function makeContext(overrides: Partial<AppContextValue> = {}): AppContextValue {
  return {
    period: { kind: "month", start: "2026-11-01", end: "2026-11-07", comparison: "same_range" },
    setPeriod: vi.fn(),
    dataVersion: 0,
    notifyDataChanged: vi.fn(),
    navigate: vi.fn(),
    transactionFilters: {},
    setTransactionFilters: vi.fn(),
    ...overrides,
  };
}

/** 컨텍스트 안에서 렌더. */
export function renderWithApp(ui: ReactElement, overrides: Partial<AppContextValue> = {}) {
  const context = makeContext(overrides);
  return { ...render(<AppContext.Provider value={context}>{ui}</AppContext.Provider>), context };
}
