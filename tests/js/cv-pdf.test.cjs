const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

globalThis.window ??= globalThis; // the UMD bundles probe for window
const V = path.join(__dirname, "../../extension/vendor");
const PDFLib = require(path.join(V, "pdf-lib.min.js"));
const fontkit = require(path.join(V, "fontkit.umd.min.js"));
const { buildCvPdf, wrapText, sanitize, fitText, registerFont } = require("../../extension/lib/cv-pdf.js");
const { normalizeProfile } = require("../../extension/lib/profile.js");

const deps = {
  PDFLib, fontkit,
  fonts: { regular: fs.readFileSync(path.join(V, "fonts/Lato-Regular.ttf")), bold: fs.readFileSync(path.join(V, "fonts/Lato-Bold.ttf")) },
};

const base = normalizeProfile({
  basics: { firstName: "Asha", lastName: "Verma", email: "asha@example.com", phone: "+91 98765 43210",
    location: "Bengaluru", linkedin: "linkedin.com/in/asha", headline: "Platform Engineer",
    summary: "Platform engineer who cut AWS spend by ₹1.2 Cr/yr — café-grade “reliability”." },
  experience: [{ company: "Acme Corp", title: "Senior DevOps Engineer", location: "Bengaluru", start: "Jan 2021", end: "Present",
    bullets: ["Ran Kubernetes for 40 services", "Cut AWS spend 32% via rightsizing"] }],
  education: [{ institution: "NIT Calicut", degree: "B.Tech", field: "CSE", start: "2012", end: "2016", grade: "" }],
  skills: [{ group: "Cloud", items: ["AWS", "Kubernetes", "Terraform"] }],
  projects: [{ name: "JobPilot", description: "Job-application co-pilot", bullets: [], link: "github.com/kiraa06/jobpilot" }],
  certifications: [{ name: "CKA", issuer: "CNCF", date: "2022" }],
});

const UNSUPPORTED = "\u{10FFFD}";

function longProfile(roles) {
  const p = structuredClone(base);
  p.experience = Array.from({ length: roles }, (_, i) => ({
    company: `Company ${i}`, title: "Engineer", location: "", start: `${2010 + i}`, end: `${2011 + i}`,
    bullets: Array.from({ length: 9 }, (_, j) => `Delivered meaningful outcome number ${j} with a fairly long description that wraps onto a second line of text`),
  }));
  return p;
}

// An embedded pdf-lib font registered with its fontkit twin, as render() does.
async function embedded() {
  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(deps.fonts.regular);
  registerFont(font, fontkit.create(deps.fonts.regular));
  return font;
}

test("normal profile builds one page, no overflow, input untouched", async () => {
  const before = JSON.stringify(base);
  const out = await buildCvPdf(base, deps);
  assert.equal(Buffer.from(out.bytes.slice(0, 4)).toString(), "%PDF");
  assert.equal(out.pages, 1);
  assert.equal(out.overflow, false);
  assert.deepEqual(out.trimmed, []);
  assert.equal(JSON.stringify(base), before);
});

test("sanitize strips emoji, keeps symbols and curly quotes", async () => {
  assert.equal(sanitize("Ships fast 🚀 — ₹, é, “quotes”, → ✓ ★"), "Ships fast — ₹, é, “quotes”, → ✓ ★");
  assert.equal(sanitize("🚀"), "");
  const p = structuredClone(base);
  p.basics.summary = "Ships fast 🚀 — ₹, é, “quotes”, → arrows ✓ ★";
  assert.equal((await buildCvPdf(p, deps)).pages, 1);
});

test("glyphs the font lacks are dropped and never throw", async () => {
  const fk = fontkit.create(deps.fonts.regular);
  assert.equal(fk.hasGlyphForCodePoint(0x10FFFD), false, "precondition: Lato lacks U+10FFFD");
  const p = structuredClone(base);
  p.basics.summary += ` summary${UNSUPPORTED}`;
  p.experience[0].bullets.push(`bullet${UNSUPPORTED}`);
  p.experience[0].title += UNSUPPORTED;
  p.projects[0].link = `github.com/x${UNSUPPORTED}/y`;
  const out = await buildCvPdf(p, deps);
  assert.equal(out.pages, 1);
  const font = await embedded();
  const lines = wrapText(`alpha ${UNSUPPORTED} beta${UNSUPPORTED}gamma`, font, 10, 200);
  assert.ok(lines.length > 0);
  assert.ok(!lines.join("").includes(UNSUPPORTED));
});

test("wrapText respects width and hard-breaks long words", async () => {
  const font = await embedded();
  const lines = wrapText("alpha beta gamma delta " + "x".repeat(200), font, 10, 120);
  assert.ok(lines.length > 3);
  for (const l of lines) assert.ok(font.widthOfTextAtSize(l, 10) <= 120.01, l);
});

test("fitText truncates with an ellipsis within maxWidth", async () => {
  const font = await embedded();
  const fitted = fitText("A very long job title ".repeat(20), font, 10.5, 300);
  assert.ok(font.widthOfTextAtSize(fitted, 10.5) <= 300);
  assert.ok(fitted.endsWith("…"));
});

test("14 long roles are trimmed to <= 2 pages, input untouched", async () => {
  const p = longProfile(14);
  const out = await buildCvPdf(p, deps);
  assert.ok(out.pages <= 2, `got ${out.pages} pages`);
  assert.equal(out.overflow, false);
  assert.ok(out.trimmed.length > 0);
  assert.equal(p.experience[13].bullets.length, 9, "input profile must not be mutated");
});

test("maxPages: 1 on a long profile reports overflow with trim notes", async () => {
  // 14 roles still trim down to one page, so use 40 to force an overflow.
  const out = await buildCvPdf(longProfile(40), deps, { maxPages: 1 });
  assert.equal(out.overflow, true);
  assert.ok(out.pages > 1);
  assert.ok(out.trimmed.length > 0);
});
