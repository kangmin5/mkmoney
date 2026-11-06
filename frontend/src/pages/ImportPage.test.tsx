import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import * as XLSX from "xlsx";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFingerprint } from "../import/fingerprint";
import { callsTo, jsonResponse, mockFetch, renderWithApp } from "../test/helpers";
import { ImportPage } from "./ImportPage";

const headers = ["날짜", "시간", "타입", "대분류", "소분류", "내용", "금액", "화폐", "결제수단", "메모"];
/** 합성 워크북: 신규 1, 기존 중복 1, 파일 내 중복 1, 부호 불일치 1, 오류 1, 모르는 타입 1. */
function syntheticFile(): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["비공개 요약"]]), "뱅샐현황");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    headers,
    ["2026-11-06", "12:00", "지출", "식비", "점심", "합성 신규 가게", -12000, "KRW", "합성카드", ""],
    ["2026-11-05", "09:00", "지출", "식비", "", "합성 기존 가게", -5000, "KRW", "합성카드", ""],
    ["2026-11-06", "12:00", "지출", "다른분류", "", "합성 신규 가게", -12000, "KRW", "합성카드", "메모"],
    ["2026-11-04", "", "지출", "생활", "", "합성 취소", 3000, "KRW", "합성카드", ""],
    ["2026-02-30", "", "지출", "", "", "합성 오류", -1, "KRW", "합성카드", ""],
    ["2026-11-03", "", "합성타입", "", "", "합성 모름", 700, "KRW", "합성계좌", ""],
  ]), "가계부 내역");
  return new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "expense-2026-11-06.xlsx");
}

async function existingFingerprint(): Promise<string> {
  return createFingerprint({ date: "2026-11-05", time: "09:00:00", sourceType: "지출", amount: "-5000", currency: "KRW", paymentMethod: "합성카드", description: "합성 기존 가게" });
}

async function loadFile(routes: Parameters<typeof mockFetch>[0] = {}) {
  const old = await existingFingerprint();
  const fetch = mockFetch({
    "GET /api/type-mappings": () => [],
    "GET /api/rules": () => [],
    "POST /api/imports/check": () => ({ existing: [old] }),
    "PUT /api/type-mappings": () => [],
    "POST /api/imports": () => jsonResponse({ batch_id: "b1", inserted: 3, duplicate: 0 }, 201),
    ...routes,
  });
  const view = renderWithApp(<ImportPage />);
  fireEvent.change(await screen.findByLabelText("뱅크샐러드 엑셀 파일(.xlsx)"), { target: { files: [syntheticFile()] } });
  await screen.findByRole("heading", { name: "거래 미리보기" });
  return { fetch, ...view };
}

afterEach(() => vi.unstubAllGlobals());

describe("ImportPage", () => {
  it("names the sheet, sends only fingerprints before approval and counts each status", async () => {
    const { fetch } = await loadFile();
    expect(screen.getByText(/가져올 시트:/)).toHaveTextContent("가계부 내역 ✓ · 읽지 않은 시트: 뱅샐현황");
    const checks = callsTo(fetch, "POST", "/api/imports/check");
    expect(checks).toHaveLength(1);
    expect(Object.keys(checks[0].body as object)).toEqual(["fingerprints"]);
    expect((checks[0].body as { fingerprints: string[] }).fingerprints).toHaveLength(4);
    expect(JSON.stringify(checks[0].body)).not.toMatch(/합성|12000|KRW/);
    expect(callsTo(fetch, "POST", "/api/imports")).toHaveLength(0);
    const counts = screen.getByText("전체 행").closest("dl") as HTMLElement;
    const value = (label: string) => within(counts).getByText(label).nextElementSibling?.textContent;
    expect([value("전체 행"), value("신규 추가"), value("검토 필요"), value("기존 중복 제외"), value("파일 내 중복 제외"), value("오류(저장 안 함)")]).toEqual(["6", "1", "2", "1", "1", "1"]);
    expect(screen.getByRole("button", { name: "신규 3건 저장 승인" })).toBeEnabled();
  });

  it("commits only approved new rows with the user's refund choice and never duplicates or errors", async () => {
    const { fetch, context } = await loadFile();
    fireEvent.change(screen.getByLabelText("5행 집계 분류"), { target: { value: "refund" } });
    fireEvent.click(screen.getByRole("button", { name: "신규 3건 저장 승인" }));
    expect(await screen.findByRole("heading", { name: "저장 완료" })).toBeInTheDocument();
    const [commit] = callsTo(fetch, "POST", "/api/imports");
    const body = commit.body as { file_name: string; rows: { description: string; flow: string; time: string | null }[]; summary: object };
    expect(body.file_name).toBe("expense-2026-11-06.xlsx");
    expect(body.rows.map((r) => [r.description, r.flow])).toEqual([["합성 신규 가게", "expense"], ["합성 취소", "refund"], ["합성 모름", "needs_review"]]);
    expect(body.rows[0].time).toBe("12:00:00");
    expect(body.summary).toEqual({ in_file_duplicate: 1, review: 1, error: 1 });
    expect(JSON.stringify(body)).not.toMatch(/합성 기존 가게|합성 오류|다른분류/);
    expect(body.rows.every((r) => (r as { user_category?: unknown }).user_category === null)).toBe(true);
    expect(context.notifyDataChanged).toHaveBeenCalled();
  });

  it("keeps the review and says nothing was saved when the commit fails", async () => {
    await loadFile({ "POST /api/imports": () => jsonResponse({ detail: "서버 오류" }, 500) });
    fireEvent.click(screen.getByRole("button", { name: "신규 3건 저장 승인" }));
    expect(await screen.findByText(/저장하지 못했습니다: 서버 오류 아무 거래도 반영되지 않았습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "저장 완료" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "신규 3건 저장 승인" })).toBeEnabled();
  });

  it("saves a mapping for unknown types and reapplies it to the preview", async () => {
    const { fetch, context } = await loadFile();
    fireEvent.change(screen.getByLabelText("합성타입 집계 방향"), { target: { value: "income" } });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "알 수 없는 타입" })).not.toBeInTheDocument());
    expect(callsTo(fetch, "PUT", "/api/type-mappings")[0].body).toEqual({ source_type: "합성타입", flow: "income" });
    expect(context.notifyDataChanged).toHaveBeenCalled();
    const counts = screen.getByText("전체 행").closest("dl") as HTMLElement;
    expect(within(counts).getByText("신규 추가").nextElementSibling?.textContent).toBe("2");
  });

  it("shows a clear local error for unsupported files without calling the API", async () => {
    const fetch = mockFetch({ "GET /api/type-mappings": () => [], "GET /api/rules": () => [] });
    renderWithApp(<ImportPage />);
    fireEvent.change(await screen.findByLabelText("뱅크샐러드 엑셀 파일(.xlsx)"), { target: { files: [new File(["a,b"], "export.csv")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("지원하지 않는 파일입니다");
    expect(callsTo(fetch, "POST", "/api/imports/check")).toHaveLength(0);
  });
});

describe("ImportPage rules", () => {
  it("suggests flow and user category from saved rules and sends them only after approval", async () => {
    const rule = { id: "r1", position: 1, name: "합성 모름 규칙", enabled: true, description_contains: "모름", source_type: null, direction: "in", min_amount: null, max_amount: null, flow: "income", user_category: "합성분류" };
    const { fetch } = await loadFile({ "GET /api/rules": () => [rule] });
    // 규칙으로 흐름이 정해진 행은 '검토 필요'에서 '저장 예정'(신규)으로 옮겨진다.
    fireEvent.click(screen.getByRole("tab", { name: /저장 예정/ }));
    expect(screen.getByText(/규칙: 합성 모름 규칙 → 합성분류/)).toBeInTheDocument();
    expect(screen.getByText(/분류 규칙으로 1건의 흐름·분류 이름을 제안했습니다/)).toBeInTheDocument();
    expect(callsTo(fetch, "POST", "/api/imports")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /저장 승인/ }));
    await screen.findByRole("heading", { name: "저장 완료" });
    const rows = (callsTo(fetch, "POST", "/api/imports")[0].body as { rows: { description: string; flow: string; user_category: string | null }[] }).rows;
    expect(rows.find((r) => r.description === "합성 모름")).toMatchObject({ flow: "income", user_category: "합성분류" });
  });
});
