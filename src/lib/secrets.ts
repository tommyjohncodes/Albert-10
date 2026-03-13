import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const SECRET_PREFIX = "enc:v1:";
const ENCRYPTION_ENV_KEY = "OPENROUTER_KEY_ENCRYPTION_KEY";

function resolveEncryptionKey(): Buffer | null {
  const raw = process.env[ENCRYPTION_ENV_KEY];
  if (!raw) return null;

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  if (raw.startsWith("base64:")) {
    const decoded = Buffer.from(raw.slice("base64:".length), "base64");
    return decoded.length === 32 ? decoded : null;
  }

  const base64Decoded = Buffer.from(raw, "base64");
  if (base64Decoded.length === 32) {
    return base64Decoded;
  }

  if (raw.length === 32) {
    return Buffer.from(raw, "utf8");
  }

  return null;
}

function requireEncryptionKey(): Buffer {
  const key = resolveEncryptionKey();
  if (!key || key.length !== 32) {
    throw new Error(
      `${ENCRYPTION_ENV_KEY} must be set to a 32-byte key (hex, base64, or a 32-char string).`
    );
  }
  return key;
}

export function hasEncryptionKey(): boolean {
  const key = resolveEncryptionKey();
  return Boolean(key && key.length === 32);
}

export function encryptSecret(value: string): string {
  if (!value) return value;
  if (value.startsWith(SECRET_PREFIX)) return value;

  const key = requireEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${SECRET_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(value: string): string {
  if (!value) return value;
  if (!value.startsWith(SECRET_PREFIX)) return value;

  const key = requireEncryptionKey();
  const payload = value.slice(SECRET_PREFIX.length);
  const [ivB64, tagB64, ...dataParts] = payload.split(":");
  const dataB64 = dataParts.join(":");

  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Encrypted value is malformed.");
  }

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
