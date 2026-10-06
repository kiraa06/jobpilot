(function (root) {
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  function bytesToBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function parseSessionId(raw) {
    const m = UUID_RE.exec(raw || "");
    return m ? m[0].toLowerCase() : null;
  }

  function slugify(s) {
    return String(s || "").normalize("NFKD").replace(/[^\w\s-]/g, " ").trim().split(/[\s_-]+/).filter(Boolean).join("-");
  }

  function pdfFileName(company, role, date) {
    const day = date.toISOString().slice(0, 10);
    const stem = [slugify(company), slugify(role)].filter(Boolean).join("-") || "CV";
    return `${stem}-${day}.pdf`;
  }

  const api = { bytesToBase64, base64ToBytes, parseSessionId, slugify, pdfFileName };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.JobPilot = root.JobPilot || {}).util = api;
})(globalThis);
