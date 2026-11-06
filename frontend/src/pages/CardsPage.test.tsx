import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { callsTo, mockFetch, renderWithApp } from "../test/helpers";
import { CardsPage } from "./CardsPage";

const cards = {
  start: "2026-11-01", end: "2026-11-07",
  methods: [
    { payment_method: "합성신용", currency: "KRW", card_kind: "credit", purchase: "12000.0000", refund: "2000.0000", net: "10000.0000", count: 3 },
    { payment_method: "합성미지정", currency: "KRW", card_kind: null, purchase: "8000.0000", refund: "0.0000", net: "8000.0000", count: 1 },
  ],
  by_kind: [
    { currency: "KRW", card_kind: "credit", purchase: "12000.0000", refund: "2000.0000", net: "10000.0000" },
    { currency: "KRW", card_kind: "unmapped", purchase: "8000.0000", refund: "0.0000", net: "8000.0000" },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("CardsPage", () => {
  it("groups by saved card kind, subtracts refunds and flags unmapped labels", async () => {
    mockFetch({ "GET /api/reports/cards": () => cards });
    renderWithApp(<CardsPage />);
    expect(await screen.findByText(/카드 종류가 지정되지 않은 결제수단/)).toBeInTheDocument();
    expect(screen.getByText("신용카드", { selector: "dt" })).toBeInTheDocument();
    expect(screen.getByText("구매 ₩12,000 − 환불 ₩2,000", { selector: ".metric__note" })).toBeInTheDocument();
    expect(screen.getByLabelText("합성미지정 카드 종류")).toHaveDisplayValue("분류 필요");
  });

  it("saves a user-chosen card kind and refreshes shared data", async () => {
    const fetch = mockFetch({ "GET /api/reports/cards": () => cards, "PUT /api/payment-method-mappings": () => [] });
    const { context } = renderWithApp(<CardsPage />);
    fireEvent.change(await screen.findByLabelText("합성미지정 카드 종류"), { target: { value: "debit" } });
    await waitFor(() => expect(context.notifyDataChanged).toHaveBeenCalled());
    expect(callsTo(fetch, "PUT", "/api/payment-method-mappings")[0].body).toEqual({ source_label: "합성미지정", card_kind: "debit" });
  });
});
