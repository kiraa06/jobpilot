(function (root) {
  // Keep in sync with host/jobpilot/schemas.py (guarded by test_js_profile_fields_match_python).
  const BASICS_FIELDS = [
    "firstName", "lastName", "email", "phone", "location", "city", "country",
    "linkedin", "github", "website", "headline", "summary",
    "yearsExperience", "currentCompany", "currentTitle",
    "noticePeriod", "currentCtc", "expectedCtc", "workAuthorization",
  ];
  const LIST_SECTIONS = ["experience", "education", "skills", "projects", "certifications"];

  function emptyProfile() {
    const p = { basics: Object.fromEntries(BASICS_FIELDS.map((f) => [f, ""])) };
    for (const k of LIST_SECTIONS) p[k] = [];
    return p;
  }

  function normalizeProfile(input) {
    const src = input && typeof input === "object" ? input : {};
    const p = emptyProfile();
    p.basics = { ...p.basics, ...(src.basics || {}) };
    for (const k of LIST_SECTIONS) p[k] = Array.isArray(src[k]) ? src[k] : [];
    return p;
  }

  const api = { BASICS_FIELDS, emptyProfile, normalizeProfile };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.JobPilot = root.JobPilot || {}).profile = api;
})(globalThis);
