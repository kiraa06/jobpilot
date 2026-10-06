# JobPilot ✨

Autofill job applications from your CV — and tailor the CV to each job with **your own Claude Code
session** (runs on your Claude subscription; no API key).

## Setup (once)

```bash
git clone https://github.com/kiraa06/jobpilot ~/Projects/jobpilot
cd ~/Projects/jobpilot && ./install.sh
```
Then in Arc: `arc://extensions` → Developer mode → **Load unpacked** → `~/Projects/jobpilot/extension`.
Restart Arc once so it picks up the helper.

Open JobPilot → ⚙ Settings:
1. Helper shows ✓.
2. Import your CV (PDF).
3. Paste your Claude session ID (`claude --resume` lists them).
4. Add notice period / CTC / work authorization.

## Use

- **Autofill** — fills the form from your CV. Green = filled, amber = check me, blue dashed = yours to answer.
  Never submits, never ticks consent boxes, never overwrites what you typed, chose or attached yourself.
- **✨ Magic Edit** — sends the job description + your CV to a *fork* of your session (your original session is never modified), shows what changed,
  then on **Make PDF & Autofill** saves `Downloads/JobPilot/<Company>-<Role>-<date>.pdf`, attaches it and fills
  the form (including open questions). Anything not in your original CV is flagged before the PDF is made.
  After tailoring, the popup says "Using your CV tailored for <role> @ <company>" with a "Use original" link to go back.
  If the tailored PDF still can't fit 2 pages, the popup warns ("Heads up: still N pages…").
- No job description found? Select it on the page → right-click → **Use as job description**.

## Known limitations

- Symbols the CV font (Lato) lacks — such as ✓ and ★ — are left out of the PDF.
- Dropdowns without a "Select…" placeholder are treated as already chosen and left alone.

## Develop

```bash
./scripts/test.sh                                   # Python + JS unit tests
python3 -m http.server 8765 --bind 127.0.0.1        # then open tests/browser/fill.test.html → title PASS 36/36
./scripts/vendor.sh                                 # re-download vendored libs (checksum-verified)
```

JS tests: `node --test tests/js/*.test.cjs`.

Helper log: `~/.jobpilot/host.log`.
