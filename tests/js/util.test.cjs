const test = require("node:test");
const assert = require("node:assert/strict");
const util = require("../../extension/lib/util.js");

test("base64 round trip preserves bytes", () => {
  const bytes = new Uint8Array(70000).map((_, i) => i % 256);
  assert.deepEqual(util.base64ToBytes(util.bytesToBase64(bytes)), bytes);
});

test("parseSessionId accepts commands, whitespace and uppercase", () => {
  const id = "00000000-0000-4000-8000-000000000000";
  assert.equal(util.parseSessionId(`claude --resume ${id.toUpperCase()}\n`), id);
  assert.equal(util.parseSessionId("  " + id + "  "), id);
  assert.equal(util.parseSessionId("my-session"), null);
  assert.equal(util.parseSessionId(undefined), null);
});

test("pdfFileName is filesystem-safe", () => {
  const d = new Date("2026-10-06T10:00:00Z");
  assert.equal(util.pdfFileName("Acme / Corp", "Sr. DevOps: Engineer", d), "Acme-Corp-Sr-DevOps-Engineer-2026-10-06.pdf");
  assert.equal(util.pdfFileName("", "", d), "CV-2026-10-06.pdf");
});
