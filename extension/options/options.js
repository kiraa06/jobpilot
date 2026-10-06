const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const say = (id, text, kind = "muted") => { $(id).textContent = text; $(id).className = kind; };

async function checkHelper() {
  say("helper-status", "Checking…");
  let res;
  try { res = await send({ type: "host:ping" }); } catch (e) { res = { ok: false }; }
  if (res && res.ok && res.data.claudeFound) say("helper-status", `✓ Helper v${res.data.version} · claude at ${res.data.claudeBin}`, "ok");
  else if (res && res.ok) say("helper-status", `Helper found, but claude isn't at ${res.data.claudeBin}. Re-run ./install.sh.`, "error");
  else say("helper-status", "✗ Helper not found. In Terminal: cd ~/Projects/jobpilot && ./install.sh — then restart Arc.", "error");
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

// Parse the JSON editor; returns {value} or {error} (message to show).
function parseEditor() {
  let v;
  try { v = JSON.parse($("profile-json").value); } catch (e) { return { error: `Not valid JSON: ${e.message}` }; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { error: "Profile must be a JSON object." };
  return { value: v };
}

let importing = false;
$("cv-file").onchange = () => { $("import").disabled = importing || !$("cv-file").files.length; };

$("import").onclick = async () => {
  const file = $("cv-file").files[0];
  if (!file || importing) return;
  importing = true;
  $("import").disabled = true;
  say("import-status", "Reading your CV… (about 30–60 s)");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await send({ type: "cv:import", pdfBase64: JobPilot.util.bytesToBase64(bytes), fileName: file.name });
    if (!res || !res.ok) return say("import-status", (res && res.error && res.error.message) || "Import failed.", "error");
    // Keep the extra details (notice period, CTC…) the user already entered.
    const fresh = JobPilot.profile.normalizeProfile(res.data.profile);
    for (const input of document.querySelectorAll("[data-basic]")) {
      const k = input.dataset.basic;
      if (!fresh.basics[k] && input.value) fresh.basics[k] = input.value;
    }
    await saveProfile(fresh);
    const roles = fresh.experience.length;
    say("import-status", `✓ Imported ${fresh.basics.firstName || "you"} — ${roles} role${roles === 1 ? "" : "s"}. Check the details below.`, "ok");
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
  await chrome.storage.local.set({ sessionId: id });
  $("session").value = id;
  say("session-status", "✓ Saved.", "ok");
};

$("save-basics").onclick = async () => {
  const parsed = parseEditor();
  if (parsed.error) return say("basics-status", parsed.error, "error");
  const p = JobPilot.profile.normalizeProfile(parsed.value);
  for (const input of document.querySelectorAll("[data-basic]")) p.basics[input.dataset.basic] = input.value.trim();
  await saveProfile(p);
  say("basics-status", "✓ Saved.", "ok");
};

$("save-profile").onclick = async () => {
  const parsed = parseEditor();
  if (parsed.error) return say("profile-status", parsed.error, "error");
  await saveProfile(parsed.value);
  say("profile-status", "✓ Saved.", "ok");
};

$("ping").onclick = checkHelper;
checkHelper();
loadProfile();
