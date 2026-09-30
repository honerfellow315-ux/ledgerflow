import { randomBytes } from "node:crypto";

/** Same style of id the old in-memory store used (e.g. "cl-8f2k1a"). */
export function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}
