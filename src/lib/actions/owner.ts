/**
 * Owner Overview server function. Admin only: it shows margin and what staff cost per client.
 * Read only (nothing is written), so there is no activity log entry.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "../server/auth";
import { loadOverview } from "../server/ownerOverview";
import type { Overview } from "../owner/data";

export const getOwnerOverview = createServerFn({ method: "GET" })
  .validator(z.object({ period: z.enum(["this_week", "last_week", "this_month", "last_month"]) }))
  .handler(async ({ data }): Promise<Overview> => {
    await requireAdmin();
    return loadOverview(data.period);
  });
