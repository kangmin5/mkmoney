/**
 * 암호화 백업 파일(브라우저 전용). 암호는 메모리에서만 쓰고 저장·전송·로그하지 않는다.
 * - 키: PBKDF2-HMAC-SHA-256, 600,000회, 매번 새 16바이트 salt
 * - 암호화: AES-GCM-256, 매번 새 12바이트 nonce, 파일 머리(형식·버전·매개변수)를 추가 인증 데이터로 묶음
 * 암호를 잊으면 복구할 수 없다.
 */
import type { TransactionCreate } from "../api/client";
import { FLOWS, type CardKind, type Flow } from "../domain/transaction";

export const ENVELOPE_FORMAT = "mkmoney-backup-encrypted";
export const ENVELOPE_VERSION = 1;
export const PAYLOAD_FORMAT = "mkmoney-backup";
export const PAYLOAD_VERSION = 1;
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 10;
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
/** 복호화 시 허용하는 반복 횟수 범위(너무 작으면 약하고, 너무 크면 브라우저가 멈춘다). */
const ITERATION_RANGE = [100_000, 5_000_000] as const;

/** 백업 내용(서버 /api/backup/export 응답과 같은 형태). */
export interface BackupPayload {
  format: typeof PAYLOAD_FORMAT;
  version: typeof PAYLOAD_VERSION;
  exported_at: string;
  app_version: string;
  transactions: TransactionCreate[];
  type_mappings: { source_type: string; flow: Flow }[];
  payment_mappings: { source_label: string; card_kind: CardKind }[];
}

/** 암호화 파일 머리. */
interface EnvelopeHeader {
  format: typeof ENVELOPE_FORMAT;
  version: number;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
}

/** 사용자 안내용 백업 오류(값을 담지 않는다). */
export class BackupError extends Error {
  constructor(
    readonly code: "decrypt_failed" | "unsupported" | "malformed" | "too_large" | "weak_passphrase" | "insecure_context",
    message: string,
  ) {
    super(message);
    this.name = "BackupError";
  }
}

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) throw new BackupError("insecure_context", "보안 연결(HTTPS)에서만 백업을 사용할 수 있습니다.");
  return globalThis.crypto.subtle;
}

/** 바이트 → base64(큰 배열도 안전하게 나눠 변환). */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** base64 → 바이트. 형식이 아니면 BackupError. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    throw new BackupError("malformed", "백업 파일 형식이 올바르지 않습니다.");
  }
}

/** 머리를 고정된 키 순서로 직렬화한다(추가 인증 데이터). */
function headerBytes(header: EnvelopeHeader): Uint8Array<ArrayBuffer> {
  const canonical = {
    format: header.format,
    version: header.version,
    kdf: { name: header.kdf.name, hash: header.kdf.hash, iterations: header.kdf.iterations, salt: header.kdf.salt },
    cipher: { name: header.cipher.name, iv: header.cipher.iv },
  };
  return new TextEncoder().encode(JSON.stringify(canonical));
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number, usage: KeyUsage): Promise<CryptoKey> {
  const material = await subtle().importKey("raw", new TextEncoder().encode(passphrase.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, [usage]);
}

/**
 * 백업 내용을 암호화해 다운로드용 Blob을 만든다.
 * @throws BackupError 암호가 너무 짧을 때
 */
export async function encryptBackup(payload: BackupPayload, passphrase: string): Promise<Blob> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new BackupError("weak_passphrase", `암호는 ${MIN_PASSPHRASE_LENGTH}자 이상이어야 합니다.`);
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const header: EnvelopeHeader = {
    format: ENVELOPE_FORMAT,
    version: ENVELOPE_VERSION,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt: toBase64(salt) },
    cipher: { name: "AES-GCM", iv: toBase64(iv) },
  };
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS, "encrypt");
  const ciphertext = await subtle().encrypt(
    { name: "AES-GCM", iv, additionalData: headerBytes(header) },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return new Blob([JSON.stringify({ ...header, ciphertext: toBase64(new Uint8Array(ciphertext)) })], { type: "application/json" });
}

/** 객체인지. */
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** 암호화 파일 머리를 검증한다. */
function parseEnvelope(raw: unknown): { header: EnvelopeHeader; ciphertext: string } {
  if (!isRecord(raw) || raw.format !== ENVELOPE_FORMAT) throw new BackupError("malformed", "mkmoney 백업 파일이 아닙니다.");
  if (raw.version !== ENVELOPE_VERSION) throw new BackupError("unsupported", "지원하지 않는 백업 파일 버전입니다. 앱을 최신 버전으로 업데이트하세요.");
  const { kdf, cipher, ciphertext } = raw;
  if (
    !isRecord(kdf) || kdf.name !== "PBKDF2" || kdf.hash !== "SHA-256" || typeof kdf.salt !== "string" ||
    typeof kdf.iterations !== "number" || !Number.isInteger(kdf.iterations) ||
    kdf.iterations < ITERATION_RANGE[0] || kdf.iterations > ITERATION_RANGE[1] ||
    !isRecord(cipher) || cipher.name !== "AES-GCM" || typeof cipher.iv !== "string" || typeof ciphertext !== "string"
  ) {
    throw new BackupError("malformed", "백업 파일 형식이 올바르지 않습니다.");
  }
  return {
    header: {
      format: ENVELOPE_FORMAT,
      version: ENVELOPE_VERSION,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: kdf.iterations, salt: kdf.salt },
      cipher: { name: "AES-GCM", iv: cipher.iv },
    },
    ciphertext,
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;
const AMOUNT_RE = /^-?\d{1,16}(\.\d{1,4})?$/;
const FINGERPRINT_RE = /^[a-f0-9]{64}$/;
const CARD_KINDS: readonly string[] = ["credit", "debit", "other"];

const optionalText = (value: unknown, max: number): boolean => value === null || (typeof value === "string" && value.length <= max);
const requiredText = (value: unknown, max: number): boolean => typeof value === "string" && value.length >= 1 && value.length <= max;

/** 거래 한 건이 서버 스키마에 맞는지. */
function isTransaction(value: unknown): value is TransactionCreate {
  if (!isRecord(value)) return false;
  return (
    typeof value.date === "string" && DATE_RE.test(value.date) &&
    (value.time === null || (typeof value.time === "string" && TIME_RE.test(value.time))) &&
    requiredText(value.source_type, 120) &&
    typeof value.flow === "string" && (FLOWS as readonly string[]).includes(value.flow) &&
    optionalText(value.major_category, 120) && optionalText(value.minor_category, 120) &&
    requiredText(value.description, 500) &&
    typeof value.amount === "string" && AMOUNT_RE.test(value.amount) &&
    typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency) &&
    requiredText(value.payment_method, 200) && optionalText(value.memo, 1000) &&
    typeof value.fingerprint === "string" && FINGERPRINT_RE.test(value.fingerprint)
  );
}

/**
 * 복호화한 내용의 스키마를 검증한다. 오류에는 행 번호만 담는다.
 * @throws BackupError
 */
export function validatePayload(raw: unknown): BackupPayload {
  if (!isRecord(raw) || raw.format !== PAYLOAD_FORMAT) throw new BackupError("malformed", "백업 내용 형식이 올바르지 않습니다.");
  if (raw.version !== PAYLOAD_VERSION) throw new BackupError("unsupported", "지원하지 않는 백업 내용 버전입니다.");
  if (!Array.isArray(raw.transactions) || !Array.isArray(raw.type_mappings) || !Array.isArray(raw.payment_mappings)) {
    throw new BackupError("malformed", "백업 내용 형식이 올바르지 않습니다.");
  }
  raw.transactions.forEach((tx, index) => {
    if (!isTransaction(tx)) throw new BackupError("malformed", `백업의 ${index + 1}번째 거래 형식이 올바르지 않습니다.`);
  });
  for (const m of raw.type_mappings) {
    if (!isRecord(m) || !requiredText(m.source_type, 120) || typeof m.flow !== "string" || !(FLOWS as readonly string[]).includes(m.flow)) {
      throw new BackupError("malformed", "백업의 타입 매핑 형식이 올바르지 않습니다.");
    }
  }
  for (const m of raw.payment_mappings) {
    if (!isRecord(m) || !requiredText(m.source_label, 200) || typeof m.card_kind !== "string" || !CARD_KINDS.includes(m.card_kind)) {
      throw new BackupError("malformed", "백업의 결제수단 매핑 형식이 올바르지 않습니다.");
    }
  }
  return {
    format: PAYLOAD_FORMAT,
    version: PAYLOAD_VERSION,
    exported_at: typeof raw.exported_at === "string" ? raw.exported_at : "",
    app_version: typeof raw.app_version === "string" ? raw.app_version : "",
    transactions: raw.transactions as TransactionCreate[],
    type_mappings: raw.type_mappings as BackupPayload["type_mappings"],
    payment_mappings: raw.payment_mappings as BackupPayload["payment_mappings"],
  };
}

/** Blob을 텍스트로 읽는다(구형 환경은 FileReader). */
export async function readText(file: Blob): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new BackupError("malformed", "파일을 읽지 못했습니다."));
    reader.readAsText(file);
  });
}

/**
 * 백업 파일을 복호화하고 검증한다. 잘못된 암호와 변조·손상은 구분할 수 없으므로 같은 오류로 알린다.
 * @throws BackupError
 */
export async function decryptBackup(file: Blob, passphrase: string): Promise<BackupPayload> {
  if (file.size > MAX_BACKUP_BYTES) throw new BackupError("too_large", "백업 파일이 너무 큽니다.");
  let raw: unknown;
  try {
    raw = JSON.parse(await readText(file));
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError("malformed", "mkmoney 백업 파일이 아닙니다.");
  }
  const { header, ciphertext } = parseEnvelope(raw);
  const salt = fromBase64(header.kdf.salt);
  const iv = fromBase64(header.cipher.iv);
  if (salt.length < 16 || iv.length !== 12) throw new BackupError("malformed", "백업 파일 형식이 올바르지 않습니다.");
  let plaintext: ArrayBuffer;
  try {
    const key = await deriveKey(passphrase, salt, header.kdf.iterations, "decrypt");
    plaintext = await subtle().decrypt({ name: "AES-GCM", iv, additionalData: headerBytes(header) }, key, fromBase64(ciphertext));
  } catch (error) {
    if (error instanceof BackupError && error.code !== "malformed") throw error;
    throw new BackupError("decrypt_failed", "암호가 틀렸거나 파일이 손상·변조되었습니다.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new BackupError("malformed", "백업 내용 형식이 올바르지 않습니다.");
  }
  return validatePayload(payload);
}

/** 다운로드 파일 이름(예: mkmoney-backup-2026-11-07.json). */
export function backupFileName(today: string): string {
  return `mkmoney-backup-${today}.json`;
}
