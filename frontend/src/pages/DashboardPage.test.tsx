import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { callsTo, jsonResponse, mockFetch, renderWithApp } from "../test/helpers";
import { DashboardPage, periodTitle } from "./DashboardPage";

const totals = (income: string, gross: string, refund: string, net: string, cash: string) => ({
  income, gross_expense: gross, refund, net_expense: net, net_cashflow: cash,
});
const summary = {
  start: "2026-11-01", end: "2026-11-07", comparison_mode: "same_range",
  comparison_start: "2026-10-01", comparison_end: "2026-10-07",
  currencies: [
    { currency: "KRW", current: totals("3500000.0000", "20000.0000", "2000.0000", "18000.0000", "3482000.0000"),
      previous: totals("3000000.0000", "40000.0000", "0.0000", "40000.0000", "2960000.0000"),
      delta: totals("500000.0000", "-20000.0000", "2000.0000", "-22000.0000", "522000.0000") },
    { currency: "USD", current: totals("0", "10.5000", "0", "10.5000", "-10.5000"),
      previous: totals("0", "0", "0", "0", "0"), delta: totals("0", "10.5", "0", "10.5", "-10.5") },
  ],
  unresolved_count: 2, transfer_count: 3, card_settlement_count: 1,
};
const routes = {
  "GET /api/reports/summary": () => summary,
  "GET /api/reports/monthly": () => [
    { month: "2026-10", currency: "KRW", income: "3000000", net_expense: "40000" },
    { month: "2026-11", currency: "KRW", income: "3500000", net_expense: "18000" },
  ],
  "GET /api/reports/categories": () => [
    { currency: "KRW", major_category: "식비", minor_category: "점심", total: "12000.0000", count: 1 },
    { currency: "KRW", major_category: "식비", minor_category: "저녁", total: "8000.0000", count: 1 },
  ],
  "GET /api/imports/recent": () => [
    { id: "b1", file_name: "expense-2026-11-06.xlsx", imported_at: "2026-11-06T10:00:00Z", inserted_count: 12,
      duplicate_count: 30, in_file_duplicate_count: 4, review_count: 1, error_count: 0 },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("DashboardPage", () => {
  it("shows per-currency KPIs with refunds, comparison basis and exclusions", async () => {
    const fetch = mockFetch(routes);
    renderWithApp(<DashboardPage />);
    expect(await screen.findByText("₩3,500,000")).toBeInTheDocument();
    expect(screen.getByText("₩18,000")).toBeInTheDocument();
    expect(screen.getByText(/총지출 ₩20,000 − 환불 ₩2,000/)).toBeInTheDocument();
    expect(screen.getByText("₩3,482,000")).toBeInTheDocument();
    expect(screen.getByText("$10.50")).toBeInTheDocument();
    expect(screen.getAllByText(/전월 같은 기간보다 16.7% ↑/).length).toBeGreaterThan(0);
    expect(screen.getByText(/비교: 전월 같은 기간 \(2026.10.01 – 10.07\)/)).toHaveTextContent("이체 3건, 카드대금 정산 1건");
    expect(callsTo(fetch, "GET", "/api/reports/summary")[0].url.search).toBe("?start=2026-11-01&end=2026-11-07&comparison=same_range");
    // 분류는 대분류로 묶어 정확히 합산
    expect(await screen.findByText("₩20,000")).toBeInTheDocument();
    expect(screen.getByText("신규 12건")).toBeInTheDocument();
    expect(screen.getByText("중복 제외 34건")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /11월 수익 ₩3,500,000, 지출 ₩18,000/ })).toBeInTheDocument();
  });

  it("links unresolved rows to the transaction review filter", async () => {
    mockFetch(routes);
    const { context } = renderWithApp(<DashboardPage />);
    fireEvent.click(await screen.findByRole("button", { name: "분류하기" }));
    expect(context.navigate).toHaveBeenCalledWith("transactions", { flow: "needs_review" });
  });

  it("explains empty periods and recovers from errors", async () => {
    let fail = true;
    mockFetch({
      ...routes,
      "GET /api/reports/summary": () => (fail ? jsonResponse({ detail: "서버 오류" }, 500) : { ...summary, currencies: [], unresolved_count: 0 }),
    });
    renderWithApp(<DashboardPage />);
    expect(await screen.findByText("서버 오류")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getAllByRole("button", { name: "다시 시도" })[0]);
    await waitFor(() => expect(screen.getByText(/이 기간에 반영된 거래가 없습니다/)).toBeInTheDocument());
  });

  it("titles the period by kind", () => {
    expect(periodTitle({ kind: "month", start: "2026-11-01", end: "2026-11-07", comparison: "same_range" }, "2026-11-07")).toBe("이번 달 자금 흐름");
    expect(periodTitle({ kind: "month", start: "2026-10-01", end: "2026-10-31", comparison: "same_range" }, "2026-11-07")).toBe("10월 자금 흐름");
    expect(periodTitle({ kind: "custom", start: "2026-10-01", end: "2026-10-10", comparison: "previous_period" })).toBe("기간 자금 흐름");
  });
});
