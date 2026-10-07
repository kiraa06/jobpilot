import base64
import binascii
import json
import logging
import os
import re
import uuid

from . import VERSION
from .claude_runner import ClaudeError, run_claude
from .prompts import import_prompt, magic_prompt
from .schemas import MAGIC_SCHEMA, PROFILE_SCHEMA
from .truth import pin_basics, truth_check

log = logging.getLogger("jobpilot")

IMPORT_TIMEOUT = 120
MAGIC_TIMEOUT = 180
MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_QUESTIONS = 40
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


def import_cv(payload, cfg, cancel):
    try:
        pdf = base64.b64decode(payload.get("pdfBase64") or "", validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("The CV upload was not valid base64.")
    if not pdf.startswith(b"%PDF"):
        raise ValueError("That file isn't a PDF.")
    if len(pdf) > MAX_PDF_BYTES:
        raise ValueError("That PDF is over 10 MB.")
    imports = cfg["home"] / "imports"
    imports.mkdir(parents=True, exist_ok=True)
    path = imports / f"cv-{uuid.uuid4().hex}.pdf"
    path.write_bytes(pdf)
    try:
        data = run_claude(
            ["--tools", "Read", "--allowedTools", f"Read({imports}/**)", "--add-dir", str(imports),
             *ISOLATION, "--json-schema", json.dumps(PROFILE_SCHEMA)],
            import_prompt(str(path)),
            claude_bin=cfg["claudeBin"], cwd=cfg["home"], timeout=IMPORT_TIMEOUT, cancel=cancel,
        )
    finally:
        path.unlink(missing_ok=True)
    return {"profile": data["structured_output"]}


def magic_edit(payload, cfg, cancel):
    session_id = normalize_session_id(payload.get("sessionId"))
    if not session_id:
        raise ValueError("Session ID must be a UUID like f6c115bd-98ae-4b8e-8a2e-7b54b5580e52.")
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


HANDLERS = {"import_cv": import_cv, "magic_edit": magic_edit}


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
