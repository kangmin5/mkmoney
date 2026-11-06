import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import packageJson from "../package.json";
import { jsonResponse, mockFetch } from "./test/helpers";

const emptySummary = {
  start: "2026-11-01", end: "2026-11-07", comparison_mode: "same_range", comparison_start: "2026-10-01",
  comparison_end: "2026-10-07", currencies: [], unresolved_count: 0, transfer_count: 0, card_settlement_count: 0,
};
const dataRoutes = {
  "GET /api/reports/summary": () => emptySummary,
  "GET /api/reports/monthly": () => [],
  "GET /api/reports/categories": () => [],
  "GET /api/imports/recent": () => [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("App auth gate", () => {
  it("shows only the login form when the session is not authenticated", async () => {
    mockFetch({ "GET /api/auth/me": () => ({ authenticated: false }) });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "로그인" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "주요 메뉴" })).not.toBeInTheDocument();
  });

  it("shows the dashboard, all MVP sections and the build version after login", async () => {
    mockFetch({ "GET /api/auth/me": () => ({ authenticated: true }), ...dataRoutes });
    render(<App />);
    expect(await screen.findByRole("heading", { name: /자금 흐름/ })).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "주요 메뉴" });
    for (const label of ["자금 현황", "거래내역", "분류", "카드 사용", "가져오기", "설정"]) {
      expect(navigation).toHaveTextContent(label);
    }
    expect(screen.getByLabelText(`앱 버전 v${packageJson.version}`)).toHaveTextContent(`v${packageJson.version}`);
  });

  it("returns to login when a data request answers 401", async () => {
    mockFetch({
      "GET /api/auth/me": () => ({ authenticated: true }),
      ...dataRoutes,
      "GET /api/reports/summary": () => jsonResponse({ detail: "로그인이 필요합니다." }, 401),
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "로그인" })).toBeInTheDocument();
  });

  it("offers retry when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("서버에 연결할 수 없습니다");
    mockFetch({ "GET /api/auth/me": () => ({ authenticated: false }) });
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "로그인" })).toBeInTheDocument());
  });
});
