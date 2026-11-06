import { describe, expect, it } from 'vitest';
import type { RuleInput } from '../api/client';
import vectors from './rules.vectors.json';
import { firstMatchingRule, matchRule } from './rules';

const rules: RuleInput[] = vectors.rules.map((r) => ({ ...r, enabled: true, direction: r.direction as RuleInput['direction'], flow: r.flow as RuleInput['flow'] }));

describe('rule matching (shared vectors with backend)', () => {
  for (const c of vectors.cases) {
    it(`${c.description} | ${c.amount} → ${c.expect}`, () => {
      expect(firstMatchingRule(rules, { description: c.description, sourceType: c.source_type, amount: c.amount })?.name ?? null).toBe(c.expect);
    });
  }

  it('skips disabled rules and keeps order', () => {
    const disabled = rules.map((r, i) => (i === 0 ? { ...r, enabled: false } : r));
    expect(firstMatchingRule(disabled, { description: '(주)코어스톤', sourceType: '이체', amount: '3000000' })).toBeNull();
    expect(matchRule({ ...rules[0], min_amount: null }, { description: 'x 코어스톤', sourceType: '수입', amount: '1' })).toBe(true);
  });
});
