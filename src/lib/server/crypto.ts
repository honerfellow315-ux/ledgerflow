import { createHash, randomBytes } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** URL-safe random token with `bytes` bytes of entropy (default 256 bit). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
