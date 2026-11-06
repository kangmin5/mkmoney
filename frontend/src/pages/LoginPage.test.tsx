import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { callsTo, jsonResponse, mockFetch } from "../test/helpers";
import { LoginPage } from "./LoginPage";

afterEach(() => vi.unstubAllGlobals());

describe("LoginPage", () => {
  it("posts the password once and never stores it in browser storage", async () => {
    const fetch = mockFetch({ "POST /api/auth/login": () => ({ authenticated: true }) });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const onSuccess = vi.fn();
    render(<LoginPage onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "synthetic-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(callsTo(fetch, "POST", "/api/auth/login")).toEqual([expect.objectContaining({ body: { password: "synthetic-pass" } })]);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("shows the server message and clears the field on failure", async () => {
    mockFetch({ "POST /api/auth/login": () => jsonResponse({ detail: "비밀번호가 올바르지 않습니다." }, 401) });
    render(<LoginPage onSuccess={vi.fn()} />);
    const input = screen.getByLabelText("비밀번호");
    fireEvent.change(input, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("비밀번호가 올바르지 않습니다.");
    expect(input).toHaveValue("");
  });
});
