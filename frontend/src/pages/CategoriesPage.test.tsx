import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { callsTo, mockFetch, renderWithApp } from "../test/helpers";
import { CategoriesPage, groupByMajor } from "./CategoriesPage";

const rows = [
  { currency: "KRW", major_category: "식비", minor_category: "점심", total: "12000.1000", count: 2 },
  { currency: "KRW", major_category: "식비", minor_category: null, total: "0.2000", count: 1 },
  { currency: "KRW", major_category: "보험", minor_category: "실손", total: "50000.0000", count: 1 },
  { currency: "KRW", major_category: null, minor_category: null, total: "100.0000", count: 1 },
];

afterEach(() => vi.unstubAllGlobals());

describe("CategoriesPage", () => {
  it("groups original labels by major category without renaming", () => {
    const groups = groupByMajor(rows);
    expect(groups.map((g) => [g.major, g.total, g.count])).toEqual([
      ["보험", "50000.0000", 1], ["식비", "12000.3000", 3], [null, "100.0000", 1],
    ]);
  });

  it("switches flow and opens matching transactions", async () => {
    const fetch = mockFetch({ "GET /api/reports/categories": () => rows });
    const { context } = renderWithApp(<CategoriesPage />);
    expect(await screen.findByText("₩12,000.3")).toBeInTheDocument();
    expect(screen.getByText("(대분류 없음)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "수익" }));
    expect((await screen.findAllByText("₩50,000")).length).toBeGreaterThan(0);
    expect(callsTo(fetch, "GET", "/api/reports/categories").map((c) => c.url.searchParams.get("flow"))).toEqual(["expense", "income"]);
    fireEvent.click(screen.getByRole("button", { name: "보험 거래 보기" }));
    expect(context.navigate).toHaveBeenCalledWith("transactions", { flow: "income", major_category: "보험" });
  });
});
