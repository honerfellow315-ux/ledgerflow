# LedgerFlow

LedgerFlow is an accounts receivable and ledger management application. It tracks
clients, invoices, payments, credit notes, hours, subcontracting and expenses, and
produces per-client statements of account.

## Features

- **Dashboard** — invoiced, received and outstanding balances at a glance
- **Clients** — client accounts with invoiced, paid and outstanding totals
- **Invoices, Payments, Credit Notes** — full lists with search, filters and VAT handling
- **Statements** — per-client running account statement with CSV export and a
  print-ready layout (uses the business details from Settings)
- **Hours, Subcontracting, Expenses** — operational ledgers
- **Salary Sheet, Staff** — monthly staff pay: shift-export / Excel import, payroll columns,
  P1..Pn cash payments, carry-forward between months, Excel export. Staff (NI numbers, bank
  details) has its own permission module. Run `schema/salary-migration.sql` once on an existing DB.
- **Payroll Sheet** — the "All Payroll Format" sheet, one per payroll company per month: units, bank holiday
  hours, rate, calculated total hours / amount, staff details and contract status (Active / Need P45 / P45).
  Add / archive payroll companies; add existing staff (one person can be in several companies) or create a new
  one; reinstate / P45 flow; new-month copy; Excel export in the original layout; copy or push the amounts into
  the Salary Sheet payroll column. Permission module `payroll`. Run `schema/payroll-sheet-migration.sql` once
  on an existing DB (after the salary and staff-details migrations).
- **Reports and Settings** — receivables reports; business, VAT and payment configuration

- **Timesheet Check: edit, account details, payments** — every shift row can be edited (hours and rate);
  the same figures are written to the Salary Sheet shift, so pay matches in both places. The sheet screen
  also shows the staff bank details (editable) and the cash / bank payments for the month, which are saved
  as normal Salary Sheet payments. Run `schema/timesheet-edit-migration.sql` once (after
  `timesheet-pay-migration.sql`), before deploying.

## Tech stack

TanStack Start (React 19, file-based routing), Vite, Tailwind CSS v4, Radix UI /
shadcn components, Recharts.

## Getting started

```sh
npm install      # or: bun install
npm run dev      # start the dev server
npm run build    # production build
npm run lint     # lint
```

## Project structure

| Path                  | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `src/routes/`         | File-based routes (one file per page)                     |
| `src/components/app/` | Application components (shell, dialogs, tables, panels)   |
| `src/components/ui/`  | Base UI primitives                                        |
| `src/lib/ledger/`     | Domain types, calculations, CSV export and the data layer |

## Data layer

Business data lives in Postgres (Neon). Server functions in `src/lib/actions/` read and write it
through Drizzle (`drizzle/schema.ts`); every one of them checks the signed-in user's permission on
the server, so hiding a button is only convenience. The browser keeps a cache in
`src/lib/ledger/store.tsx`.

## Database migrations

Run the SQL files in `schema/` once each, in this order, on a new or existing database (all are safe
to run again). Run migrations first, then deploy the code that needs them.

1. `ledgerflow-schema.sql` and the other module migrations, in the order they were added
2. `timesheets-migration.sql`, `timesheet-locks-migration.sql`, `timesheet-identity-migration.sql`
3. `final-data-integrity-migration.sql` (adds a UNIQUE index on invoices: check for duplicate
   invoice numbers in the same scope first)
4. `security-hardening-migration.sql` (case-insensitive usernames; skipped with a notice if two
   usernames differ only by case)
5. `timesheet-multi-sheet-migration.sql` (several sheets per person per month, "accept with a note")

## Tests

`npm test` runs the parsing, calculation, security and database checks. The database check
(`scripts/timesheet-db-check.ts`) applies every migration to an in-memory Postgres (PGlite) and
exercises Timesheet Check end to end.

## Permissions

Admins can do everything. Other users get View / Create / Edit / Delete / Approve per module in the
Users screen. Timesheet Check is its own module: new modules are OFF for existing users until an
admin ticks them. Reopening a locked timesheet month is admin-only.
