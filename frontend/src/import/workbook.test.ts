import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import { parseWorkbook } from './workbook';

const headers = ['날짜', '시간', '타입', '대분류', '소분류', '내용', '금액', '화폐', '결제수단', '메모'];
function fileWith(sheets: { name: string; rows: unknown[][] }[]) {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return new File([bytes], 'expense-2026-11-06.xlsx');
}

describe('parseWorkbook', () => {
  it('selects the named ledger sheet, parses dates and skips blank rows without network calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const file = fileWith([
      { name: '뱅샐현황', rows: [['private summary']] },
      { name: '가계부 내역', rows: [headers, [new Date(2026, 10, 6), 0.5, '지출', '식비', '점심', '샘플', -12000, 'KRW', '체크카드', ''], ['', '', '', '', '', '', '', '', '', '']] },
    ]);
    const parsed = await parseWorkbook(file);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ date: '2026-11-06', time: '12:00:00', flow: 'expense', amount: '-12000', currency: 'KRW' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('rejects missing and duplicate required headers with safe errors', async () => {
    await expect(parseWorkbook(fileWith([{ name: '가계부 내역', rows: [['날짜', '금액']] }]))).rejects.toThrow(/필수 열/);
    await expect(parseWorkbook(fileWith([{ name: '가계부 내역', rows: [headers.map((h, i) => i === 1 ? '날짜' : h)] }]))).rejects.toThrow(/중복 열/);
  });

  it('marks unknown transaction types and invalid rows for review', async () => {
    const parsed = await parseWorkbook(fileWith([{ name: '가계부 내역', rows: [headers, ['2026.11.06', '', '알수없음', '', '', '샘플', 'not money', '', '', '']] }]));
    expect(parsed.rows[0].flow).toBe('needs_review');
    expect(parsed.rows[0].validationCodes).toEqual(expect.arrayContaining(['unknown_type', 'invalid_amount', 'invalid_currency']));
  });
});

describe('parseWorkbook edge cases', () => {
  it('finds columns by header name regardless of order and preserves text dates/times', async () => {
    const shuffled = [...headers].reverse();
    const values: Record<string, unknown> = { 날짜: '2028.02.29', 시간: '09:05', 타입: '수입', 대분류: '임대수익', 소분류: '', 내용: '합성 입금', 금액: '1,000', 화폐: 'krw', 결제수단: '합성계좌', 메모: '' };
    const parsed = await parseWorkbook(fileWith([{ name: '가계부 내역', rows: [shuffled, shuffled.map((h) => values[h])] }]));
    expect(parsed.rows[0]).toMatchObject({ date: '2028-02-29', time: '09:05:00', amount: '1000', currency: 'KRW', flow: 'income', majorCategory: '임대수익', sourceRow: 2 });
  });

  it('rejects impossible dates and leaves sign mismatches for review instead of guessing refunds', async () => {
    const parsed = await parseWorkbook(fileWith([{ name: '가계부 내역', rows: [headers,
      ['2027-02-29', '', '지출', '', '', '샘플', -1, 'KRW', '카드', ''],
      ['2026-11-06', '', '지출', '', '', '샘플', 5000, 'KRW', '카드', ''],
    ] }]));
    expect(parsed.rows[0].validationCodes).toContain('invalid_date');
    expect(parsed.rows[1]).toMatchObject({ flow: 'needs_review', validationCodes: ['sign_mismatch'] });
  });

  it('applies saved type mappings before defaults', async () => {
    const parsed = await parseWorkbook(fileWith([{ name: '가계부 내역', rows: [headers, ['2026-11-06', '', '알수없음', '', '', '샘플', 10, 'KRW', '카드', '']] }]), { 알수없음: 'refund' });
    expect(parsed.rows[0]).toMatchObject({ flow: 'refund', validationCodes: [] });
  });

  it('fails clearly when only a non-ledger sheet exists', async () => {
    await expect(parseWorkbook(fileWith([{ name: '뱅샐현황', rows: [headers] }]))).rejects.toThrow(/가계부 내역/);
  });

  it('rejects unsupported extensions and oversized files before parsing', async () => {
    await expect(parseWorkbook(new File(['a'], 'expense.csv'))).rejects.toThrow(/지원하지 않는 파일/);
    const big = new File(['x'], 'big.xlsx');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await expect(parseWorkbook(big)).rejects.toThrow(/너무 큽니다/);
  });

  it('reports the sheet list without exposing other sheet values', async () => {
    const parsed = await parseWorkbook(fileWith([{ name: '뱅샐현황', rows: [['private']] }, { name: '가계부 내역', rows: [headers] }]));
    expect(parsed.sheetName).toBe('가계부 내역');
    expect(parsed.sheetNames).toEqual(['뱅샐현황', '가계부 내역']);
    expect(JSON.stringify(parsed)).not.toContain('private');
  });
});
