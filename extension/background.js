const HOST = "com.kiraa06.jobpilot";
const CONTENT_FILES = ["lib/util.js", "lib/profile.js", "lib/matcher.js", "content/extract.js", "content/fill.js"];
const MIN_JD_CHARS = 200;
const running = new Map(); // tabId -> {cancel}

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
      try { port.postMessage({ action: "cancel" }); port.disconnect(); } catch (_) { /* already gone */ }
      finish(fail("CANCELLED", "Cancelled."));
    },
  };
}

const session = {
  async get(key) { return (await chrome.storage.session.get(key))[key]; },
  set(key, value) { return chrome.storage.session.set({ [key]: value }); },
  remove(keys) { return chrome.storage.session.remove(keys); },
};

async function inject(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_FILES });
  } catch (e) {
    throw Object.assign(new Error("JobPilot can't work on this page (browser pages and the extension store are off-limits)."),
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
  const { profile, sessionId } = await chrome.storage.local.get(["profile", "sessionId"]);
  if (!profile) return fail("NO_PROFILE", "Import your CV first — open Settings.");
  if (!sessionId) return fail("NO_SESSION", "Add your Claude session ID in Settings.");
  await inject(tabId);
  const scans = await runInFrames(tabId, "scan", { profile });
  const override = await session.get(`jd:${tabId}`);
  const best = scans.filter((s) => s.jd).sort((a, b) => b.jd.text.length - a.jd.text.length)[0];
  const jd = override || best?.jd.text || "";
  if (jd.length < MIN_JD_CHARS) {
    return fail("NO_JD", "Couldn't find the job description. Select it on the page, right-click → “Use as job description”, then try again.");
  }
  const questions = scans.flatMap((s) => s.questions).slice(0, 40);
  const tab = await chrome.tabs.get(tabId);
  await session.set(`job:${tabId}`, { state: "running", startedAt: Date.now() });
  const call = callHost("magic_edit", { sessionId, jd, profile, questions, pageUrl: tab.url });
  running.set(tabId, call);
  call.promise.then(async (res) => {
    running.delete(tabId);
    if (res.ok) await session.set(`job:${tabId}`, { state: "review", result: res.data });
    else if (res.error.code !== "CANCELLED") await session.set(`job:${tabId}`, { state: "error", error: res.error });
  });
  return ok({ state: "running" });
}

async function magicCancel(tabId) {
  running.get(tabId)?.cancel();
  running.delete(tabId);
  await session.remove(`job:${tabId}`);
  return ok({});
}

async function magicConfirm(tabId, pdf) {
  const job = await session.get(`job:${tabId}`);
  if (job?.state !== "review") return fail("NO_REVIEW", "Nothing to confirm — run Magic Edit first.");
  const { tailoredProfile, answers } = job.result;
  await session.set(`tailored:${tabId}`, { profile: tailoredProfile, answers, pdf });
  await chrome.downloads.download({
    url: `data:application/pdf;base64,${pdf.base64}`,
    filename: `JobPilot/${pdf.name}`,
    conflictAction: "uniquify",
  });
  const res = await autofill(tabId);
  await session.set(`job:${tabId}`, { state: "done", report: res.ok ? res.data : null, result: job.result });
  return res;
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
  "magic:discard": (m) => session.remove([`job:${m.tabId}`, `tailored:${m.tabId}`]).then(() => ok({})),
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
  await session.set(`jd:${tab.id}`, text);
  chrome.action.setBadgeText({ tabId: tab.id, text: "JD" });
  chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#4f46e5" });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  running.get(tabId)?.cancel();
  running.delete(tabId);
  session.remove([`job:${tabId}`, `tailored:${tabId}`, `jd:${tabId}`]);
});
