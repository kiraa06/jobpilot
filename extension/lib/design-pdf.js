(function (root) {
  // Prints a profile through a captured CV design: render tab + chrome.debugger Page.printToPDF.
  // Runs in the background service worker. Any failure throws; callers fall back to cv-pdf.js.
  const RENDER_TIMEOUT_MS = 30000;
  const JP = () => root.JobPilot;

  let queue = Promise.resolve(); // one render tab at a time
  const serialize = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

  const fail = (code, message) => Object.assign(new Error(message), { code });

  function waitForComplete(tabId) {
    return new Promise((resolve, reject) => {
      const done = (fn, v) => { chrome.tabs.onUpdated.removeListener(onUpd); chrome.tabs.onRemoved.removeListener(onRem); fn(v); };
      const onUpd = (id, info) => { if (id === tabId && info.status === "complete") done(resolve); };
      const onRem = (id) => { if (id === tabId) done(reject, fail("RENDER_FAILED", "The print tab was closed.")); };
      chrome.tabs.onUpdated.addListener(onUpd);
      chrome.tabs.onRemoved.addListener(onRem);
      chrome.tabs.get(tabId).then((t) => { if (t.status === "complete") done(resolve); }, () => {});
    });
  }

  // Checks a template is safe and keeps all of this profile's content out of its source.
  function preflight(template, profile) {
    const T = JP().template;
    const problems = T.lintTemplate(template, JP().fonts.FAMILIES);
    if (problems.length) throw fail("DESIGN_INVALID", problems.join(" "));
    const copied = T.findHardcoded(template, profile);
    if (copied.length) throw fail("DESIGN_INVALID", `The design has your CV text typed in instead of slots: ${copied.slice(0, 3).join("; ")}.`);
  }

  async function countPages(base64) {
    const doc = await root.PDFLib.PDFDocument.load(JP().util.base64ToBytes(base64), { updateMetadata: false });
    return doc.getPageCount();
  }

  // printProfile(profile) -> {base64, pages}; throws DESIGN_INCOMPLETE when content is missing.
  async function withPrinter(fn) {
    let tabId;
    let attached = false;
    const deadline = Date.now() + RENDER_TIMEOUT_MS;
    const timed = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(
      () => rej(fail("RENDER_TIMEOUT", "Printing your design took too long.")), Math.max(0, deadline - Date.now())))]);
    try {
      const tab = await chrome.tabs.create({ url: chrome.runtime.getURL("render/render.html"), active: false });
      tabId = tab.id;
      await timed(waitForComplete(tabId));
      const target = { tabId };
      try {
        await timed(chrome.debugger.attach(target, "1.3"));
      } catch (e) {
        throw fail("PRINTER_BLOCKED", `The browser wouldn't let JobPilot print the PDF (${e.message || e}).`);
      }
      attached = true;
      const send = (method, params) => timed(chrome.debugger.sendCommand(target, method, params));
      const print = async (html, title) => {
        const r = await send("Runtime.evaluate", {
          expression: `__jobpilotRender(${JSON.stringify(html)}, ${JSON.stringify(title)})`,
          awaitPromise: true, returnByValue: true,
        });
        if (r.exceptionDetails) throw fail("RENDER_FAILED", r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        const { data } = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
        return { text: r.result.value.text, base64: data };
      };
      return await fn(print);
    } finally {
      if (attached) await chrome.debugger.detach({ tabId }).catch(() => {});
      if (tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => {});
    }
  }

  // -> {base64, pages, trimmed[], overflow}. maxPages = Infinity disables trimming (previews).
  function renderDesignPdf(template, profile, { maxPages = 2 } = {}) {
    return serialize(() => withPrinter(async (print) => {
      const T = JP().template;
      const trimOnce = JP().cvPdf.trimOnce;
      preflight(template, profile);
      const name = T.viewModel(profile).name;
      const attempt = async (p) => {
        const out = await print(T.renderTemplate(template, T.viewModel(p)), name ? `${name} — CV` : "CV");
        const missing = T.checkCompleteness(p, out.text);
        if (missing.length) {
          throw fail("DESIGN_INCOMPLETE", `The design leaves out ${missing.length} item(s), e.g. ${missing.slice(0, 3).join("; ")}.`);
        }
        return { base64: out.base64, pages: await countPages(out.base64) };
      };
      const trimmedBy = (k) => {
        const p = structuredClone(profile);
        const notes = [];
        for (let i = 0; i < k; i++) notes.push(trimOnce(p));
        return { p, notes: [...new Set(notes)] };
      };
      const result = (r, notes) => ({ ...r, trimmed: notes, overflow: r.pages > maxPages });

      const first = await attempt(structuredClone(profile));
      if (first.pages <= maxPages) return result(first, []);
      let K = 0;
      const probe = structuredClone(profile);
      while (trimOnce(probe)) K++;
      let lo = 1, hi = K, best = null;
      while (lo <= hi) { // smallest k whose render fits (page count is monotone in k)
        const mid = (lo + hi) >> 1;
        const { p, notes } = trimmedBy(mid);
        const r = await attempt(p);
        if (r.pages <= maxPages) { best = result(r, notes); hi = mid - 1; } else lo = mid + 1;
      }
      if (best) return best;
      const { p, notes } = trimmedBy(K);
      return result(await attempt(p), notes);
    }));
  }

  const api = { renderDesignPdf, preflight };
  (root.JobPilot = root.JobPilot || {}).designPdf = api;
})(globalThis);
