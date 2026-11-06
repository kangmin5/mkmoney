import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { callsTo, mockFetch, renderWithApp } from "../test/helpers";
import { SettingsPage } from "./SettingsPage";

afterEach(() => vi.unstubAllGlobals());

const routes = {
  "GET /api/type-mappings": () => [
    { source_type: "지출", flow: null, default_flow: "expense", transaction_count: 10 },
    { source_type: "합성타입", flow: null, default_flow: null, transaction_count: 2 },
  ],
  "GET /api/payment-method-mappings": () => [
    { source_label: "합성카드", card_kind: "credit", transaction_count: 5 },
    { source_label: "합성페이", card_kind: null, transaction_count: 1 },
  ],
  "PUT /api/type-mappings": () => [],
  "PUT /api/payment-method-mappings": () => [],
};

describe("SettingsPage", () => {
  it("shows effective type flows and flags unmapped labels without guessing", async () => {
    mockFetch(routes);
    renderWithApp(<SettingsPage />);
    expect(await screen.findByLabelText("지출 집계 방향")).toHaveDisplayValue("지출");
    expect(screen.getByLabelText("합성타입 집계 방향")).toHaveDisplayValue("미분류(선택 필요)");
    expect(await screen.findByLabelText("합성페이 카드 종류")).toHaveDisplayValue("분류 필요");
    expect(screen.getByText(/집 안 서버의 PostgreSQL/)).toBeInTheDocument();
  });

  it("persists type and payment mappings and refreshes shared data", async () => {
    const fetch = mockFetch(routes);
    const { context } = renderWithApp(<SettingsPage />);
    fireEvent.change(await screen.findByLabelText("합성타입 집계 방향"), { target: { value: "refund" } });
    fireEvent.change(await screen.findByLabelText("합성페이 카드 종류"), { target: { value: "other" } });
    await waitFor(() => expect(context.notifyDataChanged).toHaveBeenCalledTimes(2));
    expect(callsTo(fetch, "PUT", "/api/type-mappings")[0].body).toEqual({ source_type: "합성타입", flow: "refund" });
    expect(callsTo(fetch, "PUT", "/api/payment-method-mappings")[0].body).toEqual({ source_label: "합성페이", card_kind: "other" });
  });
});
