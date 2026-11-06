import { describe, expect, it } from 'vitest';
import { buildPreview, countByStatus } from './preview';

const row = { date: '2026-11-06', time: '', sourceType: '지출', amount: '-1', currency: 'KRW', paymentMethod: '현금', description: '샘플', majorCategory: '', minorCategory: '', memo: '', flow: 'expense' as const, validationCodes: [] as string[], sourceRow: 2, fingerprint: 'abc' };

describe('buildPreview', () => {
  it('distinguishes existing and workbook-local duplicates from review rows', () => {
    const review = { ...row, sourceRow: 5, fingerprint: 'rev', flow: 'needs_review' as const, validationCodes: ['unknown_type'] };
    const result = buildPreview([row, { ...row, sourceRow: 3 }, { ...row, fingerprint: 'old', sourceRow: 4 }, review], new Set(['old']));
    expect(result).toEqual([
      { ...row, status: 'new' }, { ...row, sourceRow: 3, status: 'duplicate_in_file' },
      { ...row, fingerprint: 'old', sourceRow: 4, status: 'duplicate_existing' }, { ...review, status: 'needs_review' },
    ]);
    expect(countByStatus(result)).toEqual({ new: 1, duplicate_in_file: 1, duplicate_existing: 1, needs_review: 1, error: 0 });
  });

  it('marks rows with blocking validation codes as errors and never as new', () => {
    const bad = { ...row, fingerprint: '', amount: '', validationCodes: ['invalid_amount'] };
    expect(buildPreview([bad], new Set())[0].status).toBe('error');
  });

  it('dedupes repeated review rows within the file', () => {
    const review = { ...row, flow: 'needs_review' as const, validationCodes: ['sign_mismatch'] };
    expect(buildPreview([review, { ...review, sourceRow: 3 }], new Set()).map((r) => r.status)).toEqual(['needs_review', 'duplicate_in_file']);
  });
});
