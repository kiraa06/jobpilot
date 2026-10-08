const $ = (id) => document.getElementById(id);
const WORKER_GONE = { code: "WORKER_GONE", message: "JobPilot's background stopped — reopen the popup." };
// Every reply is checked: a dead service worker yields undefined or a rejection, never a throw here.
async function send(msg) {
  try {
    const res = await chrome.runtime.sendMessage(msg);
    return res && typeof res.ok === "boolean" ? res : { ok: false, error: WORKER_GONE };
  } catch (_) {
    return { ok: false, error: WORKER_GONE };
  }
}
const ERROR_HINTS = {
  HOST_MISSING: "Helper not found. In Terminal: cd ~/Projects/jobpilot && ./install.sh — then restart Arc.",
};
let tabId;
let quipTimer;

function show(section) {
  for (const id of ["setup", "main", "running", "review"]) $(id).classList.toggle("hidden", id !== section);
  if (section !== "running") clearInterval(quipTimer);
}

function status(text, kind = "") {
  $("status").textContent = text;
  $("status").className = kind;
}

function showError(error) {
  status(ERROR_HINTS[error?.code] || error?.message || "Something went sideways.", "error");
}

// Runs a button's request with the button disabled, so double clicks can't stack requests.
async function busy(button, fn) {
  if (button.disabled) return;
  button.disabled = true;
  try { await fn(); } finally { button.disabled = false; }
}

function fillList(container, items, render) {
  const ul = container.querySelector("ul");
  ul.replaceChildren(...items.map((item) => {
    const li = document.createElement("li");
    const v = render === undefined ? item : render(item);
    if (Array.isArray(v)) li.append(...v); else li.textContent = String(v);
    return li;
  }));
  container.classList.toggle("hidden", items.length === 0);
}

function startConfirming() {
  clearInterval(quipTimer);
  show("running");
  $("quip").textContent = "Making your PDF…";
  $("elapsed").textContent = "";
  $("safe").classList.remove("hidden");
  $("cancel").classList.add("hidden");
}

function startRunning(startedAt) {
  clearInterval(quipTimer);
  show("running");
  $("safe").classList.remove("hidden");
  $("cancel").classList.remove("hidden");
  const quips = globalThis.JobPilotQuips;
  let i = Math.floor(Math.random() * quips.length);
  const tick = () => {
    $("quip").textContent = quips[i++ % quips.length];
    $("elapsed").textContent = `(${Math.round((Date.now() - startedAt) / 1000)}s)`;
  };
  tick();
  quipTimer = setInterval(tick, 3500);
}

function renderReview(result) {
  show("review");
  $("review-title").textContent = [result.role, result.company].filter(Boolean).join(" @ ") || "Tailored CV ready";
  fillList($("review").querySelector(".card"), result.changeSummary);
  fillList($("blocking"), result.truth.blocking);
  fillList($("warnings"), result.truth.warnings);
  fillList($("unverified"), result.unverifiedClaims);
  fillList($("answers"), result.answers.filter((a) => a.answer), (a) => {
    const b = document.createElement("b");
    b.textContent = `${a.question}: `;
    const parts = [b, a.answer];
    if (a.sensitive) { const s = document.createElement("span"); s.textContent = "check me"; parts.push(s); }
    return parts;
  });
  const needsAccept = result.truth.blocking.length > 0;
  $("accept-blocking").checked = false;
  $("confirm").disabled = needsAccept;
  $("accept-blocking").onchange = () => { $("confirm").disabled = !$("accept-blocking").checked; };
}

let confirmInFlight = false;

function pdfNote(pdf) {
  if (!pdf) return "";
  let note = `Saved Downloads/JobPilot/${pdf.name}.`;
  if (pdf.design === "yours") note += " In your CV's design.";
  if (pdf.trimmed?.length) note += ` Trimmed to 2 pages (${pdf.trimmed.length} cuts).`;
  return note;
}

function pdfWarnings(pdf) {
  const w = [];
  if (pdf?.fallbackReason) w.push(`Used the standard design — ${pdf.fallbackReason}`);
  if (pdf?.overflow) w.push(`Still ${pdf.pages} pages — trim your profile in Settings.`);
  return w.join(" ");
}

async function confirmMagic() {
  if (confirmInFlight) return;
  confirmInFlight = true;
  $("confirm").disabled = true;
  try {
    status("");
    startConfirming();
    const res = await send({ type: "magic:confirm", tabId });
    if (res.error?.code === WORKER_GONE.code) {
      show("main");
      status("JobPilot's background stopped — reopen the popup and try Make PDF again.", "error");
      return;
    }
    if (res.error?.code === "PDF_FAILED" || res.error?.code === "NO_REVIEW") {
      const job = (await chrome.storage.session.get(`job:${tabId}`))[`job:${tabId}`];
      if (job?.state === "review") renderReview(job.result); else show("main");
      status(res.error.message, "error");
      return;
    }
    show("main");
    await renderMode();
    const saved = res.ok || res.downloaded ? pdfNote(res.data?.pdf || res.pdf) : "";
    if (!res.ok) {
      status(`${saved} ${ERROR_HINTS[res.error?.code] || res.error?.message || "Autofill failed."}`.trim(), "error");
      send({ type: "job:clear", tabId });
      return;
    }
    reportAutofill(res.data, saved);
    send({ type: "job:clear", tabId });
    const warn = pdfWarnings(res.data.pdf);
    if (warn) {
      $("status").textContent += ` Heads up: ${warn}`;
      $("status").className = "warn";
    }
  } finally {
    confirmInFlight = false;
    $("confirm").disabled = false;
  }
}

function reportAutofill(r, prefix = "") {
  const parts = [`Filled ${r.filled}`];
  if (r.sensitive) parts.push(`check ${r.sensitive} (amber)`);
  if (r.unmatched) parts.push(`${r.unmatched} for you (blue)`);
  if (r.kept) parts.push(`kept ${r.kept} you typed`);
  let file = "";
  if (r.fileFieldFound && !r.fileAttached) file = " Couldn't attach the CV — drag it from Downloads/JobPilot.";
  else if (r.fileAttached) file = " CV attached.";
  const flourish = r.filled >= 5 ? " You look employable." : "";
  status(`${prefix} ${parts.join(" · ")}.${file}${flourish}`.trim(), "ok");
}

async function renderMode() {
  const t = (await chrome.storage.session.get(`tailored:${tabId}`))[`tailored:${tabId}`];
  let text = "Using your original CV.";
  if (t) {
    const label = [t.role, t.company].filter(Boolean).join(" @ ");
    text = label ? `Using your CV tailored for ${label}.` : "Using the tailored CV for this tab.";
  }
  $("mode").textContent = text;
  $("use-original").classList.toggle("hidden", !t);
}

async function init() {
  try {
    [{ id: tabId }] = await chrome.tabs.query({ active: true, currentWindow: true });
    const { profile } = await chrome.storage.local.get("profile");
    if (!profile) return show("setup");
    const job = (await chrome.storage.session.get(`job:${tabId}`))[`job:${tabId}`];
    await renderMode();
    await applyJob(job, true);
  } catch (e) {
    show("main");
    status(`Couldn't start JobPilot: ${e.message || e}`, "error");
  }
}

async function applyJob(job, initial = false) {
  if (!job) return show("main");
  if (job.state === "done") {
    show("main");
    if (initial && job.fillError) {
      const saved = job.pdf ? `${pdfNote(job.pdf)} ` : "";
      status(`${saved}${ERROR_HINTS[job.fillError.code] || job.fillError.message || "Autofill failed."}`, "error");
      send({ type: "job:clear", tabId });
    } else if (initial && job.report) { // finished while the popup was closed
      reportAutofill(job.report, pdfNote(job.pdf));
      const warn = pdfWarnings(job.pdf);
      if (warn) { $("status").textContent += ` Heads up: ${warn}`; $("status").className = "warn"; }
      send({ type: "job:clear", tabId });
    }
    return;
  }
  if (job.state === "running") return startRunning(job.startedAt);
  if (job.state === "confirming") return startConfirming();
  if (job.state === "review") return renderReview(job.result);
  if (job.state === "error") { show("main"); showError(job.error); send({ type: "job:clear", tabId }); }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" || tabId === undefined) return;
  if (changes[`job:${tabId}`]) applyJob(changes[`job:${tabId}`].newValue);
  if (changes[`tailored:${tabId}`]) renderMode();
});

$("settings").onclick = $("go-settings").onclick = () => chrome.runtime.openOptionsPage();
$("autofill").onclick = () => busy($("autofill"), async () => {
  status("Filling…");
  const res = await send({ type: "autofill", tabId });
  if (res.ok) reportAutofill(res.data); else showError(res.error);
});
$("magic").onclick = () => busy($("magic"), async () => {
  status("");
  const res = await send({ type: "magic:start", tabId });
  if (!res.ok) showError(res.error);
  else if (res.data?.state === "cancelled") show("main");
});
$("cancel").onclick = async () => {
  const res = await send({ type: "magic:cancel", tabId });
  show("main");
  if (res.ok) status("Cancelled. No harm done."); else showError(res.error);
};
$("discard").onclick = async () => {
  const res = await send({ type: "magic:discard", tabId });
  show("main");
  await renderMode();
  if (res.ok) status("Discarded."); else showError(res.error);
};
$("confirm").onclick = confirmMagic;
$("use-original").onclick = async () => {
  const res = await send({ type: "magic:discard", tabId });
  await renderMode();
  if (res.ok) status("Back to your original CV."); else showError(res.error);
};

init();
