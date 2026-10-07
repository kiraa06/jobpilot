"""Deterministic guard: tailored CV may reword, reorder and drop — never invent identity facts."""
import copy
import re

from .schemas import BASICS_FIELDS

FREE_BASICS = {"headline", "summary"}
SECTIONS = (
    ("experience", ("company", "title", "start", "end"), "Role"),
    ("education", ("institution", "degree", "field", "start", "end"), "Education"),
    ("certifications", ("name", "issuer", "date"), "Certification"),
    ("projects", ("name",), "Project"),
)


def _norm(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def truth_check(original, tailored):
    blocking, warnings = [], []
    for section, fields, label in SECTIONS:
        known = {tuple(_norm(e.get(f)) for f in fields) for e in original.get(section) or []}
        for entry in tailored.get(section) or []:
            if tuple(_norm(entry.get(f)) for f in fields) not in known:
                shown = " · ".join(str(entry.get(f)) for f in fields if entry.get(f))
                blocking.append(f"{label} not in your original CV: {shown}")
    known_skills = {_norm(i) for g in original.get("skills") or [] for i in g.get("items") or []}
    seen = set()
    for group in tailored.get("skills") or []:
        for item in group.get("items") or []:
            key = _norm(item)
            if key and key not in known_skills and key not in seen:
                seen.add(key)
                warnings.append(f"New skill: {item}")
    return {"blocking": blocking, "warnings": warnings}


def pin_basics(original, tailored):
    out = copy.deepcopy(tailored)
    src = original.get("basics") or {}
    basics = dict(out.get("basics") or {})
    for field in BASICS_FIELDS:
        if field not in FREE_BASICS:
            basics[field] = src.get(field, "")
    out["basics"] = basics
    return out
