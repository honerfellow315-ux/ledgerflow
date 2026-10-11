import { useQuery } from "@tanstack/react-query";
import { taskWorkload } from "@/lib/actions/tasks";
import { unwrap } from "@/lib/unwrap";
import { usePermissions } from "@/lib/ledger/permissions";

export function TaskWorkload() {
  const { user } = usePermissions();
  const query = useQuery({
    queryKey: ["tasks", "workload", user?.username],
    queryFn: () => unwrap(taskWorkload()),
    refetchInterval: 30_000,
  });
  if (query.isError)
    return <p className="text-xs text-destructive">Task totals could not be loaded.</p>;
  if (query.isPending) return <p className="text-xs text-muted-foreground">Loading task totals…</p>;
  if (!query.data.length) return null;
  return (
    <div className="max-h-64 overflow-auto">
      <p className="mb-2 text-xs text-muted-foreground">
        Current tasks by assigned user. The task history records who performed each action.
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="py-2 text-left">User</th>
            <th>To do</th>
            <th>Working</th>
            <th>Done</th>
            <th>Verified</th>
          </tr>
        </thead>
        <tbody>
          {query.data.map((row) => (
            <tr key={`${row.id}:${row.name}`} className="border-t">
              <td className="py-2">{row.name}</td>
              <td className="text-center">{row.todo}</td>
              <td className="text-center">{row.inProgress}</td>
              <td className="text-center">{row.completed}</td>
              <td className="text-center">{row.verified}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
