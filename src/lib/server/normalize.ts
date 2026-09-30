/**
 * Postgres returns `null` for empty optional columns; the frontend types in
 * src/lib/ledger/types.ts model the same fields as optional (`notes?: string`)
 * rather than nullable (`notes: string | null`). Rather than loosen those
 * types — they're the actual app contract every component is written
 * against — normalize at the boundary: strip `null` values from rows coming
 * out of the database, turning them into `undefined` (i.e. "not set").
 */
export function stripNulls<T extends Record<string, unknown>>(
  row: T,
): {
  [K in keyof T]: T[K] extends null ? never : Exclude<T[K], null>;
} {
  const out: Record<string, unknown> = {};
  for (const key in row) {
    const value = row[key];
    if (value !== null) out[key] = value;
  }
  return out as never;
}

export function stripNullsAll<T extends Record<string, unknown>>(rows: T[]) {
  return rows.map(stripNulls);
}
