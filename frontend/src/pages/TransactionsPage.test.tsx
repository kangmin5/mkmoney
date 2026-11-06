import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { callsTo, mockFetch, renderWithApp } from "../test/helpers";
import { TransactionsPage } from "./TransactionsPage";

const tx = (id: string, extra: Record<string, unknown> = {}) => ({
  id, date: "2026-11-06", time: "12:30:00", source_type: "지출", flow: "expense", flow_source: "auto",
  major_category: "식비", minor_category: "점심", description: `합성 거래 ${id}`, amount: "-12000.0000",
  currency: "KRW", payment_method: "합성카드", memo: null, user_category: null, ...extra,
});

afterEach(() => vi.unstubAllGlobals());

describe("TransactionsPage", () => {
  it("requests a filtered page and paginates with offsets", async () => {
    const fetch = mockFetch({ "GET /api/transactions": (url) => ({ items: [tx(`t${url.searchParams.get("offset")}`)], total: 120, limit: 50, offset: Number(url.searchParams.get("offset")) }) });
    renderWithApp(<TransactionsPage />, { transactionFilters: { flow: "needs_review", major_category: "식비" } });
    expect(await screen.findByText("합성 거래 t0")).toBeInTheDocument();
    expect(screen.getByText("−₩12,000")).toBeInTheDocument();
    expect(screen.getByText(/총 120건/)).toBeInTheDocument();
    const first = callsTo(fetch, "GET", "/api/transactions")[0].url.searchParams;
    expect(Object.fromEntries(first)).toEqual({ flow: "needs_review", major_category: "식비", start: "2026-11-01", end: "2026-11-07", limit: "50", offset: "0" });
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expect(await screen.findByText("합성 거래 t50")).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("lets the user classify a row and notifies other views", async () => {
    const fetch = mockFetch({
      "GET /api/transactions": () => ({ items: [tx("r1", { flow: "needs_review", amount: "5000.0000" })], total: 1, limit: 50, offset: 0 }),
      "PATCH /api/transactions/r1/flow": () => tx("r1", { flow: "refund", flow_source: "manual" }),
    });
    const { context } = renderWithApp(<TransactionsPage />);
    const select = await screen.findByLabelText("집계 분류");
    expect(select).toHaveDisplayValue("자동: 미분류");
    fireEvent.change(select, { target: { value: "refund" } });
    await waitFor(() => expect(context.notifyDataChanged).toHaveBeenCalled());
    expect(callsTo(fetch, "PATCH", "/api/transactions/r1/flow")[0].body).toEqual({ flow: "refund" });
  });

  it("shows an empty message instead of a blank list", async () => {
    mockFetch({ "GET /api/transactions": () => ({ items: [], total: 0, limit: 50, offset: 0 }) });
    renderWithApp(<TransactionsPage />);
    expect(await screen.findByText("조건에 맞는 거래가 없습니다.")).toBeInTheDocument();
  });
});

describe("TransactionsPage user category", () => {
  it("shows the user category badge and saves a new name without forcing a manual flow", async () => {
    const fetch = mockFetch({
      "GET /api/transactions": () => ({ items: [tx("u1", { user_category: null, flow: "transfer", flow_source: "auto" })], total: 1, limit: 50, offset: 0 }),
      "PATCH /api/transactions/u1/flow": () => tx("u1", { user_category: "급여" }),
    });
    const { context } = renderWithApp(<TransactionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "내 분류 이름 지정" }));
    fireEvent.change(screen.getByLabelText("내 분류 이름"), { target: { value: " 급여 " } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(context.notifyDataChanged).toHaveBeenCalled());
    expect(callsTo(fetch, "PATCH", "/api/transactions/u1/flow")[0].body).toEqual({ flow: null, user_category: "급여" });
  });
});
