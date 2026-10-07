const HOST = "com.kiraa06.jobpilot";
const CONTENT_FILES = ["lib/util.js", "lib/profile.js", "lib/matcher.js", "content/extract.js", "content/fill.js"];
const MIN_JD_CHARS = 200;
const CANCEL_GRACE_MS = 3000; // time the helper gets to kill claude and reply before we drop the port
const running = new Map(); // tabId -> {cancel}
const confirming = new Set(); // tabIds with a confirm in flight (claimed synchronously)

const ok = (data) => ({ ok: true, data });
const fail = (code, message) => ({ ok: false, error: { code, message } });

// One native port per request; the helper handles one request and exits.
function callHost(action, payload) {
  let port;
  let settled = false;
  let resolveFn;
  const promise = new Promise((resolve) => { resolveFn = resolve; });
  const finish = (res) => { if (!settled) { settled = true; resolveFn(res); } };
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    finish(fail("HOST_MISSING", String(e.message || e)));
    return { promise, cancel() {} };
  }
  port.onMessage.addListener((msg) => { finish(msg); port.disconnect(); });
  port.onDisconnect.addListener(() => {
    const m = chrome.runtime.lastError?.message || "The helper stopped unexpectedly.";
    finish(fail(/not found|forbidden/i.test(m) ? "HOST_MISSING" : "HOST_DISCONNECTED", m));
  });
  port.postMessage({ action, payload });
  return {
    promise,
    cancel() {
      finish(fail("CANCELLED", "Cancelled.")); // the caller is done now; the helper winds down below
      const drop = () => { try { port.disconnect(); } catch (_) { /* already gone */ } };
      try { port.postMessage({ action: "cancel" }); } catch (_) { return; }
      // Let the helper kill claude and reply (onMessage above disconnects); force it after a grace period.
      const timer = setTimeout(drop, CANCEL_GRACE_MS);
      port.onMessage.addListener(() => clearTimeout(timer));
      port.onDisconnect.addListener(() => clearTimeout(timer));
    },
  };
}

const hostOf = (url) => { try { return new URL(url).hostname; } catch (_) { return ""; } };

const session = {
  async get(key) { return (await chrome.storage.session.get(key))[key]; },
  set(key, value) { return chrome.storage.session.set({ [key]: value }); },
  remove(keys) { return chrome.storage.session.remove(keys); },
};

async function inject(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_FILES });
  } catch (e) {
    throw Object.assign(new Error(`JobPilot can't work on this page (${e.message}).`),
      { code: "RESTRICTED_PAGE" });
  }
}

async function runInFrames(tabId, fn, arg) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (name, a) => globalThis.JobPilot.content[name](a),
    args: [fn, arg],
  });
  return results.map((r) => r.result).filter(Boolean);
}

async function autofill(tabId) {
  const { profile, originalPdf } = await chrome.storage.local.get(["profile", "originalPdf"]);
  if (!profile) return fail("NO_PROFILE", "Import your CV first — open Settings.");
  const tailored = await session.get(`tailored:${tabId}`);
  const payload = tailored
    ? { profile: tailored.profile, answers: tailored.answers, pdf: tailored.pdf }
    : { profile, answers: [], pdf: originalPdf || null };
  await inject(tabId);
  const reports = await runInFrames(tabId, "autofill", payload);
  const total = { filled: 0, sensitive: 0, unmatched: 0, kept: 0, fieldCount: 0, fileFieldFound: false, fileAttached: false };
  for (const r of reports) {
    for (const k of ["filled", "sensitive", "unmatched", "kept", "fieldCount"]) total[k] += r[k];
    total.fileFieldFound ||= r.fileFieldFound;
    total.fileAttached ||= r.fileAttached;
  }
  if (!total.fieldCount) return fail("NO_FORM", "No form fields on this page. Just vibes.");
  return ok({ ...total, tailored: !!tailored });
}

async function magicStart(tabId) {
  if (running.has(tabId)) return ok({ state: "running" });
  // Claim the tab synchronously so concurrent starts/cancels see it.
  const claim = { cancelled: false, cancel() { this.cancelled = true; } };
  running.set(tabId, claim);
  let started = false;
  try {
    const { profile, sessionId } = await chrome.storage.local.get(["profile", "sessionId"]);
    if (!profile) return fail("NO_PROFILE", "Import your CV first — open Settings.");
    if (!sessionId) return fail("NO_SESSION", "Add your Claude session ID in Settings.");
    await inject(tabId);
    const tab = await chrome.tabs.get(tabId);
    const scans = await runInFrames(tabId, "scan", { profile });
    let override = await session.get(`jd:${tabId}`);
    if (override && override.url !== tab.url) { // selected on a different page
      await session.remove(`jd:${tabId}`);
      override = null;
    }
    const best = scans.filter((s) => s.jd).sort((a, b) => b.jd.text.length - a.jd.text.length)[0];
    const jd = override?.text || best?.jd.text || "";
    if (jd.length < MIN_JD_CHARS) {
      return fail("NO_JD", "Couldn't find the job description. Select it on the page, right-click → “Use as job description”, then try again.");
    }
    const questions = scans.flatMap((s) => s.questions).slice(0, 40);
    await session.set(`job:${tabId}`, { state: "running", startedAt: Date.now() });
    if (claim.cancelled) {
      await session.remove(`job:${tabId}`);
      return ok({ state: "cancelled" });
    }
    const call = callHost("magic_edit", { sessionId, jd, profile, questions, pageUrl: tab.url });
    running.set(tabId, call);
    started = true;
    call.promise.then(async (res) => {
      if (running.get(tabId) === call) running.delete(tabId);
      if (res && res.ok) await session.set(`job:${tabId}`, { state: "review", result: res.data });
      else if (res?.error?.code !== "CANCELLED") {
        await session.set(`job:${tabId}`, { state: "error", error: res?.error || { code: "HOST_DISCONNECTED", message: "No response from the helper." } });
      }
    }).catch((e) => session.set(`job:${tabId}`, { state: "error", error: { code: "EXTENSION_ERROR", message: e?.message || String(e) } }));
    await session.remove(`jd:${tabId}`);
    chrome.action.setBadgeText({ tabId, text: "" });
    return ok({ state: "running" });
  } finally {
    if (!started && running.get(tabId) === claim) running.delete(tabId);
  }
}

async function magicCancel(tabId) {
  running.get(tabId)?.cancel();
  running.delete(tabId);
  await session.remove(`job:${tabId}`);
  return ok({});
}

function safePdfName(name) {
  let n = String(name || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/^\.+/, "").trim();
  if (!n) n = "CV.pdf";
  if (!/\.pdf$/i.test(n)) n += ".pdf";
  return n;
}

async function magicConfirm(tabId, pdf) {
  const noReview = { ...fail("NO_REVIEW", "Nothing to confirm — run Magic Edit first."), downloaded: false };
  if (confirming.has(tabId)) return noReview;
  confirming.add(tabId); // claim before any await so concurrent confirms can't both pass
  let res;
  let job;
  let downloaded = false;
  try {
    job = await session.get(`job:${tabId}`);
    if (job?.state !== "review") return noReview;
    await session.set(`job:${tabId}`, { ...job, state: "confirming" }); // a second confirm now fails
    const { tailoredProfile, answers, company, role } = job.result;
    const name = safePdfName(pdf?.name);
    const safePdf = { base64: pdf.base64, name };
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    await session.set(`tailored:${tabId}`, { profile: tailoredProfile, answers, pdf: safePdf, company, role, host: hostOf(tab?.url) });
    try {
      await chrome.downloads.download({
        url: `data:application/pdf;base64,${pdf.base64}`,
        filename: `JobPilot/${name}`,
        conflictAction: "uniquify",
      });
      downloaded = true;
    } catch (e) {
      await session.remove(`tailored:${tabId}`);
      const error = { code: "DOWNLOAD_FAILED", message: `Couldn't save the PDF (${e.message || e}).` };
      await session.set(`job:${tabId}`, { state: "error", error });
      return { ok: false, error, downloaded: false };
    }
    res = await autofill(tabId);
  } catch (e) {
    res = fail(e.code || "EXTENSION_ERROR", e.message || String(e));
  } finally {
    confirming.delete(tabId);
  }
  await session.set(`job:${tabId}`, {
    state: "done",
    result: job?.result,
    report: res.ok ? res.data : null,
    fillError: res.ok ? null : res.error,
  });
  return res.ok ? ok({ ...res.data, downloaded: true }) : { ...res, downloaded };
}

async function importCv({ pdfBase64, fileName }) {
  const res = await callHost("import_cv", { pdfBase64, fileName }).promise;
  if (res.ok) {
    await chrome.storage.local.set({ profile: res.data.profile, originalPdf: { base64: pdfBase64, name: fileName } });
  }
  return res;
}

const HANDLERS = {
  "host:ping": () => callHost("ping", {}).promise,
  "cv:import": (m) => importCv(m),
  autofill: (m) => autofill(m.tabId),
  "magic:start": (m) => magicStart(m.tabId),
  "magic:cancel": (m) => magicCancel(m.tabId),
  "magic:confirm": (m) => magicConfirm(m.tabId, m.pdf),
  "magic:discard": async (m) => {
    await magicCancel(m.tabId);
    await session.remove(`tailored:${m.tabId}`);
    return ok({});
  },
  "job:clear": (m) => session.remove(`job:${m.tabId}`).then(() => ok({})), // keeps any tailored CV
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg))
    .catch((e) => fail(e.code || "EXTENSION_ERROR", e.message || String(e)))
    .then(sendResponse);
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "jobpilot-jd", title: "Use as job description", contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "jobpilot-jd" || !tab?.id) return;
  let text = info.selectionText || "";
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [info.frameId ?? 0] },
      func: () => String(getSelection() || "").trim(),
    });
    if (r?.result && r.result.length > text.length) text = r.result; // selectionText collapses whitespace
  } catch (_) { /* fall back to selectionText */ }
  await session.set(`jd:${tab.id}`, { text, url: tab.url });
  chrome.action.setBadgeText({ tabId: tab.id, text: "JD" });
  chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#4f46e5" });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  session.remove(`jd:${tabId}`);
  chrome.action.setBadgeText({ tabId, text: "" });
  // The tailored CV follows multi-step ATS forms on the same host, but not to another site.
  const tailored = await session.get(`tailored:${tabId}`);
  if (tailored?.host && hostOf(changeInfo.url) !== tailored.host) await session.remove(`tailored:${tabId}`);
});

// Orphaned jobs from before a worker restart (the running map is empty now).
(async () => {
  try {
    const all = await chrome.storage.session.get(null);
    for (const [k, v] of Object.entries(all || {})) {
      if (k.startsWith("job:") && (v?.state === "running" || v?.state === "confirming")) {
        await session.set(k, { state: "error", error: { code: "HOST_DISCONNECTED", message: "JobPilot restarted while working — try again." } });
      }
    }
  } catch (_) { /* session storage unavailable */ }
})();

chrome.tabs.onRemoved.addListener((tabId) => {
  running.get(tabId)?.cancel();
  running.delete(tabId);
  session.remove([`job:${tabId}`, `tailored:${tabId}`, `jd:${tabId}`]);
});
