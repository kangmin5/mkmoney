import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { callsTo, mockFetch } from "../test/helpers";
import { describeRule, parseAmountInput, RulesPanel } from "./RulesPanel";

const saved = { id: "r1", position: 1, name: "합성 급여", enabled: true, description_contains: "합성회사", source_type: null, direction: "in" as const, min_amount: "1000000.0000", max_amount: null, flow: "income" as const, user_category: "급여" };

afterEach(() => vi.unstubAllGlobals());

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("RulesPanel", () => {
  it("parses amounts with commas and summarizes conditions", () => {
    expect(parseAmountInput("1,000,000")).toBe("1000000");
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput("1e6")).toBeUndefined();
    expect(describeRule(saved)).toBe('내용에 "합성회사" 포함 · 들어온 돈 · ₩1,000,000 이상');
  });

  it("adds a rule with validated amounts and refreshes shared data", async () => {
    let list: unknown[] = [];
    const fetch = mockFetch({ "GET /api/rules": () => list, "POST /api/rules": () => (list = [saved]) });
    const onChanged = vi.fn();
    render(<RulesPanel onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "규칙 추가" }));
    fill("규칙 이름", "합성 급여");
    fill("내용에 포함된 글자", "합성회사");
    fill("금액 이상(선택, 원)", "2,000");
    fill("금액 미만(선택, 원)", "1,000");
    expect(screen.getByText("'이상' 금액은 '미만' 금액보다 작아야 합니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "추가" })).toBeDisabled();
    fill("금액 미만(선택, 원)", "");
    fill("내 분류 이름(선택)", "급여");
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(callsTo(fetch, "POST", "/api/rules")[0].body).toEqual({
      name: "합성 급여", enabled: true, description_contains: "합성회사", source_type: null, direction: "in",
      min_amount: "2000", max_amount: null, flow: "income", user_category: "급여",
    });
    expect(await screen.findByText(/1\. 합성 급여/)).toBeInTheDocument();
  });

  it("previews existing-row changes and applies only after approval", async () => {
    const fetch = mockFetch({
      "GET /api/rules": () => [saved],
      "POST /api/rules/apply/preview": () => ({ matched: 3, by_rule: [{ rule_id: "r1", name: "합성 급여", count: 3 }], flow_changes: [{ from_flow: "transfer", to_flow: "income", count: 3 }] }),
      "POST /api/rules/apply": () => ({ updated: 3 }),
    });
    const onChanged = vi.fn();
    render(<RulesPanel onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "적용 미리보기" }));
    expect(await screen.findByText("이체 → 수익")).toBeInTheDocument();
    expect(callsTo(fetch, "POST", "/api/rules/apply")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "3건 적용 승인" }));
    expect(await screen.findByText("3건에 규칙을 적용했습니다.")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });
});
