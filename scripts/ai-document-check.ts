/** Fake documents and mocked provider only. Run: node --import tsx scripts/ai-document-check.ts */
import assert from "node:assert/strict";
import { reviewedDocument, validateExtraction, type Extraction } from "../src/lib/ai/document";
import { aiConfiguration, extractDocument } from "../src/lib/server/aiDocuments";
const bank: Extraction = {
  complete: true,
  personName: "",
  personNi: "",
  statedHours: "",
  notes: [],
  rows: [
    ["2026-09-01", "Fake customer", "100", ""],
    ["2026-09-02", "Fake expense", "", "25"],
  ],
};
const reviewed = reviewedDocument("bank", bank, "fake.jpg", "fakehash");
assert.equal(reviewed.kind, "bank");
if (reviewed.kind === "bank") {
  assert.equal(reviewed.parsed.lines.length, 1);
  assert.equal(reviewed.parsed.skippedOut, 1);
}
for (const row of [
  ["bad", "Fake", "", "25"],
  ["2026-09-01", "Fake", "10", "20"],
  ["2026-09-01", "Fake", "?", ""],
  ["2026-09-01", "Fake", "", ""],
])
  assert.throws(() => reviewedDocument("bank", { ...bank, rows: [row] }, "fake.jpg", "hash"));
const ts: Extraction = {
  ...bank,
  personName: "Fake Worker",
  statedHours: "9",
  rows: [["2026-09-01", "Fake site", "09:00", "17:00", "8", "10", "80", ""]],
};
const sheet = reviewedDocument("timesheet", ts, "fake.pdf", "hash");
if (sheet.kind === "timesheet") {
  assert.equal(sheet.parsed.sheets[0]?.rows[0]?.hours, 8);
  assert.equal(sheet.parsed.sheets[0]?.statedHours, 9);
  assert.equal(sheet.parsed.sheets[0]?.format, "pdf");
}
assert.throws(() => validateExtraction({ ...bank, complete: false }, "bank"));
assert.throws(() => validateExtraction({ ...bank, rows: [["wrong"]] }, "bank"));
const previous = {
  key: process.env["GEMINI_API_KEY"],
  model: process.env["GEMINI_DOCUMENT_MODEL"],
  mode: process.env["AI_DOCUMENT_MODE"],
};
try {
  delete process.env["GEMINI_API_KEY"];
  assert.throws(aiConfiguration, /not enabled/);
  process.env["GEMINI_API_KEY"] = "fake-key";
  process.env["GEMINI_DOCUMENT_MODEL"] = "gemini-test";
  process.env["AI_DOCUMENT_MODE"] = "paid";
  const pages = [{ mimeType: "image/jpeg", data: "/9j/AA==" }];
  const fake = async (_url: unknown, init: RequestInit | undefined) => {
    assert.ok(!String(_url).includes("fake-key"));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.contents[0].parts.length, 1);
    return new Response(
      JSON.stringify({
        candidates: [
          { finishReason: "STOP", content: { parts: [{ text: JSON.stringify(bank) }] } },
        ],
      }),
    );
  };
  assert.deepEqual(await extractDocument("bank", pages, fake as typeof fetch), bank);
  await assert.rejects(
    () =>
      extractDocument(
        "bank",
        pages,
        (async () => new Response("provider secret", { status: 429 })) as typeof fetch,
      ),
    /quota/,
  );
  await assert.rejects(
    () =>
      extractDocument(
        "bank",
        pages,
        (async () =>
          new Response(
            JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS" }] }),
          )) as typeof fetch,
      ),
    /complete result/,
  );
  await assert.rejects(
    () => extractDocument("bank", pages, (async () => new Response("bad-json")) as typeof fetch),
    /unreadable response/,
  );
  process.env["AI_DOCUMENT_MODE"] = "free";
  assert.throws(aiConfiguration, /not enabled/);
} finally {
  for (const [key, value] of Object.entries({
    GEMINI_API_KEY: previous.key,
    GEMINI_DOCUMENT_MODEL: previous.model,
    AI_DOCUMENT_MODE: previous.mode,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
console.log(
  "PASS: AI validation, money direction, review parsing, no auto-corrected totals, paid config gate, provider errors and truncated results. Mocked API only.",
);
