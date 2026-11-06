import { describe, expect, it } from 'vitest';
import { applyOverrides, countReview, planCommit, reclassify } from './plan';
import type { FingerprintedRow } from './preview';

const base: FingerprintedRow = {
  sourceRow: 2, date: '2026-11-06', time: '', sourceType: '지출', majorCategory: '식비', minorCategory: '', description: '합성',
  amount: '-1000', currency: 'KRW', paymentMethod: '합성카드', memo: '', flow: 'expense', validationCodes: [], fingerprint: 'a',
};
const rows: FingerprintedRow[] = [
  base,
  { ...base, sourceRow: 3, fingerprint: 'old' },
  { ...base, sourceRow: 4 },
  { ...base, sourceRow: 5, fingerprint: 'r', amount: '500', flow: 'needs_review', validationCodes: ['sign_mismatch'] },
  { ...base, sourceRow: 6, fingerprint: '', date: '', validationCodes: ['invalid_date'] },
  { ...base, sourceRow: 7, fingerprint: 'u', sourceType: '모름', flow: 'needs_review', validationCodes: ['unknown_type'] },
];

describe('import plan', () => {
  it('counts every status and plans only new and review rows', () => {
    const review = applyOverrides(rows, new Set(['old']), new Map());
    expect(countReview(review)).toMatchObject({ total: 6, new: 1, duplicate_existing: 1, duplicate_in_file: 1, needs_review: 2, error: 1, toSave: 3 });
    const plan = planCommit(review);
    expect(plan.rows.map((r) => r.fingerprint)).toEqual(['a', 'r', 'u']);
    expect(plan.summary).toEqual({ in_file_duplicate: 1, review: 2, error: 1 });
    expect(plan.rows[0]).toMatchObject({ time: null, minor_category: null, memo: null, major_category: '식비' });
  });

  it('applies user overrides only to importable rows', () => {
    const overrides = new Map([[5, 'refund' as const], [3, 'income' as const], [6, 'expense' as const]]);
    const review = applyOverrides(rows, new Set(['old']), overrides);
    expect(review.find((r) => r.sourceRow === 5)).toMatchObject({ status: 'new', chosenFlow: 'refund', overridden: true });
    expect(review.find((r) => r.sourceRow === 3)).toMatchObject({ status: 'duplicate_existing', overridden: false });
    expect(review.find((r) => r.sourceRow === 6)).toMatchObject({ status: 'error', overridden: false });
    expect(planCommit(review).summary.review).toBe(1);
  });

  it('reclassifies flows after a type mapping without touching other codes', () => {
    const next = reclassify(rows, { 모름: 'income' });
    expect(next.find((r) => r.sourceRow === 7)).toMatchObject({ flow: 'needs_review', validationCodes: ['sign_mismatch'] });
    expect(reclassify(rows, { 모름: 'expense' }).find((r) => r.sourceRow === 7)).toMatchObject({ flow: 'expense', validationCodes: [] });
    expect(next.find((r) => r.sourceRow === 6)?.validationCodes).toEqual(['invalid_date']);
  });
});
