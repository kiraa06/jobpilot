(function (root) {
  // Order matters: specific rules precede generic ones ("last name" before "name").
  const RULES = [
    { key: "middleName", skip: true, re: /\bmiddle name\b/ },
    { key: "firstName", re: /\b(first|given|fore) ?name\b|\bfname\b/ },
    { key: "lastName", re: /\b(last|family|sur) ?name\b|\blname\b/ },
    { key: "email", re: /\be ?mail\b/ },
    { key: "linkedin", re: /\blinked ?in\b/ },
    { key: "github", re: /\bgit ?hub\b/ },
    { key: "website", re: /\b(website|portfolio|personal site|blog)\b/ },
    { key: "phone", re: /\b(phone|mobile|cell|telephone|contact number|whatsapp)\b/ },
    { key: "noticePeriod", sensitive: true, re: /\bnotice period\b|\bearliest start\b|\bavailable to (start|join)\b|\bjoining (time|date)\b/ },
    { key: "expectedCtc", sensitive: true, re: /\b(expected|desired)\b.*\b(ctc|salary|compensation|pay)\b|\bsalary expectations?\b/ },
    { key: "currentCtc", sensitive: true, re: /\b(current|present)\b.*\b(ctc|salary|compensation)\b|\bctc\b/ },
    { key: "workAuthorization", sensitive: true, re: /\bwork authori[sz]ation\b|\bauthori[sz]ed to work\b|\bvisa\b|\bsponsorship\b|\bright to work\b/ },
    { key: "yearsExperience", re: /\b(years|yrs)\b.*\bexperience\b|\btotal experience\b/ },
    { key: "currentCompany", re: /\b(current|present|recent)\b.*\b(company|employer|organi[sz]ation)\b/ },
    { key: "currentTitle", re: /\b(current|present|recent)\b.*\b(title|designation|role|position)\b|\bjob title\b|\bdesignation\b/ },
    { key: "city", re: /\bcity\b|\btown\b/ },
    { key: "country", re: /\bcountry\b/ },
    { key: "location", re: /\blocation\b|\baddress\b|\bwhere are you based\b/ },
    { key: "graduationYear", re: /\bgraduation (year|date)\b|\byear of (passing|graduation)\b/ },
    { key: "university", re: /\b(university|college|school|institution)\b/ },
    { key: "degree", re: /\b(degree|qualification)\b/ },
    { key: "headline", re: /\bheadline\b/ },
    { key: "summary", re: /\b(summary|about (you|yourself)|bio)\b/ },
    { key: "skills", re: /\bskills?\b/ },
    { key: "fullName", re: /\bfull name\b|\byour name\b|\bcandidate name\b|^name\b/ },
  ];
  const SKIP_TYPES = new Set(["checkbox", "password", "hidden", "submit", "button", "reset", "image", "search", "range", "color"]);
  const MAX_RULE_TEXT = 60; // longer labels are questions → Magic Edit answers them
  const PLACEHOLDER_OPTION = /^(select|choose|please select|--|—|none)\b/i;

  function norm(s) {
    return String(s || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function questionText(desc) {
    return desc.label || desc.aria || desc.placeholder || desc.nearby || desc.name || "";
  }

  function match(desc) {
    if (SKIP_TYPES.has(desc.type)) return null;
    if (desc.type === "file") {
      const text = norm([desc.label, desc.aria, desc.name, desc.elId, desc.nearby].join(" "));
      return /\b(resume|cv|curriculum)\b/.test(text) && !/\bcover\b/.test(text)
        ? { key: "resumeFile", confidence: 0.9, sensitive: false } : null;
    }
    const sources = [[desc.label, 0.9], [desc.aria, 0.9], [desc.placeholder, 0.8],
      [desc.name, 0.7], [desc.elId, 0.7], [desc.nearby, 0.6]];
    for (const [raw, confidence] of sources) {
      const text = norm(raw);
      if (!text || text.length > MAX_RULE_TEXT) continue;
      for (const rule of RULES) {
        if (rule.re.test(text)) return rule.skip ? null : { key: rule.key, confidence, sensitive: !!rule.sensitive };
      }
    }
    if (desc.type === "email") return { key: "email", confidence: 0.8, sensitive: false };
    if (desc.type === "tel") return { key: "phone", confidence: 0.8, sensitive: false };
    return null;
  }

  function valueFor(key, profile) {
    const b = profile.basics || {};
    const edu = (profile.education || [])[0] || {};
    const job = (profile.experience || [])[0] || {};
    switch (key) {
      case "fullName": return [b.firstName, b.lastName].filter(Boolean).join(" ");
      case "location": return b.location || [b.city, b.country].filter(Boolean).join(", ");
      case "currentCompany": return b.currentCompany || job.company || "";
      case "currentTitle": return b.currentTitle || job.title || "";
      case "university": return edu.institution || "";
      case "degree": return [edu.degree, edu.field].filter(Boolean).join(", ");
      case "graduationYear": return ((edu.end || "").match(/\d{4}/) || [""])[0];
      case "skills": return (profile.skills || []).flatMap((g) => g.items || []).join(", ");
      default: return b[key] == null ? "" : String(b[key]);
    }
  }

  function pickOption(options, wanted) {
    const w = norm(wanted);
    if (!w) return null;
    const real = options.filter((o) => norm(o.text) && !PLACEHOLDER_OPTION.test(o.text.trim()));
    const exact = real.find((o) => norm(o.text) === w || norm(o.value) === w);
    if (exact) return exact.value;
    const loose = real.find((o) => {
      const t = norm(o.text);
      return t.length >= 2 && (w.includes(t) || t.includes(w));
    });
    return loose ? loose.value : null;
  }

  function answerFor(desc, answers) {
    const q = norm(questionText(desc));
    if (!q) return null;
    const hit = (answers || []).find((a) => {
      const aq = norm(a.question);
      return aq && (aq === q || (aq.length > 8 && (q.includes(aq) || aq.includes(q))));
    });
    return hit && hit.answer ? { answer: hit.answer, sensitive: !!hit.sensitive } : null;
  }

  const api = { norm, match, valueFor, pickOption, answerFor, questionText };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.JobPilot = root.JobPilot || {}).matcher = api;
})(globalThis);
