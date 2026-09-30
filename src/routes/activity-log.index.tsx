import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LockKeyhole,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "@/lib/icons";
import { listActivityLog, ACTIVITY_ACTIONS } from "@/lib/actions/activityLog";
import { listUsers } from "@/lib/actions/users";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { Panel, PanelHeader, EmptyState, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ActivityAction } from "@/lib/server/activity";

export const Route = createFileRoute("/activity-log/")({
  head: () => ({
    meta: [
      { title: "Activity Log — LedgerFlow" },
      {
        name: "description",
        content: "Who created, edited, deleted or restored what, and when — admin-only.",
      },
    ],
  }),
  component: ActivityLogPage,
});

const MODULE_OPTIONS = [
  { value: "clients", label: "Clients" },
  { value: "companies", label: "Companies" },
  { value: "invoices", label: "Invoices" },
  { value: "payments", label: "Payments" },
  { value: "expenses", label: "Expenses" },
  { value: "hours", label: "Hours" },
  { value: "subcontracting", label: "Subcontracting" },
  { value: "creditNotes", label: "Credit Notes" },
  { value: "settings", label: "Settings" },
  { value: "users", label: "Users" },
  { value: "auth", label: "Auth" },
];

const ACTION_META: Record<ActivityAction, { label: string; icon: typeof Plus; className: string }> =
  {
    created: {
      label: "Created",
      icon: Plus,
      className: "bg-success-soft text-success border-success/25",
    },
    updated: {
      label: "Updated",
      icon: Pencil,
      className: "bg-warning-soft text-warning border-warning/25",
    },
    deleted: {
      label: "Deleted",
      icon: Trash2,
      className: "bg-danger-soft text-destructive border-destructive/25",
    },
    restored: {
      label: "Restored",
      icon: RotateCcw,
      className: "bg-success-soft text-success border-success/25",
    },
    purged: {
      label: "Purged",
      icon: Trash2,
      className: "bg-danger-soft text-destructive border-destructive/25",
    },
    login: {
      label: "Login",
      icon: LogIn,
      className: "bg-success-soft text-success border-success/25",
    },
    login_failed: {
      label: "Login failed",
      icon: LockKeyhole,
      className: "bg-danger-soft text-destructive border-destructive/25",
    },
    logout: {
      label: "Logout",
      icon: LogOut,
      className: "bg-muted text-muted-foreground border-border-strong",
    },
  };

function ActionBadge({ action }: { action: string }) {
  const meta = ACTION_META[action as ActivityAction];
  if (!meta) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
        {action}
      </span>
    );
  }
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        meta.className,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function moduleLabel(module: string): string {
  return MODULE_OPTIONS.find((m) => m.value === module)?.label ?? module;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ActivityLogPage() {
  // Admin-only screen, same pattern as /recycle-bin and /users — RequireView's
  // module here is irrelevant; the real gate is isAdmin below.
  return (
    <RequireView module="dashboard">
      <ActivityLogPageContent />
    </RequireView>
  );
}

const ALL = "all";

function ActivityLogPageContent() {
  const { isAdmin, ready } = usePermissions();

  const [search, setSearch] = useState("");
  const [userId, setUserId] = useState(ALL);
  const [action, setAction] = useState(ALL);
  const [module, setModule] = useState(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const usersQ = useQuery({
    queryKey: ["users"],
    queryFn: () => listUsers(),
    enabled: isAdmin,
  });

  const filters = {
    userId: userId === ALL ? undefined : userId,
    action: action === ALL ? undefined : action,
    module: module === ALL ? undefined : module,
    from: from || undefined,
    to: to || undefined,
    search: search.trim() || undefined,
  };

  const logQ = useQuery({
    queryKey: ["activityLog", filters],
    queryFn: () => listActivityLog({ data: filters }),
    enabled: isAdmin,
  });

  if (!ready) return null;

  if (!isAdmin) {
    return (
      <Panel>
        <EmptyState
          title="You don't have access to this"
          description="Only administrators can see the activity log."
        />
      </Panel>
    );
  }

  const rows = logQ.data ?? [];
  const users = usersQ.data ?? [];
  const hasFilters =
    search.trim() || userId !== ALL || action !== ALL || module !== ALL || from || to;

  function clearFilters() {
    setSearch("");
    setUserId(ALL);
    setAction(ALL);
    setModule(ALL);
    setFrom("");
    setTo("");
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Activity Log"
          description={
            rows.length === 0
              ? "No activity yet."
              : `${rows.length} event${rows.length === 1 ? "" : "s"} — most recent first.`
          }
        />

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search label, user..."
              className="h-8 w-52 pl-8 text-[13px]"
            />
          </div>

          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger className="h-8 w-40 text-[13px]">
              <SelectValue placeholder="All users" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All users</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.displayName || u.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="h-8 w-36 text-[13px]">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All actions</SelectItem>
              {ACTIVITY_ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {ACTION_META[a].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={module} onValueChange={setModule}>
            <SelectTrigger className="h-8 w-40 text-[13px]">
              <SelectValue placeholder="All modules" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All modules</SelectItem>
              {MODULE_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-8 w-[9.5rem] text-[13px]"
            aria-label="From date"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-8 w-[9.5rem] text-[13px]"
            aria-label="To date"
          />

          {hasFilters ? (
            <Button size="sm" variant="ghost" onClick={clearFilters} className="h-8">
              <X className="size-3.5" /> Clear
            </Button>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            description={
              hasFilters
                ? "No activity matches these filters."
                : "Every create, edit, delete, restore and login across LedgerFlow will show up here."
            }
          />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Time</TH>
                  <TH>User</TH>
                  <TH>Action</TH>
                  <TH>Module</TH>
                  <TH>Record</TH>
                  <TH>Details</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {formatTimestamp(row.createdAt as unknown as string)}
                    </TD>
                    <TD className="font-medium">{row.displayName || row.username}</TD>
                    <TD>
                      <ActionBadge action={row.action} />
                    </TD>
                    <TD className="text-muted-foreground">{moduleLabel(row.module)}</TD>
                    <TD>{row.label || "—"}</TD>
                    <TD
                      className="max-w-xs truncate text-muted-foreground"
                      title={row.details ?? ""}
                    >
                      {row.details || "—"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}
