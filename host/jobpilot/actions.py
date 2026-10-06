import logging
import os

from . import VERSION

log = logging.getLogger("jobpilot")


def ok(data):
    return {"ok": True, "data": data}


def err(code, message):
    return {"ok": False, "error": {"code": code, "message": message}}


def ping(cfg):
    claude_bin = cfg.get("claudeBin")
    return {
        "version": VERSION,
        "claudeBin": claude_bin,
        "claudeFound": bool(claude_bin and os.path.exists(claude_bin)),
    }


def handle(msg, cfg, cancel):
    action = (msg or {}).get("action")
    try:
        if action == "ping":
            return ok(ping(cfg))
        return err("UNKNOWN_ACTION", f"Unknown action: {action!r}")
    except Exception as exc:  # last-resort guard so the extension always gets a reply
        log.exception("action %s failed", action)
        return err("HOST_ERROR", f"{type(exc).__name__}: {exc}")
