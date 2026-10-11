# LedgerFlow Step 1 overlay

## Lagana kaise hai

1. ZIP apne project root par extract karo aur overwrite select karo. Isme outer project folder nahi hai.
2. `npm run build` chalao. Dependencies pehle se installed na hon to pehle `npm install`.
3. Sirf apni separate TEST hosting par deploy karke neeche wale checks karo.

Is overlay mein naye dependencies ya new SQL migrations nahi hain. Existing modules ki tables/migrations pehle se honi chahiye. Database reset nahi karna. .env, credentials, node_modules aur full project included nahi hain.

## Is step mein kya hai

- UK greeting + live date/time with automatic GMT/BST.
- Real audit activity with user names; real task cards and per-user task totals. Tasks table mein Completed by aur Last action by.
- Reports mein company, client, date, invoice status aur search filters; invoice table aur opening/credit-note-aware client statement.
- Timesheet par Name/NI ki combined reading aur NIN labels fix. Existing staff ka match fail ho to sheet kholkar **Correct the name / NI read from this sheet** use karo, exact Staff identity enter karo, phir **Save identity and check again**. Staff record change nahi hota. Name-only match par confirmation ab bhi required hai.
- Bank Match mein typed PDF aur Word table upload + review screen. Existing CSV/Excel aur confirm-payment flow retained.

Salary, Payroll aur Staff ke existing Excel modules unchanged hain. Photo/scanned-PDF AI reading next separate step hai.

## Test hosting par check

1. Dashboard UK clock ko UK time se compare karo; real task create/complete/verify karke owner aur action user dekho. Admin aur regular user dono test karo.
2. Tasks page par user-wise counts aur completion/history users check karo.
3. Client ki failing sheet upload/open karo. Original name/NI aur sheet par read hui identity compare karo; correction/recheck use karo. Actual failing sheet yahan available nahi thi, isliye us specific case ka cause abhi confirm nahi.
4. Duplicate name aur different NI ko galat staff se auto-match nahi hona chahiye. Name-only match review mein rahe.
5. Reports ke company/client/status/search/date filters aur opening balance test karo. Report invoice totals use invoice dates; payment history uses payment dates. Statement includes prior opening balance and issued/applied credit notes.
6. Bank typed PDF/Word table upload karo: review screen ki har date/amount, row count aur total original se milao. Confirm ke baad Bank Match lines appear hon; invoices par payment tabhi record ho jab existing matching confirmation ki jaye.
7. Bank photos/scans aur unsupported PDF layouts refuse hon. PDF bank table ko every page par recognized headers chahiye. Blank credit/debit cells preserve hote hain; arbitrary bank formats supported hone ka claim nahi.

## Verification ka sach

Build aur fake-data logic/document/PostgreSQL/report-render tests passed. Authenticated browser UI flow verify nahi hua. `tsc` mein 8 existing errors baqi hain, changed modules mein type errors nahi. Details plan.md mein hain. Production deploy/DB modification nahi ki gayi.

Optional quick checks: `node --import tsx scripts/pre-ai-check.ts`.
