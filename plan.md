# LedgerFlow: kaam ka plan

Ye file batati hai ke hamne kya karna tha, kya ho chuka hai, aur kya baqi hai.
Aakhri update: Oct 2026.

## Kaam karne ka tareeqa

1. **Pehle sirf UI.** Har feature, har section aur har route ki screen pehle sample data ke saath banti hai. Backend (asli data, save, files padhna) sab UI ke baad.
2. **Sirf naye ya badle hue files** deliver hote hain, poori zip nahi.
3. **Purane modules kharab nahi hone chahiye.** Naya kaam alag files me, purani files me sirf chhoti edits (menu ki lines wagera).
4. **Push se pehle `npm run build` chalao** (10 se 15 second). Ghalat folder ya ghalat paste yahin pakre jate hain.
5. **Pehle apna test DB, phir client ka DB.** Client ke DB par kuch bhi chalane se pehle backup (Neon branch ya restore point).
6. **Asli staff ka data (NI, bank details) test DB me copy nahi karna.** Sample ya jhoota data use karo.
7. **Client baar baar purane modules me change maangta hai:** chhote changes alag se pehle nipta do, naya feature uske baad. Dono ek delivery me mix nahi.

## Jo nahi banana (faisla ho chuka)

- Koi bhi **automated email** (confirm, query, reminder, statement email).
- **Staff document verify / expiry alerts.**
- **Staff portal aur mobile app.**

## Ho chuka

### Purane 4 issues (Payroll / Staff)
| Issue | Hal |
|---|---|
| Holiday dalne par amount zero | Holiday entitlement likhte hi holiday rate (12.71) khud lag jata hai, aur sheet me **Holiday rate** ka column hai |
| Fixed amount ka option nahi tha | Payroll sheet me **Fixed amount** column. Jis staff ka pichle mahine fixed amount tha (aur ghante nahi the) uska amount nayi month me khud aa jata hai |
| Ek company me active karne se doosri me bhi active | Contract status aur end date ab **company wise** save hoti hai (`payroll_company_staff.contract_status`) |
| Month delete par staff data reh jata tha | Delete par wo log dikhte hain jo sirf isi sheet par the, tick karne par Recycle Bin me chale jate hain (sirf admin) |

**DB par ye SQL is tarteeb se chalani hain** (pehle test DB, phir client DB, backup ke baad):
1. `schema/company-contract-status-migration.sql`
2. `schema/company-contract-status-backfill.sql`

### Naye screens (sirf UI, sample data, abhi sirf admin ko nazar aate hain)
| Menu | Route | Files | Kya karta hai |
|---|---|---|---|
| Timesheet Check | `/timesheets` | `routes/timesheets.index.tsx`, `lib/timesheets/`, `components/app/timesheets/` | Staff ki bheji hui sheet ko apne record se milana, galat rows dikhana, **Excel receipt/report download** |
| Tasks | `/tasks` | `routes/tasks.index.tsx`, `lib/tasks/`, `components/app/tasks/` | Admin task de ya apne liye likhe (text khud likhna), status: To do, In progress, Done, Verified, activity history |
| Payslips | `/payslips` | `routes/payslips.index.tsx`, `lib/payslips/`, `components/app/payslips/` | Har staff ki payslip, preview aur download (Payroll sheet ke hisaab se) |
| Invoice Drafts | `/invoice-drafts` | `routes/invoice-drafts.index.tsx`, `lib/invoiceDrafts/`, `components/app/invoiceDrafts/` | Mahine ki shifts se invoice ka draft, check karke banana |
| Bank Match | `/bank-match` | `routes/bank-match.index.tsx`, `lib/bankMatch/`, `components/app/bankMatch/` | Bank statement ki payments ko invoices se milana |
| Follow-ups | `/follow-ups` | `routes/follow-ups.index.tsx`, `lib/followUps/`, `components/app/followUps/` | Overdue clients, har chase ka record, promise to pay (email ke baghair) |
| Owner Overview | `/owner` | `routes/owner.index.tsx`, `lib/owner/`, `components/app/owner/` | Kis client se kitna margin, kitna outstanding, hafte ki summary, 6 mahine ka billed/received |

### Build ki ghaltian jo theek ho gayin
- `src/lib/payroll/reportExport.ts` aur `src/lib/ledger/statementExcel.ts` me ghalat file paste hone se Vercel build toota tha. Dono ab sahi hain.
- `statementExcel.ts` dobara bani hai (Statements page ke call ke hisaab se), agar asli version git me hai to wohi behtar hai.

## Baqi: UI

1. **Dark redesign** (client ki image wali). Sab se aakhir me. Styles ke tokens, `AppShell`, `Panel`, `SummaryCard`, `DataTable` aur Dashboard page badlenge, baqi pages khud naye look me aayenge.

## Baqi: Backend (UI ke baad)

### Buniyad (Phase 0)
- Staff match **NI number** se (naam par nahi), NI na ho to staff ID. Naam par match hamesha review me jaye.
- Bade data par tezi: page wise loading, server par search, database indexes.
- Bari files ke kaam chhote hisson (batches) me, har ek ka status.
- Audit log, backups (Neon restore), **10,000 staff ka load test**.

### Timesheet Check (asli kaam)
- **Phase B:** Excel/CSV code se padhna (AI nahi), apne shifts se compare, naye tables (sirf `CREATE TABLE IF NOT EXISTS`), audit log.
- **Phase C:** typed PDF aur Word code se padhna.
- **Phase D:** tasveer / WhatsApp / scan wali sheet **AI vision** se padhna, review screen zaroori. AI sirf parhega, hisaab aur faisla normal code karega.
- Har sheet par total check (sheet ka apna total aur rows ka total), duplicate sheet pakadna, mahina lock.
- Parallel run: 1 se 2 mahine system aur haath ka kaam saath, phir bharosa.

### Baqi screens ko asli data se jorna
| Screen | Kya badalna hai |
|---|---|
| Tasks | `lib/tasks/data.ts` ki jagah database, activity log me entry, naya permission module (taake sirf admin nahi, user bhi apne tasks dekhe), "Team member" wala preview switch hatana |
| Payslips | Payroll sheet ki asli lines (`lineTotals` pehle se wahi hai), PDF download |
| Invoice Drafts | Salary Sheet ki asli shifts aur client rate, "Create invoice" se asli invoice banana |
| Bank Match | Bank file padhna, asli open invoices, Confirm par asli Payment record |
| Follow-ups | Contact history ka table, overdue invoices asli, Statement download (Statements ki Excel) |
| Owner Overview | Asli numbers (invoices, payments, payroll), summary download. `LOW_MARGIN` (15%) owner se confirm karna |

Har screen par jorte waqt: "Preview" wala notice hatao, `RequireView module="dashboard"` aur admin-only check ki jagah asli permission module lagao (`lib/permissions.ts` aur Users screen me), aur menu me `module: null` ki jagah wo module.

## Kholay hue sawal (client / tumhare faislay)

1. Timesheet me **15 minute ke farq** ko match maanein ya farq dikhayein?
2. Redesign **sirf dark** ya light/dark switch bhi?
3. Payslip par **tax / NI ki katautiyan** chahiye ya sirf kamai?
4. Receipt **Excel** me theek hai ya **PDF** chahiye?
5. Bank statement ka **format** (CSV ya Excel) aur ek sample.
6. Task ke 4 status theek hain (To do, In progress, Done waiting for check, Verified)?
7. Owner Overview me **kam margin** ki hadd kitni ho (abhi 15% rakhi hai, 8% se neeche "bohat kam")?
8. Guards ke liye **standard timesheet template**: upar Name aur NI number ka box, phir Date, Site, Start, End, Hours, Rate, Amount (break time chahiye ya nahi?).

## Aaj ki halat ek nazar me

- UI: 7 naye screens ban chuke, 1 baqi (dark redesign).
- Backend: abhi koi naya screen asli data se nahi juda.
