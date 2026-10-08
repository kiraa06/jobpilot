const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../../extension/lib/template.js");

const FONTS = ["Lato", "Inter"];
const profile = {
  basics: { firstName: "Asha", lastName: "Rao", email: "asha@example.com", phone: "+91 98765 43210",
    city: "Bengaluru", country: "India", linkedin: "linkedin.com/in/asha", summary: "Platform engineer who ships." },
  experience: [
    { company: "Acme Corp", title: "Senior Engineer", location: "Remote", start: "Jan 2021", end: "Present",
      bullets: ["Cut deploy time by 40% with canaries", "Led the <migration> & cleanup"] },
    { company: "Globex", title: "Engineer", start: "2018", end: "", bullets: [] },
  ],
  education: [{ institution: "IIT Madras", degree: "B.Tech", field: "CS", start: "2014", end: "2018", grade: "" }],
  skills: [{ group: "Cloud", items: ["AWS", "Kubernetes"] }],
  projects: [],
  certifications: [{ name: "CKA", issuer: "CNCF", date: "2022" }],
};

const GOOD = `<!doctype html><html><head><style>@page { size: A4; margin: 14mm }
body { font-family: "Lato", sans-serif; color: #1a2b3c } h1 { font-family: Inter; }</style></head><body>
<h1>{{name}}</h1><p>{{#contacts}}<a href="{{href}}">{{value}}</a> {{/contacts}}</p>
{{#hasSummary}}<h2>Summary</h2><p>{{summary}}</p>{{/hasSummary}}
<h2>Experience</h2>{{#experience}}<h3>{{title}} — {{company}}</h3><span>{{dates}}</span>
<ul>{{#bullets}}<li>{{.}}</li>{{/bullets}}</ul>{{^bullets}}<i>no bullets</i>{{/bullets}}{{/experience}}
<h2>Education</h2>{{#education}}<p>{{degree}} {{field}}, {{institution}}</p>{{/education}}
<h2>Skills</h2>{{#skills}}<p><b>{{group}}:</b> {{itemsText}}</p>{{/skills}}
{{#hasProjects}}<h2>Projects</h2>{{/hasProjects}}
<h2>Certifications</h2>{{#certifications}}<p>{{name}} ({{issuer}})</p>{{/certifications}}
</body></html>`;

const textOf = (html) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

test("renders values escaped, lists, string items and inverted sections", () => {
  const html = T.renderTemplate(GOOD, T.viewModel(profile));
  assert.match(html, /<h1>Asha Rao<\/h1>/);
  assert.match(html, /<li>Led the &lt;migration&gt; &amp; cleanup<\/li>/);
  assert.match(html, /<h3>Engineer — Globex<\/h3><span>2018<\/span>\s*<ul><\/ul><i>no bullets<\/i>/);
  assert.match(html, /href="mailto:asha@example.com"/);
  assert.doesNotMatch(html, /Projects/);
});

test("values can't inject tags or break out of attributes", () => {
  const p = structuredClone(profile);
  p.basics.firstName = `"><script>alert(1)</script>`;
  const html = T.renderTemplate(`<p title="{{name}}">{{name}}</p>`, T.viewModel(p));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /title="&quot;&gt;&lt;script&gt;/);
});

test("section with an object pushes it as context; parent values stay reachable", () => {
  const out = T.renderTemplate("{{#job}}{{title}} for {{name}}{{/job}}", { name: "A", job: { title: "Dev" } });
  assert.equal(out, "Dev for A");
});

test("unbalanced tags throw", () => {
  assert.throws(() => T.renderTemplate("{{#experience}}x", {}), /Unclosed/);
  assert.throws(() => T.renderTemplate("x{{/experience}}", {}), /Unexpected/);
});

test("viewModel builds dates without dangling dashes, location fallback and contact hrefs", () => {
  const v = T.viewModel(profile);
  assert.equal(v.experience[0].dates, "Jan 2021 – Present");
  assert.equal(v.experience[1].dates, "2018");
  assert.equal(v.location, "Bengaluru, India");
  assert.deepEqual(v.contacts.map((c) => c.label), ["Email", "Phone", "Location", "LinkedIn"]);
  assert.equal(v.contacts[1].href, "tel:+919876543210");
  assert.equal(v.contacts[3].href, "https://linkedin.com/in/asha");
  assert.equal(v.skills[0].itemsText, "AWS, Kubernetes");
  assert.equal(v.hasProjects, false);
  assert.doesNotThrow(() => T.viewModel(null));
});

test("lint accepts a clean template", () => {
  assert.deepEqual(T.lintTemplate(GOOD, FONTS), []);
});

test("lint rejects unsafe or unsupported constructs", () => {
  const cases = {
    "<script>x</script>": /<script>/,
    '<img alt="me">': /<img>/,
    '<link rel="stylesheet" href="x.css">': /<link>/,
    '<div onclick="x()">': /event handler/,
    '<a href="javascript:alert(1)">': /javascript:/,
    "<style>@import 'x.css';</style>": /@import/,
    "<style>div{background:url(https://evil.test/a.png)}</style>": /network/,
    "<style>@font-face{font-family:X}</style>": /@font-face/,
    '<style>p{font: 12px "Lato"}</style>': /shorthand/,
    "<style>p{font-family: Calibri, sans-serif}</style>": /Calibri/,
    "{{#experience}}": /balance/,
  };
  for (const [snippet, want] of Object.entries(cases)) {
    const t = GOOD.replace("</body>", `${snippet}</body>`);
    assert.ok(T.lintTemplate(t, FONTS).some((p) => want.test(p)), `${snippet} → ${T.lintTemplate(t, FONTS)}`);
  }
  assert.ok(T.lintTemplate(GOOD.replace(/@page[^}]*}/, ""), FONTS).some((p) => /@page/.test(p)));
  assert.ok(T.lintTemplate("x".repeat(101 * 1024) + GOOD, FONTS).some((p) => /100 KB/.test(p)));
  assert.deepEqual(T.lintTemplate("", FONTS), ["The template is empty."]);
});

test("findHardcoded spots CV text typed into the template, ignores headings and slots", () => {
  assert.deepEqual(T.findHardcoded(GOOD, profile), []);
  const bad = GOOD.replace("<h2>Experience</h2>", "<h2>Experience</h2><p>Acme Corp</p><p>Cut deploy time by 40% with canaries</p>");
  assert.deepEqual(T.findHardcoded(bad, profile).sort(), ["Acme Corp", "Cut deploy time by 40% with canaries"]);
});

test("checkCompleteness passes for a full render and lists what a template drops", () => {
  assert.deepEqual(T.checkCompleteness(profile, textOf(T.renderTemplate(GOOD, T.viewModel(profile)))), []);
  const lossy = GOOD.replace("<ul>{{#bullets}}<li>{{.}}</li>{{/bullets}}</ul>", "").replace(/<h2>Skills[\s\S]*?{{\/skills}}/, "");
  const missing = T.checkCompleteness(profile, textOf(T.renderTemplate(lossy, T.viewModel(profile))));
  assert.deepEqual(missing, ["bullet: Cut deploy time by 40% with canaries", "bullet: Led the <migration> & cleanup",
    "skill: AWS", "skill: Kubernetes"]);
});

test("completeness ignores case, whitespace and quote/dash style", () => {
  const p = { basics: { firstName: "Asha" }, experience: [{ company: "O’Neil – Labs", title: "Dev", bullets: [] }] };
  assert.deepEqual(T.checkCompleteness(p, "ASHA\n  o'neil - labs  dev"), []);
});
