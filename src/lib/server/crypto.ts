import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time string comparison (for hashes / codes). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** URL-safe random token with `bytes` bytes of entropy (default 256 bit). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

// No 0/O/1/I/L so codes read out over the phone are hard to mix up.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Random human-friendly code, e.g. makeCode(8, 4) -> "K7QD-M2XR". */
export function makeCode(length: number, groupSize: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    if (i > 0 && i % groupSize === 0) out += "-";
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/** Normalises user-typed codes: upper-case, drops spaces and dashes. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* ---------- Field encryption (AES-256-GCM) ---------- */

function masterKey(): Buffer {
  const raw = process.env["AUTH_ENCRYPTION_KEY"];
  if (!raw || raw.length < 32) {
    throw new Error(
      "AUTH_ENCRYPTION_KEY is missing or too short (needs 32+ characters). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\" " +
        "and add it to your environment variables.",
    );
  }
  return Buffer.from(raw, "utf8");
}

/** One independent key per purpose ("totp", later "staff-pii"...) derived with HKDF. */
function deriveKey(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey(), "ledgerflow-v1", purpose, 32));
}

const PREFIX = "enc:v1:";

export function encryptString(plain: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(purpose), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64url");
}

export function decryptString(blob: string, purpose: string): string {
  if (!blob.startsWith(PREFIX)) throw new Error("Not an encrypted value");
  const raw = Buffer.from(blob.slice(PREFIX.length), "base64url");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(purpose), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
