import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { callsTo, mockFetch, renderWithApp } from "../test/helpers";
import { CategoriesPage, groupByMajor } from "./CategoriesPage";

const row = (major: string | null, minor: string | null, total: string, count: number, user: string | null = null) => ({
  currency: "KRW", category: user ?? major, user_category: user, major_category: major, minor_category: minor, total, count,
});
const rows = [
  row("식비", "점심", "12000.1000", 2),
  row("식비", null, "0.2000", 1),
  row("보험", "실손", "50000.0000", 1),
  row(null, null, "100.0000", 1),
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
    expect(screen.getByText("(분류 없음)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "수익" }));
    expect((await screen.findAllByText("₩50,000")).length).toBeGreaterThan(0);
    expect(callsTo(fetch, "GET", "/api/reports/categories").map((c) => c.url.searchParams.get("flow"))).toEqual(["expense", "income"]);
    fireEvent.click(screen.getByRole("button", { name: "보험 거래 보기" }));
    expect(context.navigate).toHaveBeenCalledWith("transactions", { flow: "income", category: "보험" });
  });
});

describe("user categories", () => {
  it("groups by the user category and shows the original labels", async () => {
    const data = [
      row("내계좌이체", null, "3000000.0000", 1, "급여"),
      row("기타수입", null, "2000000.0000", 1, "급여"),
      row("금융수입", "이자", "1000.0000", 1),
    ];
    expect(groupByMajor(data).map((g) => [g.major, g.isUserCategory, g.total])).toEqual([
      ["급여", true, "5000000.0000"], ["금융수입", false, "1000.0000"],
    ]);
    mockFetch({ "GET /api/reports/categories": () => data });
    renderWithApp(<CategoriesPage />);
    expect(await screen.findByText("원본: 내계좌이체")).toBeInTheDocument();
    expect(screen.getByText("원본: 기타수입")).toBeInTheDocument();
    expect(screen.getByText("내 분류")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "경비 정산" })).toBeInTheDocument();
  });
});

describe("same-named categories", () => {
  it("merges a user category with an original category of the same name", () => {
    const merged = groupByMajor([row("내계좌이체", null, "3500000.0000", 1, "급여"), row("급여", null, "3200000.0000", 1)]);
    expect(merged.map((g) => [g.major, g.isUserCategory, g.total, g.count])).toEqual([["급여", true, "6700000.0000", 2]]);
  });
});
