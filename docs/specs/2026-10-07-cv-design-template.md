# JobPilot — Keep my CV's design · Design Spec

**Date:** 2026-10-07 · **Owner:** Kiran · **Status:** Draft for review
**Builds on:** `docs/specs/2026-10-06-jobpilot-design.md` (v1, merged)

## 1. Goal

The tailored PDF from Magic Edit should look like Kiran's original CV — same layout,
colours, header, section order, spacing and bullet style — instead of JobPilot's one
built-in template.

Approach (chosen for robustness): capture the original design **once** as an HTML/CSS
template with content slots, have Kiran approve it, then print every tailored CV through
it. Works from the PDF alone; no Word/Docs/source file needed.

**Fail-safe rule:** a Magic Edit always produces a PDF. If the captured design is missing,
unapproved, or fails at render time, JobPilot uses the v1 built-in template and says so.

Success: after capture + approval, a tailored CV is visually recognisable as Kiran's own
design (fonts may be the nearest free match), stays real selectable text (ATS-parsable),
fits ≤ 2 pages, and never silently loses content.

Non-goals: pixel-identical reproduction; editing the original PDF in place; embedding
the original's (possibly licensed) fonts; multiple saved designs.

## 2. Flow

```
Import CV ──► store original PDF ──► [Capture my design] ─► host: claude (fresh, Read on PDF)
                                                              └─ returns HTML/CSS template
             Settings preview: original | template rendered with current profile
             checks: lint + no-hardcoded-content + completeness
             [Use this design]  or  [Try again + note]  ──► storage: design.approved

Magic Edit ─► Confirm ─► background: render tailored profile into approved template
                          in a background tab ─► Page.printToPDF ─► count pages ─► trim ≤2
                          └─ any failure ─► v1 built-in PDF + "used standard design" note
```

## 3. Components

| Unit | Responsibility |
|---|---|
| `extension/lib/template.js` (new, pure) | Tiny Mustache-subset renderer + `viewModel(profile)` + `lintTemplate(html)` + `checkCompleteness(profile, renderedText)` + `findHardcoded(template, profile)`. Node-testable. |
| `extension/render/render.html` + `render.js` (new) | Extension page that receives a rendered HTML document and displays it for printing. Loads the vendored font CSS. |
| `extension/lib/design-pdf.js` (new) | Background-side: open render tab (inactive), `chrome.debugger` attach → `Page.printToPDF` → detach → close tab; page-count + trim loop reusing v1 `trimOnce` logic. |
| `extension/vendor/fonts/` | Add a curated set of OFL fonts (regular + bold, latin) + `fonts.css` with `@font-face` rules. Pinned and checksummed like v1. |
| `host/jobpilot/actions.py` | New action `capture_design`. |
| `host/jobpilot/prompts.py`, `schemas.py` | Capture prompt + `DESIGN_SCHEMA`. |
| `extension/options/*` | New section "Your CV's design": capture, side-by-side preview, approve / try again with note, reset to standard. |
| `extension/background.js` | Messages `design:capture`, `design:render`; store original PDF on import. |
| `extension/popup/popup.js` | Confirm uses `design:render` when a design is approved; falls back to `buildCvPdf`. |
| `manifest.json` | Add `"debugger"` permission; `render/render.html` is an extension page. |

## 4. Template format

A complete HTML document (`<!doctype html>` … with one `<style>` block) using a
Mustache subset, implemented by `template.js`:

- `{{path}}` — HTML-escaped value. There is **no** unescaped form.
- `{{#path}}…{{/path}}` — array: repeat per item; non-empty string / true: render once.
- `{{^path}}…{{/path}}` — render when empty/false/missing.
- `{{.}}` — current item (for string arrays such as bullets).
- Lookup walks the context stack (item first, then parents). Unknown tags render empty.

**View model** (`viewModel(profile)`, all strings already trimmed):

```
name, firstName, lastName, headline, summary,
email, phone, location, linkedin, github, website,
contacts[]            {label, value, href}   // only non-empty, in that order
experience[]          {company, title, location, start, end, dates, bullets[]}
education[]           {institution, degree, field, start, end, dates, grade}
skills[]              {group, items[], itemsText}   // itemsText = items joined ", "
projects[]            {name, description, link, bullets[]}
certifications[]      {name, issuer, date}
hasSummary, hasExperience, hasEducation, hasSkills, hasProjects, hasCertifications
```

`dates` = `start – end` (either side may be empty; no dangling dash).

**Template rules** (enforced by `lintTemplate`, failure = reject):
- No `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<base>`, `<meta http-equiv>`,
  no `on*=` attributes, no `javascript:` URLs.
- No network: no `http(s):`/`//` in `url(...)`, `@import`, or `src`. Images not allowed
  (a photo/logo in the original is dropped; noted to Kiran).
- `font-family` may only name the vendored families (+ generic fallbacks).
- Must contain an `@page` rule (size A4 or Letter matching the original, margins).
- ≤ 100 KB.

## 5. Capture (host action `capture_design`)

Payload: `{pdfBase64, profile, feedback?, previousTemplate?}`.

Runs a **fresh** `claude -p` with the same isolation as v1 import
(`--tools Read`, Read restricted to the imports dir, `--strict-mcp-config
--setting-sources ""`, `--json-schema DESIGN_SCHEMA`), timeout 240 s.

Prompt: look at every page of the PDF; reproduce its visual design as a template in the
§4 format; use only the listed font families (name each with its look, e.g. "Lato —
humanist sans"); put **no CV content** in the template — every visible piece of CV text
must come from a slot; keep the original's section order and headings' wording
(headings like "Experience" are design, not content); give approximate colours as hex.
On retry, `feedback` and `previousTemplate` are included ("change only what the note asks").

Schema: `{template: string, pageSize: "A4"|"Letter", fontsUsed: string[], notes: string[]}`
(`notes` = things that couldn't be reproduced, e.g. "photo dropped", "font substituted").

## 6. Checks before Kiran sees the preview

Run in Settings on the returned template, against the **current** profile:

1. `lintTemplate` (§4). Fail → error shown, Try again.
2. `findHardcoded(template, profile)` — the template source must not contain the
   profile's name, email, phone, any company, institution, title or bullet text
   (normalized, ≥ 4 chars). Fail → reject ("template copied your text instead of using
   slots"), because tailored edits would be ignored.
3. `checkCompleteness(profile, renderedText)` — every company, title, institution,
   degree, project name, certification name, skill item and bullet appears in the
   rendered document's text (whitespace/case-normalized). Missing items are listed.
   Fail → reject ("template drops: …").

Only a template passing all three can be approved. Checks 1–3 run again at Magic Edit
render time against the tailored profile; any failure → fallback (§7).

## 7. Rendering (Magic Edit confirm)

1. Confirm runs entirely in the background (`magic:confirm`): it builds the PDF — captured
   design or v1 fallback — so closing the popup mid-render loses nothing.
2. Background renders the template to an HTML string, opens
   `render/render.html` in an **inactive** tab of the current window, hands it the HTML,
   waits for fonts (`document.fonts.ready`), attaches `chrome.debugger`
   (protocol 1.3), calls `Page.printToPDF {printBackground: true, preferCSSPageSize: true}`,
   detaches, closes the tab (always, in `finally`).
3. Page count via pdf-lib. If > 2 pages, binary-search trim with the v1 `trimOnce`
   sequence (same as `buildCvPdf`); report `trimmed` and `overflow` exactly as v1.
4. Return `{base64, pages, trimmed, overflow, design: "yours"}`. Timeout 30 s total.
5. Any error/timeout/check failure → the background builds the v1 PDF and the popup shows
   "Used the standard design — <reason>". Download name, location and autofill attach are
   unchanged from v1.

The preview in Settings uses the same render path, so what Kiran approves is what Magic
Edit prints.

## 8. Storage

`chrome.storage.local` (already `unlimitedStorage`):
- `originalPdf: {base64, name}` — already written on every import since v1 (no re-import needed).
- `designDraft: {template, pageSize, fontsUsed, notes, capturedAt, rejected?}` — latest capture,
  awaiting approval; a bad retry never touches the approved design.
- `design: {…draft, approvedAt}` — the approved design Magic Edit uses.
- `designStale: true` — set when a CV is re-imported while a design is approved.

Re-importing a CV keeps the approved design but shows "Your CV changed — recapture the
design?" in Settings. "Reset to standard design" deletes `design`.

## 9. Error handling

| Failure | Behavior |
|---|---|
| No original PDF stored (imported before this feature) | "Import your CV again to capture its design." |
| Capture timeout / CLI error | Message verbatim, design unchanged |
| Lint / hardcoded / completeness fails | Specific reason; Try again (note optional) |
| Arc refuses `chrome.debugger` | Detected at first render; see §10 fallback |
| Tab closed / navigated by user mid-render | Render error → fallback PDF |
| Render > 30 s | Abort, close tab, fallback PDF |
| Tailored CV still > 2 pages after trimming | Same overflow warning as v1 |

## 10. Risks

- **`chrome.debugger` in Arc** — unverified. **Plan Task 1 is a probe**: print a fixed
  page from the background in Arc. Chrome shows a "started debugging this browser"
  infobar during printing; acceptable. If Arc blocks it, the alternative renderer is the
  host printing the HTML via macOS WebKit (`osascript -l JavaScript`, `WKWebView` +
  `NSPrintOperation` to PDF, no installs); the rest of this design is unchanged because
  rendering is behind one function.
- **Fidelity** — Claude reproduces design from page images; expect close, not exact.
  The approve/try-again loop is the mitigation.
- **Font coverage** — vendored latin subsets; characters outside them fall back to a
  generic font (still text, may look different).
- **Template injection** — CV/JD text only ever enters via escaped slots; templates run
  on an extension page under MV3's default CSP (no inline script) and pass the lint.

## 11. Testing

- `template.js`: node tests for the renderer (escaping, sections, inverted, nesting,
  `{{.}}`), view model (dates, contacts), lint (each forbidden construct), hardcoded
  detection, completeness (missing bullet/skill detected).
- Host: `capture_design` with the fake `claude` (args include isolation flags + Read
  restriction; feedback/previousTemplate reach the prompt; bad payloads rejected).
- Browser harness: render a fixture template → PDF via the render page; trimming to 2
  pages; fallback on lint failure.
- Manual in Arc: probe (Task 1), capture on Kiran's real CV, approve, one Magic Edit.

## 12. Out of scope

Pixel-perfect matching, photos/logos, multiple saved designs, editing the template by
hand in the UI (Kiran can still edit via "Try again" notes), DOCX output.
