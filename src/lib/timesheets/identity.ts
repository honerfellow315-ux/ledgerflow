/** Identity dates use ISO or explicit UK day/month/year; never guess a two-digit year. */
export function normalizeDob(raw: string): string {
  const text = raw.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const uk = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (!iso && !uk) return "";
  const y = Number(iso ? iso[1] : uk![3]);
  const m = Number(iso ? iso[2] : uk![2]);
  const d = Number(iso ? iso[3] : uk![1]);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    y < 1900 ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d ||
    date.getTime() > Date.now()
  )
    return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
