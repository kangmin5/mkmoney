import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "./App";

describe("App navigation shell", () => {
  it("shows the dashboard heading and all MVP sections", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "이번 달 자금 흐름" })).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "주요 메뉴" });
    for (const label of ["자금 현황", "거래내역", "분류", "카드 사용", "가져오기", "설정"]) {
      expect(navigation).toHaveTextContent(label);
    }
  });
});

describe("App version", () => {
  it("shows the build version from package.json", async () => {
    const { version } = (await import("../package.json")).default;
    render(<App />);
    expect(screen.getByLabelText(`앱 버전 v${version}`)).toHaveTextContent(`v${version}`);
  });
});
