/**
 * Server functions can fail with a 401/403 `Response`. If that Response ever
 * comes back as a *resolved value* instead of a rejection, React Query treats
 * it as successful data (and code like `data.map(...)` explodes, and a failed
 * login looks like a success). `unwrap` turns any Response back into a real
 * rejection so queries land in the error state.
 */
export async function unwrap<T>(p: Promise<T>): Promise<Exclude<T, Response>> {
  const r = await p;
  if (typeof Response !== "undefined" && r instanceof Response) throw r;
  return r as Exclude<T, Response>;
}

/** Last line of defence for list data: anything that isn't an array becomes []. */
export function asArray<T>(v: T[] | null | undefined): T[] {
  return Array.isArray(v) ? v : [];
}