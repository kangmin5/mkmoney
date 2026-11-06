import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFingerprint } from "../import/fingerprint";
import { encryptBackup, readText, type BackupPayload } from "../storage/backup";
import { callsTo, mockFetch } from "../test/helpers";
import { BackupPanel } from "./BackupPanel";

const PASS = "synthetic-passphrase-1";

async function syntheticPayload(): Promise<BackupPayload> {
  const make = async (description: string) => {
    const row = { date: "2026-11-06", time: null, source_type: "지출", flow: "expense" as const, major_category: null, minor_category: null,
      description, amount: "-1000.0000", currency: "KRW", payment_method: "합성카드", memo: null, fingerprint: "" };
    row.fingerprint = await createFingerprint({ date: row.date, time: "", sourceType: row.source_type, amount: row.amount, currency: row.currency, paymentMethod: row.payment_method, description });
    return row;
  };
  return {
    format: "mkmoney-backup", version: 1, exported_at: "2026-11-07T00:00:00Z", app_version: "0.1.3",
    transactions: [await make("합성 기존"), await make("합성 신규")],
    type_mappings: [{ source_type: "합성타입", flow: "refund" }],
    payment_mappings: [{ source_label: "합성카드", card_kind: "credit" }],
  };
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:synthetic");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe("BackupPanel", { timeout: 30_000 }, () => {
  it("exports an encrypted file and clears the passphrase fields", async () => {
    const payload = await syntheticPayload();
    const fetch = mockFetch({ "GET /api/backup/export": () => payload });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<BackupPanel onRestored={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/백업 암호\(/), { target: { value: PASS } });
    fireEvent.change(screen.getByLabelText("암호 확인"), { target: { value: PASS } });
    fireEvent.click(screen.getByRole("button", { name: "암호화 백업 내려받기" }));
    expect(await screen.findByText(/거래 2건을 암호화해 mkmoney-backup-/)).toBeInTheDocument();
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(await readText(blob)).not.toContain("합성");
    expect(click).toHaveBeenCalled();
    expect(screen.getByLabelText(/백업 암호\(/)).toHaveValue("");
    expect(callsTo(fetch, "GET", "/api/backup/export")).toHaveLength(1);
    click.mockRestore();
  });

  it("previews a merge, then sends only new rows and absent mappings after approval", async () => {
    const payload = await syntheticPayload();
    const file = new File([await readText(await encryptBackup(payload, PASS))], "mkmoney-backup-2026-11-07.json");
    const onRestored = vi.fn();
    const fetch = mockFetch({
      "POST /api/imports/check": () => ({ existing: [payload.transactions[0].fingerprint] }),
      "GET /api/type-mappings": () => [{ source_type: "합성타입", flow: null, default_flow: null, transaction_count: 0 }],
      "GET /api/payment-method-mappings": () => [{ source_label: "합성카드", card_kind: "debit", transaction_count: 1 }],
      "POST /api/backup/restore": () => ({ batch_id: "b", inserted: 1, duplicate: 0, type_mappings_added: 1, payment_mappings_added: 0 }),
    });
    render(<BackupPanel onRestored={onRestored} />);
    fireEvent.change(screen.getByLabelText("백업 파일"), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("백업 암호"), { target: { value: PASS } });
    fireEvent.click(screen.getByRole("button", { name: "복호화하고 미리보기" }));
    const approve = await screen.findByRole("button", { name: "신규 1건 복원 승인" });
    expect(callsTo(fetch, "POST", "/api/backup/restore")).toHaveLength(0);
    fireEvent.click(approve);
    expect(await screen.findByText(/을 복원했습니다/)).toBeInTheDocument();
    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    const body = callsTo(fetch, "POST", "/api/backup/restore")[0].body as { rows: { description: string }[]; type_mappings: unknown[]; payment_mappings: unknown[]; file_name: string };
    expect(body.rows.map((r) => r.description)).toEqual(["합성 신규"]);
    expect(body.type_mappings).toEqual([{ source_type: "합성타입", flow: "refund" }]);
    expect(body.payment_mappings).toEqual([]);
    expect(body.file_name).toBe("백업 복원: mkmoney-backup-2026-11-07.json");
  });

  it("reports a wrong passphrase without contacting the restore API", async () => {
    const file = new File([await readText(await encryptBackup(await syntheticPayload(), PASS))], "b.json");
    const fetch = mockFetch({});
    render(<BackupPanel onRestored={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("백업 파일"), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("백업 암호"), { target: { value: "wrong-passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "복호화하고 미리보기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("암호가 틀렸거나 파일이 손상·변조되었습니다. 현재 데이터는 변경되지 않았습니다.");
    expect(fetch).not.toHaveBeenCalled();
  });
});
