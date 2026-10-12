import { sql } from "drizzle-orm";
import { db } from "./db";
export interface UploadPart {
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
}
export async function stageImport(
  actorId: string,
  kind: string,
  scope: string,
  part: UploadPart,
  rows: unknown[],
) {
  // Purge abandoned staged data, without touching actual payroll records.
  await db.execute(sql`DELETE FROM import_jobs WHERE created_at < now() - interval '1 day'`);
  await db.execute(
    sql`INSERT INTO import_jobs(id,actor_id,kind,scope,total_chunks) VALUES(${part.uploadId},${actorId},${kind},${scope},${part.totalChunks}) ON CONFLICT DO NOTHING`,
  );
  const job = (
    await db.execute(sql`SELECT * FROM import_jobs WHERE id=${part.uploadId} FOR UPDATE`)
  ).rows[0] as Record<string, unknown> | undefined;
  if (
    !job ||
    job["actor_id"] !== actorId ||
    job["kind"] !== kind ||
    job["scope"] !== scope ||
    Number(job["total_chunks"]) !== part.totalChunks
  )
    throw new Error("Import session does not match. Select the file again.");
  if (job["result"]) return { complete: true, result: job["result"], rows: [] };
  if (part.chunkIndex < 0 || part.chunkIndex >= part.totalChunks)
    throw new Error("Invalid import chunk.");
  const encoded = JSON.stringify(rows);
  await db.execute(
    sql`INSERT INTO import_chunks(job_id,chunk_index,payload) VALUES(${part.uploadId},${part.chunkIndex},${encoded}::jsonb) ON CONFLICT DO NOTHING`,
  );
  const saved = (
    await db.execute(
      sql`SELECT payload FROM import_chunks WHERE job_id=${part.uploadId} AND chunk_index=${part.chunkIndex}`,
    )
  ).rows[0] as { payload: unknown };
  if (JSON.stringify(saved.payload) !== JSON.stringify(JSON.parse(encoded))) {
    // JSONB reorders object keys: compare in SQL instead.
    const same = (
      await db.execute(
        sql`SELECT payload = ${encoded}::jsonb AS same FROM import_chunks WHERE job_id=${part.uploadId} AND chunk_index=${part.chunkIndex}`,
      )
    ).rows[0] as { same: boolean };
    if (!same.same) throw new Error("This upload has changed. Select the file again.");
  }
  const chunks = (
    await db.execute(
      sql`SELECT payload FROM import_chunks WHERE job_id=${part.uploadId} ORDER BY chunk_index`,
    )
  ).rows as { payload: unknown[] }[];
  return {
    complete: chunks.length === part.totalChunks,
    result: null,
    rows: chunks.flatMap((c) => c.payload),
  };
}
export async function finishImport(id: string, result: unknown) {
  await db.execute(
    sql`UPDATE import_jobs SET result=${JSON.stringify(result)}::jsonb WHERE id=${id}`,
  );
  await db.execute(sql`DELETE FROM import_chunks WHERE job_id=${id}`);
}
export async function lockImportPeriod(periodId: string) {
  // Staff matching is shared across periods and import types.
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ledgerflow-imports'))`);
  const row = (
    await db.execute(sql`SELECT status FROM salary_periods WHERE id=${periodId} FOR UPDATE`)
  ).rows[0] as { status: string } | undefined;
  if (!row || row.status === "closed") throw new Error("Salary period is missing or closed.");
}
