(function (root) {
  // A captured CV design: a full HTML document using a small Mustache subset.
  //   {{path}}  escaped value      {{#path}}…{{/path}}  list / truthy section
  //   {{.}}     current item       {{^path}}…{{/path}}  inverted section
  // There is deliberately no unescaped form: CV text can never become markup.

  const MAX_TEMPLATE_BYTES = 100 * 1024;
  const GENERIC_FAMILIES = ["serif", "sans-serif", "monospace", "system-ui", "cursive", "fantasy",
    "ui-serif", "ui-sans-serif", "ui-monospace", "inherit", "initial", "unset"];

  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

  function parse(src) {
    const rootNode = { children: [] };
    const stack = [rootNode];
    const re = /\{\{\s*([#^/]?)\s*([\w.]+|\.)\s*\}\}/g;
    let last = 0;
    let m;
    while ((m = re.exec(src))) {
      const top = stack[stack.length - 1];
      if (m.index > last) top.children.push({ text: src.slice(last, m.index) });
      last = re.lastIndex;
      const [, sigil, name] = m;
      if (sigil === "#" || sigil === "^") {
        const node = { section: name, inverted: sigil === "^", children: [] };
        top.children.push(node);
        stack.push(node);
      } else if (sigil === "/") {
        if (stack.length === 1 || top.section !== name) throw new Error(`Unexpected {{/${name}}}`);
        stack.pop();
      } else {
        top.children.push({ name });
      }
    }
    if (stack.length > 1) throw new Error(`Unclosed {{#${stack[stack.length - 1].section}}}`);
    if (last < src.length) rootNode.children.push({ text: src.slice(last) });
    return rootNode;
  }

  function lookup(stack, name) {
    if (name === ".") return stack[stack.length - 1];
    const [head, ...rest] = name.split(".");
    for (let i = stack.length - 1; i >= 0; i--) {
      const ctx = stack[i];
      if (ctx && typeof ctx === "object" && head in ctx) {
        return rest.reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), ctx[head]);
      }
    }
    return undefined;
  }

  const isEmpty = (v) => v === undefined || v === null || v === false || v === "" || (Array.isArray(v) && v.length === 0);

  function renderNodes(nodes, stack) {
    let out = "";
    for (const n of nodes) {
      if ("text" in n) out += n.text;
      else if ("name" in n) {
        const v = lookup(stack, n.name);
        if (!isEmpty(v) && typeof v !== "object") out += escapeHtml(v);
      } else {
        const v = lookup(stack, n.section);
        if (n.inverted) { if (isEmpty(v)) out += renderNodes(n.children, stack); }
        else if (Array.isArray(v)) for (const item of v) out += renderNodes(n.children, [...stack, item]);
        else if (!isEmpty(v)) out += renderNodes(n.children, typeof v === "object" ? [...stack, v] : stack);
      }
    }
    return out;
  }

  function renderTemplate(template, view) {
    return renderNodes(parse(template).children, [view]);
  }

  const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const cleanList = (xs) => (Array.isArray(xs) ? xs.map(clean).filter(Boolean) : []);
  const dates = (start, end) => [clean(start), clean(end)].filter(Boolean).join(" – ");
  const webHref = (v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`);

  function viewModel(profile) {
    const p = profile && typeof profile === "object" ? profile : {};
    const b = p.basics || {};
    const s = (k) => clean(b[k]);
    const location = s("location") || [s("city"), s("country")].filter(Boolean).join(", ");
    const contacts = [
      ["Email", s("email"), (v) => `mailto:${v}`],
      ["Phone", s("phone"), (v) => `tel:${v.replace(/[^\d+]/g, "")}`],
      ["Location", location, () => ""],
      ["LinkedIn", s("linkedin"), webHref],
      ["GitHub", s("github"), webHref],
      ["Website", s("website"), webHref],
    ].filter(([, v]) => v).map(([label, value, href]) => ({ label, value, href: href(value) }));
    const list = (k) => (Array.isArray(p[k]) ? p[k].filter((x) => x && typeof x === "object") : []);

    const experience = list("experience").map((e) => ({
      company: clean(e.company), title: clean(e.title), location: clean(e.location),
      start: clean(e.start), end: clean(e.end), dates: dates(e.start, e.end), bullets: cleanList(e.bullets),
    }));
    const education = list("education").map((e) => ({
      institution: clean(e.institution), degree: clean(e.degree), field: clean(e.field),
      start: clean(e.start), end: clean(e.end), dates: dates(e.start, e.end), grade: clean(e.grade),
    }));
    const skills = list("skills").map((g) => {
      const items = cleanList(g.items);
      return { group: clean(g.group), items, itemsText: items.join(", ") };
    });
    const projects = list("projects").map((x) => ({
      name: clean(x.name), description: clean(x.description), link: clean(x.link), bullets: cleanList(x.bullets),
    }));
    const certifications = list("certifications").map((c) => ({
      name: clean(c.name), issuer: clean(c.issuer), date: clean(c.date),
    }));
    return {
      name: [s("firstName"), s("lastName")].filter(Boolean).join(" "),
      firstName: s("firstName"), lastName: s("lastName"),
      headline: s("headline"), summary: s("summary"),
      email: s("email"), phone: s("phone"), location,
      linkedin: s("linkedin"), github: s("github"), website: s("website"),
      contacts, experience, education, skills, projects, certifications,
      hasSummary: !!s("summary"), hasExperience: experience.length > 0, hasEducation: education.length > 0,
      hasSkills: skills.length > 0, hasProjects: projects.length > 0, hasCertifications: certifications.length > 0,
    };
  }

  function fontFamilies(css) {
    const names = [];
    for (const m of css.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
      for (const part of m[1].split(",")) {
        const name = part.replace(/!important/i, "").trim().replace(/^["']|["']$/g, "").trim();
        if (name) names.push(name);
      }
    }
    return names;
  }

  // Returns a list of problems; an empty list means the template is safe to render.
  function lintTemplate(template, allowedFonts = []) {
    const problems = [];
    if (typeof template !== "string" || !template.trim()) return ["The template is empty."];
    if (new Blob([template]).size > MAX_TEMPLATE_BYTES) problems.push("The template is over 100 KB.");
    try { parse(template); } catch (e) { problems.push(`Template tags don't balance: ${e.message}.`); }
    const tag = /<\s*(script|iframe|frame|frameset|object|embed|link|base|img|image|picture|video|audio|source|form|input|button|textarea|select|portal)\b/i.exec(template);
    if (tag) problems.push(`Uses a <${tag[1].toLowerCase()}> element, which isn't allowed.`);
    if (/<meta[^>]+http-equiv/i.test(template)) problems.push("Uses <meta http-equiv>, which isn't allowed.");
    if (/\son[a-z]+\s*=/i.test(template)) problems.push("Uses an inline event handler (on…=).");
    if (/javascript\s*:/i.test(template)) problems.push("Uses a javascript: URL.");
    if (/@import/i.test(template)) problems.push("Uses @import.");
    if (/@font-face/i.test(template)) problems.push("Declares its own @font-face; only the bundled fonts may be used.");
    if (/url\(\s*["']?\s*(https?:|\/\/|file:|chrome)/i.test(template)) problems.push("Loads something from the network via url().");
    if (/\s(src|srcset|xlink:href|action|formaction|data)\s*=/i.test(template)) problems.push("Uses a src/data attribute.");
    if (/(^|[\s;{])font\s*:/i.test(template.replace(/font-[a-z-]+\s*:/gi, ""))) {
      problems.push("Uses the `font:` shorthand; use font-family/font-size/font-weight instead.");
    }
    if (!/@page\b/i.test(template)) problems.push("Has no @page rule (page size and margins).");
    const allowed = new Set([...allowedFonts, ...GENERIC_FAMILIES].map((f) => f.toLowerCase()));
    const bad = [...new Set(fontFamilies(template).filter((f) => !allowed.has(f.toLowerCase())))];
    if (bad.length) problems.push(`Uses fonts that aren't bundled: ${bad.join(", ")}.`);
    return problems;
  }

  const norm = (s) => String(s ?? "").normalize("NFKC").toLowerCase()
    .replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—‒−]/g, "-")
    .replace(/\s+/g, " ").trim();

  function contentItems(view) {
    const items = [];
    const add = (kind, v) => { if (clean(v)) items.push({ kind, text: clean(v) }); };
    add("name", view.name);
    for (const e of view.experience) { add("company", e.company); add("title", e.title); e.bullets.forEach((b) => add("bullet", b)); }
    for (const e of view.education) { add("institution", e.institution); add("degree", e.degree); }
    for (const x of view.projects) { add("project", x.name); x.bullets.forEach((b) => add("bullet", b)); }
    for (const c of view.certifications) add("certification", c.name);
    for (const g of view.skills) g.items.forEach((i) => add("skill", i));
    return items;
  }

  // CV text copied into the template itself (instead of a slot) would survive every tailoring untouched.
  function findHardcoded(template, profile) {
    const view = viewModel(profile);
    const visible = norm(String(template)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/\{\{[^}]*\}\}/g, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/g, "&").replace(/&nbsp;/g, " "));
    const candidates = [
      ...contentItems(view).filter((i) => i.kind !== "skill"),
      { kind: "email", text: view.email }, { kind: "phone", text: view.phone }, { kind: "summary", text: view.summary },
    ];
    const found = candidates.filter((c) => norm(c.text).length >= 6 && visible.includes(norm(c.text)));
    return [...new Set(found.map((c) => c.text))];
  }

  // Every piece of CV content must appear in the rendered document's text.
  function checkCompleteness(profile, renderedText) {
    const text = norm(renderedText);
    const missing = contentItems(viewModel(profile)).filter((i) => !text.includes(norm(i.text)));
    return missing.map((i) => `${i.kind}: ${i.text.length > 60 ? `${i.text.slice(0, 57)}…` : i.text}`);
  }

  const api = { renderTemplate, viewModel, lintTemplate, findHardcoded, checkCompleteness, escapeHtml, fontFamilies };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.JobPilot = root.JobPilot || {}).template = api;
})(globalThis);
