import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "../server/auth";
import { recordActivity } from "../server/activity";
import { moveStaffToTrash, staffDeleteImpact } from "../server/staffTrash";

/**
 * Deleting staff is admin-only: it removes their lines from every salary /
 * payroll sheet, so it sits with the Recycle Bin (also admin-only) that can
 * undo it. Nothing is lost — see src/lib/server/staffTrash.ts.
 */
const idsInput = z.object({ ids: z.array(z.string()).max(10000) });

/** Read-only preview shown in the confirm dialog. Writes nothing. */
export const previewStaffDelete = createServerFn({ method: "POST" })
  .validator(idsInput)
  .handler(async ({ data }) => {
    await requireAdmin();
    return staffDeleteImpact(data.ids);
  });

export const deleteStaff = createServerFn({ method: "POST" })
  .validator(idsInput)
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    const result = await moveStaffToTrash(data.ids, actor.username);
    if (result.deleted > 0) {
      await recordActivity({
        actor,
        action: "deleted",
        module: "staff",
        entityId: data.ids.length === 1 ? data.ids[0] : undefined,
        label:
          result.deleted === 1 ? "Staff — 1 profile" : `Staff — ${result.deleted} profiles`,
        details: "Moved to the Recycle Bin",
      });
    }
    return result;
  });
