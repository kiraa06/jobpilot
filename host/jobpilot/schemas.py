"""JSON Schemas passed to `claude --json-schema`. Keep BASICS_FIELDS in sync with extension/lib/profile.js."""

BASICS_FIELDS = [
    "firstName", "lastName", "email", "phone", "location", "city", "country",
    "linkedin", "github", "website", "headline", "summary",
    "yearsExperience", "currentCompany", "currentTitle",
    "noticePeriod", "currentCtc", "expectedCtc", "workAuthorization",
]

_STR = {"type": "string"}
_STR_LIST = {"type": "array", "items": _STR}


def _obj(props):
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


def _list_of(props):
    return {"type": "array", "items": _obj(props)}


PROFILE_SCHEMA = _obj({
    "basics": _obj({f: _STR for f in BASICS_FIELDS}),
    "experience": _list_of({"company": _STR, "title": _STR, "location": _STR, "start": _STR, "end": _STR,
                            "bullets": _STR_LIST}),
    "education": _list_of({"institution": _STR, "degree": _STR, "field": _STR, "start": _STR, "end": _STR,
                           "grade": _STR}),
    "skills": _list_of({"group": _STR, "items": _STR_LIST}),
    "projects": _list_of({"name": _STR, "description": _STR, "bullets": _STR_LIST, "link": _STR}),
    "certifications": _list_of({"name": _STR, "issuer": _STR, "date": _STR}),
})

MAGIC_SCHEMA = _obj({
    "company": _STR,
    "role": _STR,
    "tailoredProfile": PROFILE_SCHEMA,
    "changeSummary": _STR_LIST,
    "answers": _list_of({"question": _STR, "answer": _STR, "sensitive": {"type": "boolean"}}),
    "unverifiedClaims": _STR_LIST,
})
