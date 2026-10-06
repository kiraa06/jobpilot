const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

globalThis.window ??= globalThis; // the UMD bundles probe for window
const V = path.join(__dirname, "../../extension/vendor");
const PDFLib = require(path.join(V, "pdf-lib.min.js"));
const fontkit = require(path.join(V, "fontkit.umd.min.js"));
const { buildCvPdf, wrapText, sanitize, fitText } = require("../../extension/lib/cv-pdf.js");
const { normalizeProfile } = require("../../extension/lib/profile.js");

const deps = {
  PDFLib, fontkit,
  fonts: { regular: fs.readFileSync(path.join(V, "fonts/Lato-Regular.ttf")), bold: fs.readFileSync(path.join(V, "fonts/Lato-Bold.ttf")) },
};

const base = normalizeProfile({
  basics: { firstName: "Asha", lastName: "Verma", email: "asha@example.com", phone: "+91 98765 43210",
    location: "Bengaluru", linkedin: "linkedin.com/in/asha", headline: "Platform Engineer",
    summary: 'Platform engineer who cut AWS spend by ₹1.2 Cr/yr — café-grade "reliability".' },
  experience: [{ company: "Acme Corp", title: "Senior DevOps Engineer", location: "Bengaluru", start: "Jan 2021", end: "Present",
    bullets: ["Ran Kubernetes for 40 services", "Cut AWS spend 32% via rightsizing"] }],
  education: [{ institution: "NIT Calicut", degree: "B.Tech", field: "CSE", start: "2012", end: "2016", grade: "" }],
  skills: [{ group: "Cloud", items: ["AWS", "Kubernetes", "Terraform"] }],
  projects: [{ name: "JobPilot", description: "Job-application co-pilot", bullets: [], link: "github.com/kiraa06/jobpilot" }],
  certifications: [{ name: "CKA", issuer: "CNCF", date: "2022" }],
});

test("builds a one-page PDF for a normal profile", async () => {
  const out = await buildCvPdf(base, deps);
  assert.equal(Buffer.from(out.bytes.slice(0, 4)).toString(), "%PDF");
  assert.equal(out.pages, 1);
  assert.deepEqual(out.trimmed, []);
});

test("unicode renders and emoji are stripped", async () => {
  const p = structuredClone(base);
  p.basics.summary = 'Ships fast 🚀 — ₹, é, "quotes", → arrows ✓';
  assert.equal(sanitize(p.basics.summary), 'Ships fast — ₹, é, "quotes", → arrows ✓');
  assert.ok(sanitize("✓★").includes("✓"), "sanitize keeps ✓");
  assert.ok(sanitize("✓★").includes("★"), "sanitize keeps ★");
  assert.equal(sanitize("🚀"), "", "sanitize strips emoji");
  const out = await buildCvPdf(p, deps);
  assert.equal(out.pages, 1);
});

test("long profile is trimmed to two pages", async () => {
  const p = structuredClone(base);
  p.experience = Array.from({ length: 9 }, (_, i) => ({
    company: `Company ${i}`, title: "Engineer", location: "", start: `${2010 + i}`, end: `${2011 + i}`,
    bullets: Array.from({ length: 9 }, (_, j) => `Delivered meaningful outcome number ${j} with a fairly long description that wraps onto a second line of text`),
  }));
  const out = await buildCvPdf(p, deps);
  assert.ok(out.pages <= 2, `got ${out.pages} pages`);
  assert.ok(out.trimmed.length > 0);
  assert.equal(p.experience[8].bullets.length, 9, "input profile must not be mutated");
});

test("wrapText respects width and hard-breaks long words", async () => {
  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(deps.fonts.regular);
  const lines = wrapText("alpha beta gamma delta " + "x".repeat(200), font, 10, 120);
  assert.ok(lines.length > 3);
  for (const l of lines) assert.ok(font.widthOfTextAtSize(l, 10) <= 120.01, l);
});

test("long profile (14 roles) builds in < 5000ms with pages ≤ 2", async () => {
  const p = structuredClone(base);
  p.experience = Array.from({ length: 14 }, (_, i) => ({
    company: `Company ${i}`, title: "Engineer", location: "", start: `${2010 + i}`, end: `${2011 + i}`,
    bullets: Array.from({ length: 9 }, (_, j) => `Delivered meaningful outcome number ${j} with a fairly long description that wraps onto a second line of text`),
  }));
  const start = Date.now();
  const out = await buildCvPdf(p, deps);
  const elapsed = Date.now() - start;
  assert.ok(out.pages <= 2, `got ${out.pages} pages`);
  assert.ok(elapsed < 5000, `took ${elapsed}ms`);
});

test("fitText truncates long text with ellipsis", async () => {
  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(deps.fonts.regular);
  const longTitle = "A".repeat(200);
  const fitted = fitText(longTitle, font, 10, 300);
  assert.ok(fitted.endsWith("…"), "fitText ends with ellipsis");
  assert.ok(font.widthOfTextAtSize(fitted, 10) <= 300, "fitText respects maxWidth");
});

test("overflow flag indicates when content exceeds maxPages", async () => {
  const out1 = await buildCvPdf(base, deps, { maxPages: 2 });
  assert.equal(out1.overflow, false, "normal profile fits in maxPages");

  const p = structuredClone(base);
  p.experience = Array.from({ length: 14 }, (_, i) => ({
    company: `Company ${i}`, title: "Engineer", location: "", start: `${2010 + i}`, end: `${2011 + i}`,
    bullets: Array.from({ length: 9 }, (_, j) => `Delivered meaningful outcome number ${j} with a fairly long description that wraps onto a second line of text`),
  }));
  const out2 = await buildCvPdf(p, deps, { maxPages: 2 });
  assert.equal(out2.pages <= 2, true, "long profile trimmed to fit in maxPages");
});
