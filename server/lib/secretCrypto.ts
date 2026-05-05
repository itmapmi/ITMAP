/**
 * Symmetric encryption for at-rest secrets (e.g. user LLM API keys).
 *
 * Uses AES-256-GCM with a key derived from `LLM_KEY_ENCRYPTION_SECRET`
 * (preferred) or falls back to `SESSION_SECRET` so the platform always has
 * something to derive from. The wire format is:
 *
 *     v1:<base64(iv|tag|ciphertext)>
 *
 * `decryptSecret` is intentionally tolerant of legacy plaintext rows — if the
 * value doesn't start with `v1:` we return it verbatim. This lets us roll
 * encryption forward without a separate migration job; the next write of a
 * legacy row re-encrypts it.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1:";

function getKey(): Buffer {
  const secret = process.env.LLM_KEY_ENCRYPTION_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    // Fail closed in production — predictable encryption defeats the
    // purpose. In development we fall back to a clearly-labelled key so
    // local Replits without explicit env vars still boot.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "LLM_KEY_ENCRYPTION_SECRET (or SESSION_SECRET) must be set in production " +
        "to encrypt user LLM API keys."
      );
    }
    return createHash("sha256").update("spectio-dev-only-not-for-production").digest();
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(stored: string): string {
  if (!stored?.startsWith(PREFIX)) return stored;
  try {
    const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    // Encryption secret rotated / corrupted blob — return empty so callers
    // treat as "no key" rather than crashing.
    return "";
  }
}
