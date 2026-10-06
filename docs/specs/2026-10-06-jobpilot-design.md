# JobPilot — Design Spec

**Date:** 2026-10-06 · **Owner:** Kiran · **Status:** Draft for review

## 1. Goal

A browser extension (Arc, Manifest V3) that helps Kiran apply for jobs:

- **Autofill** — fills the job application form on the current page from his CV profile.
- **✨ Magic Edit** — sends his CV profile and the page's job description to a named
  Claude Code session (which already knows his career context), gets back a CV tailored
  to the role as a PDF plus answers to open form questions, then autofills from it.

Constraints: runs entirely on the Claude subscription (no API key, no extra cost), no
npm/pip installs, personal use only (not published), never submits a form itself.

Success: on a typical career page, one click fills the standard fields correctly; Magic
Edit produces a truthful, role-tailored ≤2-page PDF in under ~2 minutes and attaches it.

## 2. Architecture

```
┌─ Arc extension (popup) ───────────────────────────────┐
│ Import CV │ Autofill │ ✨ Magic Edit │ Settings        │
└──────┬────────────────────────────────────────────────┘
       │ content script: extract JD + form fields, fill, attach PDF
       ▼
  service worker ──native messaging (stdio)──► jobpilot-host (Python 3, stdlib only)
       │                                           └─ claude -p --resume <id> --fork-session
       │                                              --output-format json --json-schema …
       └─ tailored PDF built inside the extension with vendored pdf-lib
```

### Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `extension/manifest.json` | MV3 manifest; permissions `activeTab`, `scripting`, `storage`, `nativeMessaging`, `contextMenus`, `downloads` | — |
| `extension/popup/` | UI: buttons, status, diff review, settings link | service worker messages |
| `extension/options/` | Session ID, profile JSON editor, re-import CV | `chrome.storage.local` |
| `extension/background.js` | Routes popup ↔ content script ↔ host; context menu "Use as job description" | native host |
| `extension/content/extract.js` | Reads JD text (selection → JSON-LD `JobPosting` → heuristic largest text block) and enumerates form fields with their label text | DOM |
| `extension/content/fill.js` | Matches fields to profile keys and fills them; attaches PDF to file inputs | DOM, `lib/matcher.js` |
| `extension/lib/matcher.js` | Pure function: field descriptor → profile key + confidence. Unit-testable | — |
| `extension/lib/pdf.js` | Pure-ish: tailored profile JSON → PDF bytes using single template | vendored `pdf-lib` + `fontkit` + embedded font |
| `host/jobpilot_host.py` | Native messaging host: length-prefixed JSON over stdio; actions `ping`, `import_cv`, `magic_edit`, `cancel` | `claude` CLI |
| `host/prompts/` | Prompt templates for import and magic edit | — |
| `install.sh` | Writes host manifest into Arc's (and Chrome's, if present) `NativeMessagingHosts/` with the extension ID | — |

## 3. Data model

`profile` (stored in `chrome.storage.local`, editable in Settings):

```json
{
  "basics": {"firstName","lastName","email","phone","location","city","country",
             "linkedin","github","website","headline","summary",
             "yearsExperience","currentCompany","currentTitle",
             "noticePeriod","currentCtc","expectedCtc","workAuthorization"},
  "experience": [{"company","title","location","start","end","bullets":[]}],
  "education":  [{"institution","degree","field","start","end","grade"}],
  "skills":     [{"group","items":[]}],
  "projects":   [{"name","description","bullets":[],"link"}],
  "certifications": [{"name","issuer","date"}]
}
```

Fields Claude cannot extract from the CV (notice period, CTC, work authorization) are
left blank and filled in once by Kiran in Settings.

## 4. Flows

### 4.1 Import CV (once)
1. Popup → file picker for PDF → bytes sent to host (base64).
2. Host writes to a temp file, runs `claude -p` (fresh, not resumed) with the Read tool
   allowed on that file only, `--json-schema` = profile schema.
3. Profile shown in Settings for review → saved. Original PDF also stored (for "attach
   original CV" in plain Autofill).

### 4.2 Autofill (no Claude call)
1. Content script enumerates visible `input`, `textarea`, `select`, radio groups,
   `contenteditable`, including same-origin iframes.
2. For each field build a descriptor: label (`<label for>`, wrapping label,
   `aria-label`, `aria-labelledby`, placeholder, `name`/`id`, preceding text), type,
   options.
3. `matcher.js` scores against a synonym table (e.g. `first name|given name|fname`) and
   returns key + confidence. Threshold ≥ 0.6 fills.
4. Fill using the native value setter + `input`/`change`/`blur` events (works with
   React/Vue controlled inputs). Selects/radios match by option text.
5. File inputs whose label matches `resume|cv` receive the current PDF via
   `DataTransfer`.
6. Highlight: green = filled, amber = sensitive (CTC/notice/visa/relocation), blue
   outline = unmatched. Popup reports "Filled 14 · Check 2 · Skipped 3".

### 4.3 ✨ Magic Edit
1. Extract JD (§2 order). If none found → prompt "select the JD text and right-click
   *Use as job description*".
2. Collect unmatched/free-text questions from the form (label + type + options).
3. Host runs:
   `claude -p --resume <sessionId> --fork-session --output-format json
    --json-schema <magic-edit schema> --tools ""` with the prompt on stdin
   (JD, current profile, questions, rules from §5). Working directory: a dedicated
   `~/.jobpilot/` so no project files are in scope.
4. Response: `{tailoredProfile, changeSummary[], answers[{question, answer, sensitive}],
   unverifiedClaims[]}`.
5. Host runs the truth check (§5) and returns result.
6. Popup shows change summary + any truth-check warnings → **Confirm**.
7. Extension builds PDF (`lib/pdf.js`), saves via `chrome.downloads` to
   `Downloads/JobPilot/<Company>-<Role>-<YYYY-MM-DD>.pdf`, then runs Autofill with the
   tailored profile + answers, attaching the new PDF.

Progress messages rotate while waiting ("Tailoring your CV to sound 12% more like a
unicorn…"). Timeout 3 min, Cancel kills the `claude` process.

## 5. Magic Edit rules (prompt + enforced)

Allowed: rewrite summary, reorder/reword bullets toward JD keywords, reorder skills,
omit irrelevant roles/projects, choose highlights.

Forbidden: inventing employers, titles, dates, degrees, certifications, metrics or
skills. Uncertain claims go to `unverifiedClaims`, not the CV.

**Truth check (host, deterministic):** every `experience` entry's `company`, `title`,
`start`, `end`, and every `education`/`certifications` entry in the tailored profile must
exist in the original profile (normalized string compare). Any mismatch → blocking
warning listing the diff; Kiran must explicitly accept to proceed. Skills not present in
the original profile are flagged (non-blocking).

Length: template targets ≤ 2 pages; if layout overflows, the extension drops the
oldest roles' bullets beyond 2 per role, then reports it.

## 6. PDF template

Single clean template built with `pdf-lib`: name header, contact line with links,
summary, experience, skills, projects, education, certifications. A4. Embedded
open-licence TTF (e.g. Inter) via `fontkit` so non-ASCII characters (₹, é, smart quotes)
render. Text is real text (ATS-parsable), not an image. Libraries are vendored as
single files in `extension/vendor/` (downloaded once from a CDN at build time, pinned
version, checksum noted).

## 7. UI / tone

Popup ~360 px wide, card layout, light/dark following system. Professional by default,
quirky in microcopy only: rotating progress lines, empty states ("No form here. Just
vibes."), success toast ("Filled 14 fields. You look employable."). Never quirky in
anything that lands in the CV or form.

## 8. Error handling

| Failure | Behavior |
|---|---|
| Host not installed / not reachable | "Helper not found — run `./install.sh`" with copy button |
| Session ID invalid | "That session isn't available — run `claude --resume` to list yours" |
| Subscription limit / CLI error | Surface CLI message verbatim; no auto-retry |
| Malformed model output | Already prevented by `--json-schema`; if parse still fails, show raw error, keep old CV |
| JD not found | Instruct to select text + context menu |
| Timeout (3 min) | Kill process, offer retry |
| File input won't accept PDF | Download PDF, highlight upload field for manual attach |
| Restricted page (`arc://`, Web Store) | "Can't work on this page" |

## 9. Risks

- **Arc native messaging** is less proven than Chrome's. Arc 1.166 has
  `~/Library/Application Support/Arc/User Data/NativeMessagingHosts/` (exists, empty).
  **Task 1 of the plan is a ping probe.** Fallback if it fails: host runs as a
  `127.0.0.1` HTTP server started by launchd, protected by a random token stored in
  the extension at install time. The host's action handlers are transport-agnostic so
  only the I/O layer changes.
- **Native messaging message cap** is 1 MB host→extension; responses are JSON only (the
  PDF is generated in the extension), so this is not a concern.
- **MV3 service worker lifetime:** an open native port keeps the worker alive; the popup
  closing must not cancel the job — job state lives in the worker and popup re-attaches.
- **Fork-session growth:** each Magic Edit creates a forked session file; acceptable.

## 10. Testing

- `matcher.js` and truth check: unit tests (Node's built-in `node:test` for JS,
  `unittest` for Python) — no dependencies.
- Host: test with a fake `claude` executable on `PATH` returning canned JSON.
- Fill: local fixture HTML pages mimicking Greenhouse, Lever, Workday, and a React
  controlled-input form; verified manually in Arc and via Playwright where possible.
- End-to-end: one real Magic Edit against Kiran's session on a real job page.

## 11. Out of scope (v1)

Auto-submit, application tracking, multiple templates, cover-letter PDF, site-specific
adapters, Web Store publishing.

## 12. Layout

```
~/Projects/jobpilot/
  extension/{manifest.json, background.js, popup/, options/, content/, lib/, vendor/, icons/}
  host/{jobpilot_host.py, prompts/, tests/}
  tests/fixtures/*.html
  install.sh · README.md · docs/specs/
```
