import base64
import binascii
import json
import logging
import os
import re
import uuid

from . import VERSION
from .claude_runner import ClaudeError, run_claude
from .prompts import design_prompt, fill_prompt, import_prompt, magic_prompt
from .schemas import DESIGN_SCHEMA, FILL_SCHEMA, MAGIC_SCHEMA, PROFILE_SCHEMA
from .truth import pin_basics, truth_check

log = logging.getLogger("jobpilot")

IMPORT_TIMEOUT = 120
MAGIC_TIMEOUT = 180
DESIGN_TIMEOUT = 240
MAX_TEMPLATE_CHARS = 100_000
MAX_FEEDBACK_CHARS = 2_000
MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_QUESTIONS = 40
MAX_FILL_FIELDS = 120
MAX_FIELD_TEXT = 300
# Untrusted text (JDs, CVs) reaches these runs: load no MCP servers, no user/project settings or hooks.
ISOLATION = ("--strict-mcp-config", "--setting-sources", "")
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


def ok(data):
    return {"ok": True, "data": data}


def err(code, message):
    return {"ok": False, "error": {"code": code, "message": message}}


def normalize_session_id(raw):
    match = UUID_RE.search(raw or "")
    return match.group(0).lower() if match else None


def ping(cfg):
    claude_bin = cfg.get("claudeBin")
    return {"version": VERSION, "claudeBin": claude_bin,
            "claudeFound": bool(claude_bin and os.path.exists(claude_bin))}


def _decode_pdf(payload):
    try:
        pdf = base64.b64decode(payload.get("pdfBase64") or "", validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("The CV upload was not valid base64.")
    if not pdf.startswith(b"%PDF"):
        raise ValueError("That file isn't a PDF.")
    if len(pdf) > MAX_PDF_BYTES:
        raise ValueError("That PDF is over 10 MB.")
    return pdf


def _run_on_pdf(pdf, cfg, cancel, *, schema, prompt_for, timeout):
    """Fresh, isolated claude run that may Read only the temp copy of the PDF."""
    imports = cfg["home"] / "imports"
    imports.mkdir(parents=True, exist_ok=True)
    path = imports / f"cv-{uuid.uuid4().hex}.pdf"
    path.write_bytes(pdf)
    try:
        return run_claude(
            ["--tools", "Read", "--allowedTools", f"Read({imports}/**)", "--add-dir", str(imports),
             *ISOLATION, "--json-schema", json.dumps(schema)],
            prompt_for(str(path)),
            claude_bin=cfg["claudeBin"], cwd=cfg["home"], timeout=timeout, cancel=cancel,
        )
    finally:
        path.unlink(missing_ok=True)


def import_cv(payload, cfg, cancel):
    data = _run_on_pdf(_decode_pdf(payload), cfg, cancel, schema=PROFILE_SCHEMA, prompt_for=import_prompt,
                       timeout=IMPORT_TIMEOUT)
    return {"profile": data["structured_output"]}


def capture_design(payload, cfg, cancel):
    pdf = _decode_pdf(payload)
    fonts = [f for f in payload.get("fonts") or [] if isinstance(f, dict) and f.get("family")]
    if not fonts:
        raise ValueError("No fonts were provided.")
    profile = payload.get("profile")
    if not isinstance(profile, dict):
        raise ValueError("No CV profile was provided.")
    feedback = str(payload.get("feedback") or "").strip()[:MAX_FEEDBACK_CHARS]
    previous = str(payload.get("previousTemplate") or "")[:MAX_TEMPLATE_CHARS]
    data = _run_on_pdf(
        pdf, cfg, cancel, schema=DESIGN_SCHEMA, timeout=DESIGN_TIMEOUT,
        prompt_for=lambda path: design_prompt(pdf_path=path, profile=profile, fonts=fonts,
                                              feedback=feedback, previous_template=previous),
    )
    out = data["structured_output"]
    return {
        "template": out.get("template") or "",
        "pageSize": out.get("pageSize") or "A4",
        "fontsUsed": out.get("fontsUsed") or [],
        "notes": out.get("notes") or [],
    }


def magic_edit(payload, cfg, cancel):
    session_id = normalize_session_id(payload.get("sessionId"))
    if not session_id:
        raise ValueError("Session ID must be a UUID like 00000000-0000-4000-8000-000000000000.")
    jd = (payload.get("jd") or "").strip()
    if not jd:
        raise ValueError("No job description was provided.")
    profile = payload.get("profile")
    if not isinstance(profile, dict):
        raise ValueError("No CV profile was provided.")
    questions = list(payload.get("questions") or [])[:MAX_QUESTIONS]
    data = run_claude(
        ["--resume", session_id, "--fork-session", "--tools", "", *ISOLATION, "--disallowedTools", "mcp__*",
         "--json-schema", json.dumps(MAGIC_SCHEMA)],
        magic_prompt(jd=jd, profile=profile, questions=questions, page_url=payload.get("pageUrl") or ""),
        claude_bin=cfg["claudeBin"], cwd=cfg["home"], timeout=MAGIC_TIMEOUT, cancel=cancel,
    )
    out = data["structured_output"]
    tailored = pin_basics(profile, out.get("tailoredProfile") or {})
    return {
        "company": out.get("company", ""),
        "role": out.get("role", ""),
        "tailoredProfile": tailored,
        "changeSummary": out.get("changeSummary") or [],
        "answers": out.get("answers") or [],
        "unverifiedClaims": out.get("unverifiedClaims") or [],
        "truth": truth_check(profile, tailored),
        "forkSessionId": data.get("session_id", ""),
    }


def _fill_field(raw):
    """Keep only what Claude needs from a field descriptor, with bounded text."""
    if not isinstance(raw, dict) or not raw.get("id"):
        return None
    clip = lambda v: str(v or "").strip()[:MAX_FIELD_TEXT]
    field = {"id": clip(raw["id"]), "question": clip(raw.get("question")), "type": clip(raw.get("type")) or "text"}
    for key in ("hint", "placeholder"):
        if raw.get(key):
            field[key] = clip(raw[key])
    options = [clip(o) for o in raw.get("options") or [] if clip(o)][:100]
    if options:
        field["options"] = options
    if isinstance(raw.get("maxLength"), int) and raw["maxLength"] > 0:
        field["maxLength"] = raw["maxLength"]
    if raw.get("required"):
        field["required"] = True
    return field


def magic_fill(payload, cfg, cancel):
    session_id = normalize_session_id(payload.get("sessionId"))
    if not session_id:
        raise ValueError("Session ID must be a UUID like 00000000-0000-4000-8000-000000000000.")
    profile = payload.get("profile")
    if not isinstance(profile, dict):
        raise ValueError("No CV profile was provided.")
    fields = [f for f in map(_fill_field, list(payload.get("fields") or [])[:MAX_FILL_FIELDS]) if f]
    if not fields:
        raise ValueError("No form fields were found to fill.")
    filled = [{"question": str(f.get("question") or "")[:MAX_FIELD_TEXT], "value": str(f.get("value") or "")[:MAX_FIELD_TEXT]}
              for f in list(payload.get("filled") or [])[:MAX_FILL_FIELDS] if isinstance(f, dict)]
    data = run_claude(
        ["--resume", session_id, "--fork-session", "--tools", "", *ISOLATION, "--disallowedTools", "mcp__*",
         "--json-schema", json.dumps(FILL_SCHEMA)],
        fill_prompt(fields=fields, filled=filled, jd=payload.get("jd") or "", profile=profile,
                    page_url=payload.get("pageUrl") or "", page_title=payload.get("pageTitle") or ""),
        claude_bin=cfg["claudeBin"], cwd=cfg["home"], timeout=MAGIC_TIMEOUT, cancel=cancel,
    )
    out = data["structured_output"]
    by_id = {f["id"]: f for f in fields}
    values, seen = [], set()
    for v in out.get("values") or []:
        field = by_id.get(v.get("id"))
        value = str(v.get("value") or "").strip()
        if not field or not value or field["id"] in seen:
            continue  # unknown id, empty answer or duplicate
        if field.get("options"):  # choice fields must name one of the real options
            key = " ".join(value.lower().split())
            value = next((o for o in field["options"] if " ".join(o.lower().split()) == key), None)
            if value is None:
                continue
        if field.get("maxLength"):
            value = value[:field["maxLength"]]
        seen.add(field["id"])
        values.append({"id": field["id"], "value": value, "sensitive": bool(v.get("sensitive"))})
    return {"values": values, "notes": (out.get("notes") or [])[:5], "fieldCount": len(fields)}


HANDLERS = {"import_cv": import_cv, "magic_edit": magic_edit, "capture_design": capture_design, "magic_fill": magic_fill}


def handle(msg, cfg, cancel):
    action = (msg or {}).get("action")
    payload = (msg or {}).get("payload") or {}
    try:
        if action == "ping":
            return ok(ping(cfg))
        if action in HANDLERS:
            cfg["home"].mkdir(parents=True, exist_ok=True)
            return ok(HANDLERS[action](payload, cfg, cancel))
        return err("UNKNOWN_ACTION", f"Unknown action: {action!r}")
    except ClaudeError as exc:
        return err(exc.code, exc.message)
    except ValueError as exc:
        return err("BAD_REQUEST", str(exc))
    except Exception as exc:  # last-resort guard so the extension always gets a reply
        log.exception("action %s failed", action)
        return err("HOST_ERROR", f"{type(exc).__name__}: {exc}")
