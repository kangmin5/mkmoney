import { describe, expect, it } from 'vitest';
import { canonicalAmount, createFingerprint, fingerprintPayload, normalizeText } from './fingerprint';

const row = { date: '2026-11-06', time: '12:00:00', sourceType: ' 지출 ', amount: '12000.00', currency: 'krw', paymentMethod: ' 카드 ', description: ' 점심 ', majorCategory: '식비', minorCategory: '', memo: '', flow: 'expense' as const, validationCodes: [], sourceRow: 2 };

describe('createFingerprint', () => {
  it('normalizes only the specified duplicate identity fields', async () => {
    const first = await createFingerprint(row);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(await createFingerprint({ ...row, majorCategory: '다른 분류', memo: '다른 메모' })).toBe(first);
    expect(await createFingerprint({ ...row, amount: '12001' })).not.toBe(first);
    expect(await createFingerprint({ ...row, time: '' })).not.toBe(first);
  });

  it('matches the backend shared test vector byte for byte', async () => {
    // backend/tests/test_fingerprint.py 와 같은 벡터. 바꾸면 양쪽을 함께 바꾼다.
    const vector = { date: '2026-01-31', time: '', sourceType: '지출', amount: '-1500.50', currency: 'KRW', paymentMethod: '합성카드', description: '테스트 "따옴표" \\ 가게' };
    expect(fingerprintPayload(vector)).toBe('["2026-01-31","","지출","-1500.5","KRW","합성카드","테스트 \\"따옴표\\" \\\\ 가게"]');
    expect(await createFingerprint(vector)).toBe(SHARED_VECTOR_HASH);
  });
});

describe('normalization helpers', () => {
  it('canonicalizes decimal strings without floats', () => {
    expect(canonicalAmount('+0012000.000')).toBe('12000');
    expect(canonicalAmount('-0.0')).toBe('0');
    expect(canonicalAmount('1,234.5600')).toBe('1234.56');
    expect(canonicalAmount('0.1')).toBe('0.1');
    expect(canonicalAmount('12a')).toBe('');
  });

  it('applies NFC and trims unicode edge spaces', () => {
    expect(normalizeText(String.fromCharCode(0x3000, 0xfeff) + '가' + String.fromCharCode(0xa0))).toBe('가');
    expect(normalizeText(String.fromCharCode(0x1100, 0x1161))).toBe('가');
  });
});

const SHARED_VECTOR_HASH = '749ffbe561d75053e5920b3d8eca5d05c0b8932fd611d4da5077cad0e67499f8';
