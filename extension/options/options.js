const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const say = (id, text, kind = "muted") => { $(id).textContent = text; $(id).className = kind; };

async function checkHelper() {
  say("helper-status", "Checking…");
  let res;
  try { res = await send({ type: "host:ping" }); } catch (e) { res = { ok: false }; }
  if (res && res.ok && res.data.claudeFound) say("helper-status", `✓ Helper v${res.data.version} · claude at ${res.data.claudeBin}`, "ok");
  else if (res && res.ok) say("helper-status", `Helper found, but claude isn't at ${res.data.claudeBin}. Re-run ./install.sh.`, "error");
  else {
    const why = res && res.error && res.error.message ? ` (${res.error.message})` : "";
    say("helper-status", `✗ Helper not found. In Terminal: cd ~/Projects/jobpilot && ./install.sh — then restart Arc.${why}`, "error");
  }
}

async function loadProfile() {
  const { profile, sessionId } = await chrome.storage.local.get(["profile", "sessionId"]);
  const p = JobPilot.profile.normalizeProfile(profile);
  $("profile-json").value = JSON.stringify(p, null, 2);
  for (const input of document.querySelectorAll("[data-basic]")) input.value = p.basics[input.dataset.basic] || "";
  $("session").value = sessionId || "";
}

async function saveProfile(p) {
  await chrome.storage.local.set({ profile: JobPilot.profile.normalizeProfile(p) });
  await loadProfile();
}

// The textarea is the single source of truth for the profile being edited.
function parseEditor() {
  let v;
  try { v = JSON.parse($("profile-json").value); } catch (e) { return { error: `Not valid JSON: ${e.message}` }; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { error: "Profile must be a JSON object." };
  return { value: v };
}

function syncInputsFromEditor() {
  const parsed = parseEditor();
  if (parsed.error) return;
  const basics = JobPilot.profile.normalizeProfile(parsed.value).basics;
  for (const input of document.querySelectorAll("[data-basic]")) input.value = basics[input.dataset.basic] || "";
}

for (const input of document.querySelectorAll("[data-basic]")) {
  input.addEventListener("input", () => {
    const parsed = parseEditor();
    if (parsed.error) return say("basics-status", "Fix the JSON below first — your detail edits can't be applied yet.", "error");
    const p = JobPilot.profile.normalizeProfile(parsed.value);
    p.basics[input.dataset.basic] = input.value.trim();
    const ta = $("profile-json"), top = ta.scrollTop;
    ta.value = JSON.stringify({ ...parsed.value, basics: p.basics }, null, 2);
    ta.scrollTop = top;
    say("basics-status", "");
  });
}
$("profile-json").addEventListener("change", syncInputsFromEditor);

async function saveEditor(statusId) {
  const parsed = parseEditor();
  if (parsed.error) return say(statusId, parsed.error, "error");
  try {
    await saveProfile(parsed.value);
    say(statusId, "✓ Saved.", "ok");
  } catch (e) {
    say(statusId, `Couldn't save: ${e.message}`, "error");
  }
}

const MAX_PDF = 10 * 1024 * 1024;
let importing = false;
$("cv-file").onchange = () => { $("import").disabled = importing || !$("cv-file").files.length; };

$("import").onclick = async () => {
  const file = $("cv-file").files[0];
  if (!file || importing) return;
  if (file.size > MAX_PDF) return say("import-status", "That PDF is over 10 MB — export a smaller version.", "error");
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return say("import-status", "Pick a PDF file.", "error");
  importing = true;
  $("import").disabled = true;
  try {
    const { profile: existing } = await chrome.storage.local.get("profile");
    if (existing && !confirm("Re-importing replaces your current profile with what Claude reads from this PDF. Details in section 4 are kept. Continue?")) {
      return say("import-status", "");
    }
    say("import-status", "Reading your CV… (about 30–60 s)");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await send({ type: "cv:import", pdfBase64: JobPilot.util.bytesToBase64(bytes), fileName: file.name });
    if (!res || !res.ok) return say("import-status", (res && res.error && res.error.message) || "Import failed.", "error");
    // Deliberately entered section-4 values win over the CV's.
    const fresh = JobPilot.profile.normalizeProfile(res.data.profile);
    for (const input of document.querySelectorAll("[data-basic]")) {
      if (input.value.trim()) fresh.basics[input.dataset.basic] = input.value.trim();
    }
    await saveProfile(fresh);
    const roles = fresh.experience.length;
    say("import-status", `✓ Imported ${fresh.basics.firstName || "your CV"} — ${roles} role${roles === 1 ? "" : "s"}. Check the details below.`, "ok");
  } catch (e) {
    say("import-status", `Import failed: ${e.message}`, "error");
  } finally {
    importing = false;
    $("import").disabled = !$("cv-file").files.length;
  }
};

$("save-session").onclick = async () => {
  const id = JobPilot.util.parseSessionId($("session").value);
  if (!id) return say("session-status", "That doesn't look like a session ID (expected something like f6c115bd-98ae-…).", "error");
  try {
    await chrome.storage.local.set({ sessionId: id });
    $("session").value = id;
    say("session-status", "✓ Saved.", "ok");
  } catch (e) {
    say("session-status", `Couldn't save: ${e.message}`, "error");
  }
};

$("save-basics").onclick = () => saveEditor("basics-status");
$("save-profile").onclick = () => saveEditor("profile-status");

$("ping").onclick = checkHelper;
checkHelper();
loadProfile();
