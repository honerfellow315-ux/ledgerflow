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
- **Reports and Settings** — receivables reports; business, VAT and payment configuration

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

All business records are read and written through `src/lib/ledger/store.tsx`. The
application starts with an empty ledger. Records are currently held in memory for the
session; connect the production backend by replacing the bodies of the store actions,
without changing the components that consume them.
