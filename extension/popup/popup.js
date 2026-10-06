const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
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
  status(ERROR_HINTS[error.code] || error.message || "Something went sideways.", "error");
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
  $("safe").classList.add("hidden");
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

async function loadFonts() {
  const get = async (f) => {
    const r = await fetch(chrome.runtime.getURL(`vendor/fonts/${f}`));
    if (!r.ok) throw new Error("font");
    return new Uint8Array(await r.arrayBuffer());
  };
  try { return { regular: await get("Lato-Regular.ttf"), bold: await get("Lato-Bold.ttf") }; }
  catch (_) { throw new Error("Couldn't load the CV font — reload the extension."); }
}

let confirmInFlight = false;

async function confirmMagic() {
  if (confirmInFlight) return;
  confirmInFlight = true;
  $("confirm").disabled = true;
  try {
    const job = (await chrome.storage.session.get(`job:${tabId}`))[`job:${tabId}`];
    if (!job?.result) {
      show("main");
      status("That review expired — run Magic Edit again.", "error");
      return;
    }
    status("Rendering your shiny new PDF…");
    let out, name;
    try {
      out = await JobPilot.cvPdf.buildCvPdf(JobPilot.profile.normalizeProfile(job.result.tailoredProfile),
        { PDFLib: window.PDFLib, fontkit: window.fontkit, fonts: await loadFonts() });
      name = JobPilot.util.pdfFileName(job.result.company, job.result.role, new Date());
    } catch (e) {
      status(/^Couldn't load/.test(e.message) ? e.message : `PDF failed: ${e.message}`, "error");
      $("confirm").disabled = false;
      return;
    }
    let res;
    try {
      res = await send({ type: "magic:confirm", tabId, pdf: { base64: JobPilot.util.bytesToBase64(out.bytes), name } });
    } catch (_) {
      status("PDF built, but JobPilot's background stopped — try Make PDF again.", "error");
      $("confirm").disabled = false;
      return;
    }
    show("main");
    await renderMode();
    const saved = (res?.ok ? res.data?.downloaded : res?.downloaded) ? `Saved Downloads/JobPilot/${name}.` : "";
    if (!res?.ok) {
      status(`${saved} ${ERROR_HINTS[res?.error?.code] || res?.error?.message || "Autofill failed."}`.trim(), "error");
      send({ type: "job:clear", tabId });
      return;
    }
    const trimmed = out.trimmed?.length ? ` Trimmed to 2 pages (${out.trimmed.length} cuts).` : "";
    reportAutofill(res.data, `${saved}${trimmed}`);
    if (out.overflow) {
      $("status").textContent += ` Heads up: still ${out.pages} pages — trim your profile in Settings.`;
      $("status").className = "warn";
    }
  } finally {
    confirmInFlight = false;
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
      const t = (await chrome.storage.session.get(`tailored:${tabId}`))[`tailored:${tabId}`];
      const saved = t?.pdf?.name ? `Saved Downloads/JobPilot/${t.pdf.name}. ` : "";
      status(`${saved}${ERROR_HINTS[job.fillError.code] || job.fillError.message || "Autofill failed."}`, "error");
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
$("autofill").onclick = async () => {
  status("Filling…");
  const res = await send({ type: "autofill", tabId });
  if (res.ok) reportAutofill(res.data); else showError(res.error);
};
$("magic").onclick = async () => {
  status("");
  const res = await send({ type: "magic:start", tabId });
  if (!res.ok) showError(res.error);
  else if (res.data?.state === "cancelled") show("main");
};
$("cancel").onclick = async () => { await send({ type: "magic:cancel", tabId }); show("main"); status("Cancelled. No harm done."); };
$("discard").onclick = async () => { await send({ type: "magic:discard", tabId }); show("main"); await renderMode(); status("Discarded."); };
$("confirm").onclick = confirmMagic;
$("use-original").onclick = async () => {
  await send({ type: "magic:discard", tabId });
  await renderMode();
  status("Back to your original CV.");
};

init();
