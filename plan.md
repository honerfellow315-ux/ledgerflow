# LedgerFlow: kaam ka plan

Ye file batati hai ke hamne kya karna tha, kya ho chuka hai, aur kya baqi hai.
Aakhri update: 12 Oct 2026 (Step 1: pre-AI operational fixes).

## Current instructions (12 Oct 2026)

- Step 1 mein user ne dashboard, tasks/activity, report filters, Timesheet matching aur pre-AI document upload fixes authorize kiye.
- Purane working Salary, Payroll aur Staff Excel workflows unchanged rehne hain.
- Ab sample/mock UI phase nahi: operational modules existing database data use karte hain.
- AI photos/scanned PDFs last step mein; abhi implement nahi kiye.
- Database reset aur production deployment nahi karna. Testing aur production accounts alag hain.
- Neeche purana plan history hai; current instructions ko priority deni hai.

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

### Timesheet Check: Phase B (asli backend, Excel/CSV)
Ab `/timesheets` asli data par chalta hai (sample data hata diya, "preview" notice bhi).

- Upload: browser file parhta hai (`parseTimesheetFile`), chhota result server ko jata hai, server save aur compare karta hai. Har file ka alag nateeja dikhta hai.
- Staff match: pehle NI, phir sirf **unique naam**. Naam par match par sheet "Needs a look" rehti hai jab tak aap **This is the right person** na dabayein.
- Compare: tareekh aur site/client se `salary_shifts` ke saath. Ek din me kai shifts ek-ek karke milti hain (tafseel `compare.ts` ke upar comment me).
- **Farq ki hadd 0 minute (strict)**, ek hi jagah: `src/lib/timesheets/rules.ts`. Badalne ke baad "Check month again" dabayein.
- Sheet ka apna total aur rows ka total na mile to flag. Same file ya same banda + same mahina dobara upload ho to rok diya jata hai.
- Server functions (sab admin-only, activity log me entry): upload, list (page + search + status), ek sheet, dobara check (ek sheet ya poora mahina), name match confirm, delete.
- Excel receipt/report asli data se banta hai (ek bar me 1000 sheets tak).
- Naye tables: `timesheet_sheets`, `timesheet_rows` (`schema/timesheets-migration.sql`, sirf `CREATE TABLE IF NOT EXISTS`, rows sheet ke saath delete).

**DB par ye SQL chalani hai (code deploy se PEHLE):** `schema/timesheets-migration.sql`

### Timesheet Check: Phase C (typed PDF aur Word)
Ab `/timesheets` par **`.pdf` (jisme typed text ho) aur `.docx`** bhi upload hote hain. Purani `.doc`, scanned PDF aur photo abhi nahi (Phase D).

- Padhna browser me hota hai: PDF ka text `pdf.js` se, Word ki table `jszip` se. Phir wohi `parseTimesheetMatrix` chalta hai jo Excel ke liye hai, to date, ghante, raat ki shift, aur "jo cell parha na jaye wo kabhi 0 nahi banta" ke qaide bilkul wohi hain.
- PDF ki row us ki **tareekh** aur do **times** se pehchani jati hai. Hours, Rate, Amount aur Expense ko alag karne ke liye "£" ka nishan dekha jata hai. Agar sirf ek hi "£" wali raqam ho (rate ya amount, pata nahi) to wo **"Check the reading"** me jati hai, andaza nahi lagta.
- PDF aur Word ki har sheet par peela notice aata hai: text se bani hai, asli file se ghante milao.
- Tareekh ab "Tuesday, September 1, 2026" (mahina pehle) bhi parhi jati hai.
- Scanned PDF (typed text nahi) par saaf message: scan ya photo baad ke phase me.
- Naya format naam **Word** (`timesheet_sheets.format` me "word"). **Database me koi SQL nahi.**
- **Naye packages:** `pdfjs-dist` (4.10.38) aur `jszip`. **Deploy se pehle `npm install` chalao** aur `package.json` aur `package-lock.json` dono commit karo.
- Hadein: ek PDF ya Word me ek hi banda. Standard template ki tarteeb (Sr No, Date, Site, Start, End, Hours, Rate, Amount, Expense). Site ka lamba naam PDF me do lines me toot jaye to site ka naam adhoora aa sakta hai (tareekh aur ghante par asar nahi).
- Asli typed PDF sample par test: 21 rows, 243 ghante, aur sheet ka apna total (326.5) alag parha gaya, jo compare me mismatch ban kar flag hota hai.
- Files: `lib/timesheets/textRows.ts`, `readPdf.ts`, `readWord.ts`, aur `parseFile.ts` me nayi branches.

### Tasks (asli backend)
`/tasks` ab asli database par hai (sample data aur "preview / See it as" hata diya).

- Naya permission module **Tasks** (Users screen me tick hota hai): user sirf **apne** tasks dekhta hai, apne liye task banata hai, Start / Mark done karta hai. **Admin** sab ke tasks dekhta hai, kisi ko bhi assign karta hai, **Verify**, **Send back** aur **Delete** sirf admin.
- Status badalne ke rules server par check hote hain (`lib/tasks/rules.ts`); do log ek saath click karein to purani click reject.
- Har task ki history alag table me, aur activity log me entry. Search, filter aur paging server par.
- Naye tables: `tasks`, `task_events` (`schema/tasks-migration.sql`).

**DB par ye SQL chalani hai (code deploy se PEHLE):** `schema/tasks-migration.sql`
**Deploy ke baad:** Users screen me jis user ko Tasks dikhana ho, uske liye Tasks ka View (aur Create) tick karo.

### Payslips (asli backend)
`/payslips` ab Payroll sheet ki asli lines se banta hai (sample data aur "preview" notice hata diya). **Database me koi nayi table ya SQL nahi.**

- Company aur mahina chuno, har staff ki payslip. Search aur paging server par.
- Payslip ka total hamesha Payroll sheet ke total ke barabar (same `lineTotals`); payslip ki lines paisa-paisa isi total tak jati hain.
- **Download PDF:** browser ka print dialog khulta hai, wahan "Save as PDF". Ek payslip, tick ki hui payslips, ya poori sheet (ek bar me 1000 tak), har payslip alag page par. Koi nayi library nahi.
- Screen par NI masked, chhapi hui payslip par poora NI number.
- Dekhne ke liye **Payroll Sheet aur Staff dono ka View** chahiye (kyunke NI nazar aata hai). Menu "Payroll" permission se dikhta hai.
- Agar Payroll sheet abhi verified/closed nahi to peela notice aata hai.

### Invoice Drafts (asli backend)
`/invoice-drafts` ab Salary Sheet ki asli shifts se banta hai (sample data aur "preview" notice hata diya).

- Mahine ke `salary_shifts` ko shift export ke **client naam** se group karte hain. Har naam **ek** client se milta hai (client ka name, company ya account reference, ya wo link jo aap ek bar khud lagayen). Jo naam kisi se na mile ya do clients se mile, wo **kabhi andaze se nahi jorta**: upar list me aata hai, "Link to a client" dabao, aur wo link har mahine yaad rehta hai.
- Rate: client ki rate; na ho to us mahine ki Hours entry ki rate. Payroll hours aur payroll rate: us mahine ki **Hours screen entry** se.
- Paisa wohi formula hai jo asli invoice screen ka hai (`hoursInvoiceAmount`, `vatAmount`). Payroll wale hisse par VAT nahi lagta (VAT basis "remaining", `vatPaidBefore` = payroll value), bilkul jaise invoice screen ka payroll split.
- **Hard masle** (invoice ban hi nahi sakta): rate nahi, ghante 0, payroll hours par payroll rate nahi, payroll hours shift hours se zyada. **Soft masle** (dekh kar "create anyway" tick karne par ban sakta hai): Hours screen se farq, exact duplicate shifts, mahine se bahar ki tareekh, client active nahi.
- Create: server sab kuch database se dobara hisab karta hai, browser sirf batata hai kaun sa client. Double click ya do log ek saath: `invoice_draft_runs` ki primary key doosri bar rok deti hai. Invoice number invoice screen wali `suggestNextInvoiceNumber` se (company prefix ke saath). Hours entry us invoice se juda ho jati hai. Activity log me entry.
- "Already invoiced": us client + mahine ka invoice (month wala), draft se bana invoice, ya Hours entry se juda invoice. **Dhyan:** purane invoices jo invoice screen se bane unme `month` khali hota hai, to wo "already invoiced" nahi pakre jate. Naye (draft se bane) pakre jate hain.
- Dekhne ke liye **Invoices aur Salary Sheet dono ka View**; banane aur naam link karne ke liye Invoices ka Create. Menu "Invoices" permission se dikhta hai.
- Naye tables: `invoice_draft_aliases`, `invoice_draft_runs`, aur `salary_shifts` par ek index (`schema/invoice-drafts-migration.sql`, dobara chalane par bhi safe).
- Description "Security services, <Month Year>" lagti hai; Invoices screen se badal sakte hain. End client khali rehta hai.

**DB par ye SQL chalani hai (code deploy se PEHLE):** `schema/invoice-drafts-migration.sql`

### Follow-ups (asli backend)
`/follow-ups` ab asli overdue invoices aur saved contact history par chalta hai (sample data aur "preview" notice hata diya).

- Overdue ka hisaab **bilkul Statements screen jaisa**: `buildInvoiceViews` (payments, credit notes, VAT) phir `applyClientCredit` (pichli overpayment aage), aur sirf wo invoices jo due date guzar chuke. Isliye dono screens ka overdue hamesha barabar. "Aaj" ki tareekh UK ke hisaab se.
- Naya permission module **Overdue Follow-ups** (View, Create). Dekhne ke liye Follow-ups View **aur** Invoices View chahiye (amounts nazar aate hain). Chase likhne ke liye Follow-ups Create.
- Har chase (tareeqa, kya hua, kisne) `follow_up_contacts` me; client ki halat (agla follow-up, promised date) `follow_up_state` me. **Promised date khali chhodo to promise hat jata hai.** Promise ki tareekh guzar jaye aur paisa abhi bhi overdue ho to "Missed" nazar aata hai.
- Search, filter (due, promised, never chased) aur paging server par. Activity log me har chase ki entry.
- **Statement download:** Statements screen ki Excel/print hi use hoti hai. Follow-ups ka statement button us client ko Statements screen par khol deta hai (`/statements?client=...`). "Download all statements" button hata diya, kyunke Statements ka hisaab (credit notes, end client) dobara likhna risky tha. Statements screen me 2 line ka badlav: `?client=` padhna.
- Naye tables: `follow_up_contacts`, `follow_up_state` (`schema/follow-ups-migration.sql`).

**DB par ye SQL chalani hai (code deploy se PEHLE):** `schema/follow-ups-migration.sql`
**Deploy ke baad:** Users screen me jis user ko Follow-ups dikhana ho, uske liye Overdue Follow-ups ka View (aur Create) tick karo, aur Invoices ka View.

### Bank Match (asli backend)
`/bank-match` ab asli bank statement (CSV ya Excel .xlsx) aur asli open invoices par chalta hai (sample data aur "preview" notice hata diya). **Format abhi andaze se UK banks jaisa banaya hai, asli statement ka sample nahi mila.** Asli file aate hi pehle usay upload karke dekhna; agar columns ke naam alag hue to `src/lib/bankMatch/parse.ts` me header ke naam badhana asaan hai.

- **Padhna:** browser file padhta hai (`parseBankFile`), chhota result server ko jata hai. Header row naam se dhoondi jati hai: Date, description/reference/details, aur Paid in / Credit ya ek signed Amount column. Sirf **paisa aane wali** lines rakhi jati hain. Tareekh UK tareeqe se (din pehle). **Agar kisi paisay wali row ki tareekh ya amount na parhi jaye to poori file reject** hoti hai (row number ke saath), taake koi payment chupke se na girey.
- **Dobara upload:** same file (content) dobara nahi jati. Do statements ki overlap wali lines dobara nahi aati (`dedupe_key`). Aik hi din, aik hi amount aur aik hi text ki do alag lines dono rehti hain.
- **Matching** (server par, har baar taaza open invoices se): invoice number bank text me, ya client ka naam. **Matched** tab hi hota hai jab sirf **ek** invoice fit ho aur amount bilkul barabar ho. Baqi sab **Needs a look** ya **No match**. Short reference (jaise "0139") sirf tab maana jata hai jab client ka naam bhi mile. Ahmed jab haath se invoice chunta hai to "ye bank naam = ye client" yaad ho jata hai (`bank_payer_links`).
- **Confirm:** server database se invoice ka outstanding dobara nikalta hai (wohi `buildInvoiceViews`). **Payment outstanding se zyada nahi ho sakti.** Line ek UPDATE se claim hoti hai, isliye double click ya do log ek saath karein to sirf ek payment banti hai. Payment "Bank Transfer" method, bank wali tareekh, bank text reference me, aur activity log me entry. Do alag lines ek hi waqt aik invoice par aayen aur milkar zyada ho jayen to server baad me check karke aakhri payment wapas le leta hai.
- **Pehle se record ki hui payment:** agar usi invoice par usi amount ki payment hafte ke andar pehle se Payments me hai, line **Needs a look** me jati hai aur "record anyway" tick karna padta hai. Isse wohi paisa do baar record hone se bachta hai.
- **Confirm all matched:** server har line ka match dobara nikalta hai aur sirf wahi banata hai jo ab bhi pakka match hain; baqi chhor deta hai aur batata hai.
- **Undo:** Recorded line par Undo payment ko hata deta hai (soft delete, Recycle Bin wali tarah) aur line wapas waiting me. Ye **Payments delete** permission mangta hai. Ignore ka Undo sirf Payments create.
- **Upload delete:** jis upload ki koi payment record ho chuki ho wo delete nahi hoti (pehle Undo karo).
- **Permissions:** koi naya module nahi. Dekhne ke liye **Payments View aur Invoices View**; upload, confirm, ignore, upload delete ke liye **Payments Create**; Undo (recorded) ke liye **Payments Delete**. Menu "Payments" permission se.
- Naye tables: `bank_statements`, `bank_lines`, `bank_payer_links` (`schema/bank-match-migration.sql`, dobara chalane par bhi safe, koi purani table nahi chhoo'ti). `drizzle/schema.ts` me badlav nahi, kyunke ye tables seedhi SQL se use hoti hain.
- Samples: `samples/` me do jhoote UK statements (Lloyds jaisa aur Starling jaisa). Unke client naam aur amounts apne test invoices se milane hon to CSV me badal lo.

**DB par ye SQL chalani hai (code deploy se PEHLE):** `schema/bank-match-migration.sql`

### Owner Overview (asli backend)
`/owner` ab asli invoices, payments, credit notes aur Salary Sheet ki shifts par chalta hai (sample data aur "preview" notice hata diya). **Database me koi nayi table ya SQL nahi.** Sirf **admin** dekh sakta hai (menu me bhi, aur server par `requireAdmin`), kyunke isme har client par staff ka kharcha nazar aata hai.

- **Billed (ex VAT):** invoices ki amount ex VAT, minus issued/applied credit notes. **Mahine** ke liye invoice ka **Month** (service month) dekha jata hai; jis invoice me Month khali ho (purane invoice screen wale) wo apni invoice date ke mahine me gina jata hai, aur screen par note aata hai. **Hafte** ke liye invoice ki date dekhi jati hai.
- **Staff cost:** us muddat ki shifts ka pay (`salary_shifts.amount`; expenses/penalty tab hi jo `INCLUDE_EXPENSES_AND_PENALTY` on ho, abhi off). Shift ka client naam **bilkul Invoice Drafts wale tareeqe** se ek client se milta hai (name, company, account reference, ya saved link). Jo naam kisi se na mile ya do clients se mile wo **"Not linked to a client"** row me aata hai (total me shamil, chhupta nahi), aur wahan "Link names" Invoice Drafts kholta hai. Employer NI, pension aur dusre kharche **shamil nahi**.
- **Margin sirf mahine ka.** Invoice mahine me ek bar banta hai, to hafte ka margin gumrah karta hai. Hafte me Billed, Received aur Staff cost dikhte hain. Jis client ka mahine me kharcha hai lekin invoice nahi banaya, uski row "Not billed yet" dikhati hai (-100% nahi). Chalte mahine ka margin tab tak kam dikhega jab tak invoice na bane (screen par "not over yet" likha aata hai).
- **Received:** muddat me record hui payments (cash, VAT samet).
- **Outstanding / overdue / ageing:** abhi ka haal, **bilkul Statements, Dashboard aur Follow-ups jaisa** (`buildInvoiceViews` phir `applyClientCredit`, overdue = due date guzar chuki). Isliye teeno screens ka overdue hamesha barabar. Ye muddat (hafte/mahine) se nahi badalta.
- **6 mahine ka chart:** billed service month ke hisaab se, received payment ke mahine ke hisaab se. Jis mahine credit notes invoices se zyada hon wahan billed minus me aa sakta hai (chart me bar nahi banta).
- **Data ke notes:** peela notice batata hai agar kuch invoices ka Month khali hai, kuch naam link nahi, ya Salary Sheet ki koi shift bina tareekh ke hai (uska kharcha numbers me nahi aata).
- **Download summary:** Excel (Summary, By client, Still to collect, Last 6 months), screen ke numbers se hi banta hai.
- Hafta Monday se Sunday, tareekh UK ke hisaab se. "This week" aaj tak, "This month" aaj tak.
- Ye screen saari invoices, payments, credit notes aur clients ek saath load karti hai (Statements / Bank Match jaisa). Data bohat bada ho jaye to sust ho sakti hai.

**DB par koi SQL nahi chalani.** **Deploy ke baad:** `LOW_MARGIN` (15%) owner se confirm karna.

### Naye screens (route aur files ki list; sab ab asli data par)
| Menu | Route | Files | Kya karta hai |
|---|---|---|---|
| Timesheet Check | `/timesheets` | `routes/timesheets.index.tsx`, `lib/timesheets/`, `components/app/timesheets/` | Staff ki bheji hui sheet ko apne record se milana, galat rows dikhana, **Excel receipt/report download** |
| Tasks | `/tasks` | `routes/tasks.index.tsx`, `lib/tasks/`, `components/app/tasks/` | Admin task de ya apne liye likhe (text khud likhna), status: To do, In progress, Done, Verified, activity history |
| Payslips | `/payslips` | `routes/payslips.index.tsx`, `lib/payslips/`, `components/app/payslips/` | Har staff ki payslip, preview aur download (Payroll sheet ke hisaab se) |
| Invoice Drafts | `/invoice-drafts` | `routes/invoice-drafts.index.tsx`, `lib/invoiceDrafts/`, `components/app/invoiceDrafts/` | Mahine ki shifts se invoice ka draft, check karke banana |
| Bank Match | `/bank-match` | `routes/bank-match.index.tsx`, `lib/bankMatch/`, `components/app/bankMatch/` | Bank statement ki payments ko invoices se milana (ab asli, upar dekho) |
| Follow-ups | `/follow-ups` | `routes/follow-ups.index.tsx`, `lib/followUps/`, `components/app/followUps/` | Overdue clients, har chase ka record, promise to pay (email ke baghair) |
| Owner Overview | `/owner` | `routes/owner.index.tsx`, `lib/owner/`, `components/app/owner/` | Kis client se kitna margin, kitna outstanding, hafte ki summary, 6 mahine ka billed/received (ab asli, upar dekho) |

### Build ki ghaltian jo theek ho gayin
- `src/lib/payroll/reportExport.ts` aur `src/lib/ledger/statementExcel.ts` me ghalat file paste hone se Vercel build toota tha. Dono ab sahi hain.
- `statementExcel.ts` dobara bani hai (Statements page ke call ke hisaab se), agar asli version git me hai to wohi behtar hai.

## Dark redesign (client ki image wali)

Ye tumhari project me **pehle se lag chuka hai**: dark emerald theme, glass wale cards, naya sidebar aur top bar, Welcome banner, 4 KPI cards (sparkline aur pichle mahine se farq asli data se), Total Clients / Paid / Pending ke cards, Receivables Overview chart (6M, 12M, YTD), Invoice Status ka donut, Quick Actions, Recent Activity aur Top Clients.

Teen cheezein image se hubahu li gayi hain lekin **asli nahi hain**, client se poochna hai ke rakhni hain ya nahi:
| Cheez | Kahan | Masla | Meri raye |
|---|---|---|---|
| "All systems operational" | `routes/index.tsx` (Welcome banner) | Hamesha yehi likha aata hai, kuch check nahi karta | Hata do, ya "Updated hh:mm" jaisi sachi cheez lagao |
| "v2.4.0" | `components/app/AppShell.tsx` (sidebar ke neeche) | Hard-coded version | `package.json` ke version se jodo, ya hata do |
| "Streamline your receivables / Learn more" | `routes/index.tsx` (right side ka neeche wala card) | Ishtihaar jaisa, kahin jata nahi | Hata do (ye client ki apni internal app hai) |

## Baqi: UI

Koi screen baqi nahi. Sab UI ho chuki.

## Baqi: Backend (UI ke baad)

### Buniyad (Phase 0)
- Staff match **NI number** se (naam par nahi), NI na ho to staff ID. Naam par match hamesha review me jaye.
- Bade data par tezi: page wise loading, server par search, database indexes.
- Bari files ke kaam chhote hisson (batches) me, har ek ka status.
- Audit log, backups (Neon restore), **10,000 staff ka load test**.

### Timesheet Check (asli kaam)
- **Phase B:** ho chuka (upar "Ho chuka" me dekho). Baqi: asli staff/shifts par test, mahina lock.
- **Phase C:** ho chuka (typed PDF aur Word, upar "Ho chuka" me dekho). Asli guards ki PDF/Word par test baqi.
- **Phase D:** tasveer / WhatsApp / scan wali sheet **AI vision** se padhna, review screen zaroori. AI sirf parhega, hisaab aur faisla normal code karega.
- Mahina lock (total check aur duplicate pakadna Phase B me ho chuka).
- Parallel run: 1 se 2 mahine system aur haath ka kaam saath, phir bharosa.

### Baqi screens ko asli data se jorna
Koi screen baqi nahi. Sab asli data par hain.

Har naye screen par jorte waqt (purani hidayat): "Preview" wala notice hatao, `RequireView module="dashboard"` aur admin-only check ki jagah asli permission module lagao (`lib/permissions.ts` aur Users screen me), aur menu me `module: null` ki jagah wo module.

## Kholay hue sawal (client / tumhare faislay)

1. Timesheet me **15 minute ke farq** ko match maanein ya farq dikhayein? (Abhi 0 minute strict, `rules.ts` me badalna asaan hai.)
2. Redesign **sirf dark** ya light/dark switch bhi?
3. Payslip par **tax / NI ki katautiyan** chahiye ya sirf kamai?
4. Receipt **Excel** me theek hai ya **PDF** chahiye?
5. Bank statement ka **format**: abhi UK banks ke andaze par bana hai (CSV ya xlsx). Asli sample milte hi check karna.
6. Task ke 4 status theek hain (To do, In progress, Done waiting for check, Verified)?
7. Owner Overview me **kam margin** ki hadd kitni ho (abhi 15% rakhi hai, 8% se neeche "bohat kam", `lib/owner/data.ts` me)? Staff cost me employer NI / pension chahiye? (abhi nahi)
8. Redesign ki 3 nakli cheezein (upar table) hataani hain ya rakhni hain?
9. Guards ke liye **standard timesheet template**: upar Name aur NI number ka box, phir Date, Site, Start, End, Hours, Rate, Amount (break time chahiye ya nahi?).

## Aaj ki halat ek nazar me

- UI: 7 naye screens ban chuke aur dark redesign pehle se lag chuka hai. **UI ka kaam poora.**
- Backend: **Timesheet Check asli data se juda hai (Phase B aur C: Excel, CSV, typed PDF, Word)**. Tasks, Payslips, Invoice Drafts, Follow-ups, Bank Match aur Owner Overview bhi asli. **Koi screen sample data par nahi rahi.**


## Step 1 completed: pre-AI operational fixes (12 Oct 2026)

- Dashboard greeting, date and live clock use Europe/London (automatic GMT/BST). Hardcoded operational-status badge removed.
- Dashboard reads actual audit activity: actor, action and record label. Admin sees all activity, others only their own. Query failures are shown.
- Tasks dashboard and Tasks page show current totals per assigned user. Task cards/table show owner, creator, completion actor and last action actor. Existing assignment, transitions, permissions and history retained.
- Reports: company, client, invoice status, overdue, invoice/client/description search and inclusive date filters; invoice detail table, credit-aware outstanding, payment ownership from invoice, statements with opening balance and issued/applied credit notes. Invalid date ranges show a message.
- Timesheet identity reader handles a combined Name/NI line and NIN labels. Admin can correct the name/NI read from the uploaded sheet and recheck, without editing Staff or shifts. Name-only matches still require confirmation; differing NI or duplicate names are not merged. Corrected identity reserves the unique person/month key before recheck.
- Existing saved sheets can be checked again from their detail page/month action. Client's actual failing sheet was not provided, so its specific cause is not yet verified.
- Bank Match accepts typed PDF tables and Word (.docx) tables in addition to existing CSV/Excel. PDF columns retain blank credit/debit cells. PDF/Word require an explicit review before upload. Existing payment matching/confirmation flow is retained.
- Bank PDFs require recognized headers on every page and a stable table layout, max 30 pages; unsupported layouts/scans fail with a message. Timesheet PDF max-page handling now rejects oversized PDFs instead of truncating them.
- No AI/OCR, no new packages, no database reset, no new SQL migration, no deployment. Existing schema migrations still need to be present in whichever test/production DB runs these modules.

### Verification

- `npm run build`: passed.
- `node --import tsx scripts/pre-ai-check.ts`: passed (fake identity/header fixtures, bank dates/amounts/PDF columns, London GMT/BST and date rollover).
- In-memory PostgreSQL matching checks: passed for formatted NI, normalized unique name, duplicate names, NI conflicts, missing identity, duplicate NI. Fake rows only; no connected DB was used.
- Actual typed PDF text extraction and Word/CSV/Excel parsing: passed with fake fixtures in Node. Existing sample timesheet Word also passed.
- Reports server-render checks: passed for company/client/search/date filters, opening balance, credit notes and invalid date ranges.
- TypeScript: baseline had 27 errors; current project has 8 pre-existing errors in ClientDialog, InvoiceDialog, letterhead, ledger store, staffTrash and root error handler. Changed modules have no type errors. These older modules were not changed.
- Authenticated browser UI/upload flow was NOT verified. Browser runtime was unavailable. Test the overlay on the user's separate test hosting before production transfer.

### Next separate step

AI photo/scanned-PDF reading with review and an AI key, then remaining business rules/load/parallel-run verification already listed in this plan. This delivery does not claim full production readiness.

## Step 2: remaining pre-AI functional work (11 Oct 2026)

This section supersedes the outstanding type errors/month-lock/browser limitations in Step 1. AI/OCR, user/admin manuals, final readiness documentation and data-security planning remain deferred by request.

- Timesheet identity: when the document has neither name nor NI, explicit timesheet filenames can suggest a person. Unique name matching still requires confirmation; ambiguous names/NI conflicts are not auto-accepted. Existing uploads recover this suggestion on Check again. The screenshot's filename pattern is covered; the actual failing workbook is not available for verification.
- Timesheet month lock/reopen added with admin actions, database write guards, incomplete/unconfirmed/duplicate-staff checks, and audit records. Rechecking marks comparisons incomplete until finished. Additive `schema/timesheet-locks-migration.sql` must run after the existing timesheets migration, on the separate test database before deploying this overlay. No connected database was changed.
- Timesheet Print / Save PDF report added for detail/month, with differences, totals and masked NI.
- Dashboard glass styling, mobile spacing, compact per-user task counts and scrollable task preview improved. Removed placeholder version/promo. Small currency chart values retain their actual amounts.
- Remaining TypeScript errors fixed. Staff, salary and payroll Excel import/export workflows were not changed.
- Verification: `npx tsc --noEmit`, `npm run build`, and `node --import tsx scripts/pre-ai-check.ts` passed. In-memory PostgreSQL migration rerun and matching/lock tests passed with 10,000 fake staff and 50,000 fake shifts. Actual headless browser document readers passed typed bank PDF, bank CSV, scan rejection and timesheet Word fixtures. Browser dashboard desktop/mobile, Reports filters, identity correction and print iframe checks passed using mocked server responses.
- Still required on separate test hosting: apply migration, authenticated end-to-end upload/recheck with actual files, and real multi-user/load/parallel-run checks. Local fixture checks do not establish production readiness. Unconfirmed client-specific business rules retain their existing defaults.
- Apply Step 2 over Step 1. Overlay contains changed/new source, SQL, regression checks and this progress record only; no environment files or dependencies.
