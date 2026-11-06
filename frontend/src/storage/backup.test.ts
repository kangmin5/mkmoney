import { describe, expect, it, vi } from 'vitest';
import { createFingerprint } from '../import/fingerprint';
import { BackupError, decryptBackup, readText, encryptBackup, fromBase64, PBKDF2_ITERATIONS, type BackupPayload } from './backup';
import { planRestore, verifyBackupFingerprints } from './restore';

const PASS = 'synthetic-passphrase-1';

async function tx(description: string, extra: Partial<BackupPayload['transactions'][number]> = {}) {
  const row = { date: '2026-11-06', time: '12:00:00', source_type: '지출', flow: 'expense' as const, major_category: '식비', minor_category: null,
    description, amount: '-12000.0000', currency: 'KRW', payment_method: '합성카드', memo: null, fingerprint: '', ...extra };
  row.fingerprint = extra.fingerprint ?? await createFingerprint({ date: row.date, time: row.time ?? '', sourceType: row.source_type, amount: row.amount, currency: row.currency, paymentMethod: row.payment_method, description: row.description });
  return row;
}

async function payload(): Promise<BackupPayload> {
  return {
    format: 'mkmoney-backup', version: 2, exported_at: '2026-11-07T00:00:00Z', app_version: '0.1.3',
    transactions: [await tx('합성 비밀 가게')],
    type_mappings: [{ source_type: '합성타입', flow: 'refund' }],
    payment_mappings: [{ source_label: '합성카드', card_kind: 'credit' }],
    rules: [{ name: '합성 규칙', enabled: true, description_contains: '합성', source_type: null, direction: 'in', min_amount: '1000', max_amount: null, flow: 'income', user_category: '급여' }],
  };
}

const envelopeOf = async (blob: Blob) => JSON.parse(await readText(blob)) as Record<string, any>;
const blobOf = (value: unknown) => new Blob([JSON.stringify(value)]);

describe('encrypted backup', { timeout: 30_000 }, () => {
  it('round-trips with fresh salt and nonce and never exposes plaintext', async () => {
    const data = await payload();
    const first = await encryptBackup(data, PASS);
    const second = await encryptBackup(data, PASS);
    const env = await envelopeOf(first);
    expect(env).toMatchObject({ format: 'mkmoney-backup-encrypted', version: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS }, cipher: { name: 'AES-GCM' } });
    expect(fromBase64(env.kdf.salt)).toHaveLength(16);
    expect(fromBase64(env.cipher.iv)).toHaveLength(12);
    const env2 = await envelopeOf(second);
    expect(env2.kdf.salt).not.toBe(env.kdf.salt);
    expect(env2.cipher.iv).not.toBe(env.cipher.iv);
    expect(await readText(first)).not.toContain('합성');
    expect(await decryptBackup(first, PASS)).toEqual(data);
  });

  it('rejects wrong passphrases, tampered ciphertext and tampered headers alike', async () => {
    const env = await envelopeOf(await encryptBackup(await payload(), PASS));
    const expectFail = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: 'decrypt_failed' });
    await expectFail(decryptBackup(blobOf(env), 'wrong-passphrase'));
    const bytes = fromBase64(env.ciphertext);
    bytes[0] ^= 1;
    await expectFail(decryptBackup(blobOf({ ...env, ciphertext: btoa(String.fromCharCode(...bytes)) }), PASS));
    await expectFail(decryptBackup(blobOf({ ...env, kdf: { ...env.kdf, iterations: PBKDF2_ITERATIONS + 1 } }), PASS));
  });

  it('rejects unsupported versions, foreign files and out-of-range parameters', async () => {
    const env = await envelopeOf(await encryptBackup(await payload(), PASS));
    await expect(decryptBackup(blobOf({ ...env, version: 2 }), PASS)).rejects.toMatchObject({ code: 'unsupported' });
    await expect(decryptBackup(new Blob(['not json']), PASS)).rejects.toMatchObject({ code: 'malformed' });
    await expect(decryptBackup(blobOf({ format: 'other' }), PASS)).rejects.toMatchObject({ code: 'malformed' });
    await expect(decryptBackup(blobOf({ ...env, kdf: { ...env.kdf, iterations: 1 } }), PASS)).rejects.toMatchObject({ code: 'malformed' });
  });

  it('validates the decrypted payload and reports only row numbers', async () => {
    const data = await payload();
    const bad = { ...data, transactions: [data.transactions[0], { ...data.transactions[0], amount: '합성금액' }] };
    const error = await decryptBackup(await encryptBackup(bad as BackupPayload, PASS), PASS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackupError);
    expect((error as BackupError).message).toBe('백업의 2번째 거래 형식이 올바르지 않습니다.');
  });

  it('refuses short passphrases and keeps them out of storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await expect(encryptBackup(await payload(), 'short')).rejects.toMatchObject({ code: 'weak_passphrase' });
    await encryptBackup(await payload(), PASS);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});

describe('restore plan', () => {
  it('splits new, existing, in-backup duplicate and damaged rows and keeps only absent mappings', async () => {
    const a = await tx('합성 A');
    const b = await tx('합성 B');
    const c = await tx('합성 C');
    const damaged = { ...(await tx('합성 D')), amount: '-1.0000' };
    const data: BackupPayload = { ...(await payload()), transactions: [a, b, b, c, damaged],
      type_mappings: [{ source_type: '있음', flow: 'income' }, { source_type: '없음', flow: 'refund' }],
      payment_mappings: [{ source_label: '합성카드', card_kind: 'debit' }] };
    const valid = await verifyBackupFingerprints(data.transactions);
    expect(valid).toEqual([true, true, true, true, false]);
    const plan = planRestore(data, valid, new Set([c.fingerprint]), new Set(['있음']), new Set(['합성카드']), new Set(['합성 규칙']));
    expect(plan.rules).toEqual([]);
    expect(plan.rows.map((r) => r.description)).toEqual(['합성 A', '합성 B']);
    expect([plan.total, plan.existing, plan.duplicateInBackup, plan.damaged]).toEqual([5, 1, 1, 1]);
    expect(plan.typeMappings).toEqual([{ source_type: '없음', flow: 'refund' }]);
    expect(plan.paymentMappings).toEqual([]);
  });
});

describe('backup versions', { timeout: 30_000 }, () => {
  it('still restores version 1 backups without rules or user categories', async () => {
    const { rules: _ignored, ...v1 } = { ...(await payload()), version: 1 as const };
    const decrypted = await decryptBackup(await encryptBackup(v1 as unknown as BackupPayload, PASS), PASS);
    expect(decrypted.version).toBe(1);
    expect(decrypted.rules).toEqual([]);
  });

  it('rejects malformed rules in version 2', async () => {
    const bad = { ...(await payload()), rules: [{ name: '', flow: 'income' }] };
    await expect(decryptBackup(await encryptBackup(bad as unknown as BackupPayload, PASS), PASS)).rejects.toMatchObject({ code: 'malformed' });
  });
});
