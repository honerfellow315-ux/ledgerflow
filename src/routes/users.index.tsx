import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Banknote,
  Building2,
  ClipboardList,
  Clock,
  FileMinus,
  FileText,
  HardHat,
  IdCard,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Pencil,
  Plus,
  Receipt,
  ReceiptText,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
  Users as UsersIcon,
  Wallet,
} from "@/lib/icons";
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  generateActivationCode,
  resetUserTotp,
  revokeUserSessions,
} from "@/lib/actions/users";
import { MIN_PASSWORD_LENGTH, validatePassword } from "@/lib/passwordPolicy";
import {
  MODULES,
  MODULE_ACTIONS,
  MODULE_LABELS,
  ACTION_LABELS,
  fullPermissions,
  emptyPermissions,
  type Permissions,
  type Module,
  type Action,
} from "@/lib/permissions";
import { usePermissions } from "@/lib/ledger/permissions";
import { RequireView } from "@/components/app/RequireView";
import { Panel, PanelHeader, EmptyState, TableWrap } from "@/components/app/Panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/app/DataTable";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/users/")({
  head: () => ({
    meta: [
      { title: "Users — LedgerFlow" },
      { name: "description", content: "Manage user accounts, roles and module permissions." },
    ],
  }),
  component: UsersPage,
});

type UserRow = Awaited<ReturnType<typeof listUsers>>[number];

/** Server functions reject with a `Response` for 4xx errors — read its text. */
async function errorText(err: unknown, fallback: string): Promise<string> {
  if (err instanceof Response) {
    const t = await err.text().catch(() => "");
    return t || fallback;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Short status line shown under the username. */
function securityStatus(u: UserRow): { label: string; tone: "ok" | "warn" | "bad" } | null {
  if (u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now()) {
    return { label: "Locked (too many failed logins)", tone: "bad" };
  }
  if (u.role === "admin") {
    return u.totpEnabled
      ? { label: "2FA on", tone: "ok" }
      : { label: "2FA not set up yet", tone: "warn" };
  }
  if (u.mustActivate) {
    const expired =
      !u.activationExpiresAt || new Date(u.activationExpiresAt).getTime() < Date.now();
    return {
      label: expired ? "Needs a new activation code" : "Waiting for activation",
      tone: "warn",
    };
  }
  return null;
}

/** One-time display of an activation code. */
function ActivationCodeDialog({
  info,
  onClose,
}: {
  info: { username: string; code: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!info} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Activation code for {info?.username}</DialogTitle>
          <DialogDescription>
            Give this code to the user (phone or in person). They enter it at their next login and
            then choose their own password.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-lg border border-border bg-muted/50 py-5 text-center font-mono text-3xl font-semibold tracking-[0.25em]">
          {info?.code}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          Valid for 24 hours, works once, and is <strong>shown only now</strong>. If it is lost,
          generate a new one.
        </p>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (info) void navigator.clipboard?.writeText(info.code);
              toast.success("Code copied.");
            }}
          >
            Copy
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MODULE_ICONS: Record<Module, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  clients: UsersIcon,
  companies: Building2,
  invoices: FileText,
  payments: Wallet,
  statements: ClipboardList,
  subcontracting: HardHat,
  expenses: ReceiptText,
  creditNotes: FileMinus,
  hours: Clock,
  salary: Banknote,
  staff: IdCard,
  reports: Receipt,
  settings: SettingsIcon,
};

function UsersPage() {
  // Admin-only screen — RequireView here gates on the "dashboard" view module
  // being irrelevant; the real gate is isAdmin, checked below.
  return (
    <RequireView module="dashboard">
      <UsersPageContent />
    </RequireView>
  );
}

function UsersPageContent() {
  const { isAdmin, ready, user: me } = usePermissions();
  const qc = useQueryClient();
  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => listUsers() });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [toDelete, setToDelete] = useState<UserRow | null>(null);
  const [codeInfo, setCodeInfo] = useState<{ username: string; code: string } | null>(null);
  const [toReset2fa, setToReset2fa] = useState<UserRow | null>(null);

  const refreshUsers = () => qc.invalidateQueries({ queryKey: ["users"] });

  const codeMutation = useMutation({
    mutationFn: (id: string) => generateActivationCode({ data: { id } }),
    onSuccess: (r) => {
      setCodeInfo({ username: r.username, code: r.code });
      void refreshUsers();
    },
    onError: async (err: unknown) =>
      toast.error(await errorText(err, "Could not generate a code.")),
  });

  const resetTotpMutation = useMutation({
    mutationFn: (id: string) => resetUserTotp({ data: { id } }),
    onSuccess: () => {
      toast.success("2FA reset. They will set it up again at next login.");
      void refreshUsers();
    },
    onError: async (err: unknown) => toast.error(await errorText(err, "Reset failed.")),
  });

  const signOutMutation = useMutation({
    mutationFn: (id: string) => revokeUserSessions({ data: { id } }),
    onSuccess: () => {
      toast.success("Signed out of all devices.");
      void refreshUsers();
    },
    onError: async (err: unknown) => toast.error(await errorText(err, "Action failed.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteUser({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("User deleted.");
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Delete failed."),
  });

  if (!ready) return null;

  if (!isAdmin) {
    return (
      <Panel>
        <EmptyState
          title="You don't have access to this"
          description="Only administrators can manage users."
        />
      </Panel>
    );
  }

  const rows = usersQ.data ?? [];

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Users"
          description={`${rows.length} user account${rows.length === 1 ? "" : "s"}`}
          actions={
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="size-4" /> Add User
            </Button>
          }
        />

        {rows.length === 0 ? (
          <EmptyState title="No users yet" description="Add the first user account." />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Username</TH>
                  <TH>Display Name</TH>
                  <TH>Role</TH>
                  <TH align="right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((u) => (
                  <TR key={u.id}>
                    <TD mono className="font-medium">
                      {u.username}
                      {(() => {
                        const st = securityStatus(u);
                        if (!st) return null;
                        return (
                          <span
                            className={cn(
                              "mt-0.5 block font-sans text-[11px] font-normal",
                              st.tone === "ok" && "text-emerald-600",
                              st.tone === "warn" && "text-amber-600",
                              st.tone === "bad" && "text-destructive",
                            )}
                          >
                            {st.label}
                          </span>
                        );
                      })()}
                    </TD>
                    <TD>{u.displayName || "—"}</TD>
                    <TD>
                      <span className="inline-flex items-center gap-1.5 text-[13px]">
                        {u.role === "admin" ? (
                          <ShieldCheck className="size-3.5 text-primary" />
                        ) : null}
                        {u.role === "admin" ? "Admin" : "User"}
                      </span>
                    </TD>
                    <TD align="right">
                      <div className="flex justify-end gap-1">
                        {u.role !== "admin" ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Generate activation code for ${u.username}`}
                            title="Generate activation code"
                            disabled={codeMutation.isPending}
                            onClick={() => codeMutation.mutate(u.id)}
                          >
                            <LockKeyhole className="size-3.5" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Reset 2FA for ${u.username}`}
                            title="Reset 2FA"
                            disabled={u.username === me?.username}
                            onClick={() => setToReset2fa(u)}
                          >
                            <RotateCcw className="size-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Sign ${u.username} out of all devices`}
                          title="Sign out of all devices"
                          onClick={() => signOutMutation.mutate(u.id)}
                        >
                          <LogOut className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Edit ${u.username}`}
                          onClick={() => {
                            setEditing(u);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                          aria-label={`Delete ${u.username}`}
                          onClick={() => setToDelete(u)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Panel>

      <UserDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        user={editing}
        onCreatedCode={setCodeInfo}
      />

      <ActivationCodeDialog info={codeInfo} onClose={() => setCodeInfo(null)} />

      <ConfirmDialog
        open={!!toReset2fa}
        onOpenChange={(v) => !v && setToReset2fa(null)}
        title="Reset two-factor login?"
        description={`${toReset2fa?.username ?? "This admin"} will be signed out and must set up their authenticator app again at next login.`}
        confirmLabel="Reset 2FA"
        onConfirm={() => {
          if (toReset2fa) resetTotpMutation.mutate(toReset2fa.id);
          setToReset2fa(null);
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Delete user?"
        description={`This removes ${toDelete?.username ?? "the user"}'s account. This cannot be undone.`}
        confirmLabel="Delete user"
        onConfirm={() => {
          if (toDelete) deleteMutation.mutate(toDelete.id);
          setToDelete(null);
        }}
      />
    </div>
  );
}

function UserDialog({
  open,
  onOpenChange,
  user,
  onCreatedCode,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user?: UserRow | null;
  onCreatedCode: (info: { username: string; code: string }) => void;
}) {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [permissions, setPermissions] = useState<Permissions>(emptyPermissions());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (user) {
      setUsername(user.username);
      setDisplayName(user.displayName ?? "");
      setPassword("");
      setRole(user.role);
      setPermissions((user.permissions as Permissions) ?? emptyPermissions());
    } else {
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("user");
      setPermissions(emptyPermissions());
    }
  }, [open, user]);

  const toggle = (module: Module, action: Action, value: boolean) => {
    setPermissions((p) => ({
      ...p,
      [module]: { ...p[module], [action]: value },
    }));
  };

  const applyPreset = (preset: "full" | "none") => {
    setPermissions(preset === "full" ? fullPermissions() : emptyPermissions());
  };

  const submit = async () => {
    if (!username.trim()) {
      toast.error("Username is required.");
      return;
    }
    if (!user || password) {
      const problem = validatePassword(password, username);
      if (problem) {
        toast.error(problem);
        return;
      }
    }

    setSaving(true);
    try {
      if (user) {
        await updateUser({
          data: {
            id: user.id,
            patch: {
              displayName: displayName.trim(),
              role,
              permissions,
              ...(password ? { password } : {}),
            },
          },
        });
        toast.success("User updated.");
      } else {
        const created = await createUser({
          data: {
            username: username.trim(),
            password,
            displayName: displayName.trim(),
            role,
            permissions,
          },
        });
        toast.success("User created.");
        if (created && "activationCode" in created && created.activationCode) {
          onCreatedCode({ username: created.username, code: created.activationCode });
        }
      }
      await qc.invalidateQueries({ queryKey: ["users"] });
      onOpenChange(false);
    } catch (err) {
      toast.error(await errorText(err, "Save failed."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-emphasis text-primary-foreground shadow-[0_4px_14px_-4px_oklch(0.4_0.1_192/0.55)] ring-1 ring-white/10">
              <ShieldCheck className="size-4.5" />
            </span>
            <div>
              <DialogTitle>{user ? "Edit User" : "Add User"}</DialogTitle>
              <DialogDescription className="mt-0.5">
                Set login details and choose exactly what this user can view, create, edit or
                delete.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-3 py-2 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Username</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={!!user}
              placeholder="e.g. jsmith"
            />
          </div>
          <div>
            <Label className="text-xs">Display Name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">
              Password{" "}
              {user ? <span className="text-muted-foreground">(leave blank to keep)</span> : null}
            </Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={user ? "••••••••" : `At least ${MIN_PASSWORD_LENGTH} characters`}
            />
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "admin" | "user")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {role === "admin" ? (
          <p className="flex items-center gap-2.5 rounded-lg border border-dashed border-border-strong bg-gradient-to-r from-accent/60 to-transparent px-3.5 py-2.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-primary" />
            Admins bypass all permission checks below — every module and action is automatically
            allowed.
          </p>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-md bg-accent text-accent-foreground">
                  <LockKeyhole className="size-3.5" />
                </span>
                <Label className="text-xs font-semibold tracking-wide text-foreground">
                  Module Permissions
                </Label>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-full border-border-strong bg-surface px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                  onClick={() => applyPreset("none")}
                >
                  Clear all
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 rounded-full bg-gradient-to-r from-primary to-primary-emphasis px-3 text-[11px] font-semibold text-primary-foreground shadow-[0_4px_14px_-4px_oklch(0.4_0.1_192/0.5)] transition-shadow hover:shadow-[0_6px_18px_-4px_oklch(0.4_0.1_192/0.6)]"
                  onClick={() => applyPreset("full")}
                >
                  Grant all
                </Button>
              </div>
            </div>

            <div className="max-h-80 space-y-1.5 overflow-y-auto rounded-xl border border-border bg-surface-muted/50 p-1.5">
              {MODULES.map((module) => {
                const Icon = MODULE_ICONS[module];
                const actions = MODULE_ACTIONS[module];
                const granted = actions.filter((a) => permissions[module]?.[a] === true).length;
                const allGranted = granted === actions.length;
                return (
                  <div
                    key={module}
                    className={cn(
                      "group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2.5 transition-all duration-150",
                      allGranted
                        ? "border-primary/25 bg-gradient-to-r from-accent/70 to-surface shadow-[0_1px_2px_oklch(0.25_0.03_255/0.04)]"
                        : "border-transparent bg-surface hover:border-border hover:shadow-panel",
                    )}
                  >
                    <div className="flex min-w-[9.5rem] items-center gap-2.5">
                      <span
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
                          allGranted
                            ? "bg-primary text-primary-foreground"
                            : "bg-accent text-accent-foreground",
                        )}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <span className="text-[13px] font-medium text-foreground">
                        {MODULE_LABELS[module]}
                      </span>
                    </div>
                    <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      {actions.map((action) => (
                        <label
                          key={action}
                          className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-muted-foreground"
                        >
                          <Switch
                            checked={permissions[module]?.[action] === true}
                            onCheckedChange={(v) => toggle(module, action, v === true)}
                            className="scale-[0.85]"
                          />
                          {ACTION_LABELS[action]}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : user ? "Save Changes" : "Create User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
