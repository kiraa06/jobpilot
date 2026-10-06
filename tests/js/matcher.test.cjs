const test = require("node:test");
const assert = require("node:assert/strict");
const { match, valueFor, pickOption, answerFor } = require("../../extension/lib/matcher.js");
const { normalizeProfile } = require("../../extension/lib/profile.js");

const d = (over) => ({ jpId: "x", tag: "input", type: "text", label: "", aria: "", placeholder: "",
  name: "", elId: "", nearby: "", options: [], value: "", required: false, ...over });

const cases = [
  [{ label: "First Name *" }, "firstName"],
  [{ name: "first_name" }, "firstName"],
  [{ elId: "givenName" }, "firstName"],
  [{ label: "Last name" }, "lastName"],
  [{ label: "Full name" }, "fullName"],
  [{ label: "Name" }, "fullName"],
  [{ label: "Email address" }, "email"],
  [{ type: "email" }, "email"],
  [{ label: "Mobile number" }, "phone"],
  [{ type: "tel" }, "phone"],
  [{ label: "LinkedIn Profile URL" }, "linkedin"],
  [{ placeholder: "https://github.com/you" }, "github"],
  [{ label: "Portfolio / Website" }, "website"],
  [{ label: "Notice Period (in days)" }, "noticePeriod"],
  [{ label: "Expected CTC" }, "expectedCtc"],
  [{ label: "Current CTC" }, "currentCtc"],
  [{ label: "Will you now or in the future require visa sponsorship?" }, "workAuthorization"],
  [{ label: "Total years of experience" }, "yearsExperience"],
  [{ label: "Current company" }, "currentCompany"],
  [{ label: "Current designation" }, "currentTitle"],
  [{ label: "City" }, "city"],
  [{ label: "Current location" }, "location"],
  [{ label: "University" }, "university"],
  [{ type: "file", label: "Resume/CV" }, "resumeFile"],
  [{ aria: "Last Name", name: "first" }, "lastName"],
];
for (const [over, key] of cases) {
  test(`matches ${JSON.stringify(over)} → ${key}`, () => assert.equal(match(d(over))?.key, key));
}

test("company name is not the candidate's name", () => assert.equal(match(d({ label: "Company name" })), null));
test("middle name is never filled", () => assert.equal(match(d({ label: "Middle name" })), null));
test("long free-text questions are left for Magic Edit",
  () => assert.equal(match(d({ tag: "textarea", label: "Describe a time you used your skills to resolve a production outage at scale" })), null));
test("checkboxes, passwords and hidden fields are skipped", () => {
  for (const type of ["checkbox", "password", "hidden", "submit", "search"]) assert.equal(match(d({ type, label: "Email" })), null);
});
test("cover letter upload is not the resume field", () => assert.equal(match(d({ type: "file", label: "Cover letter" })), null));
test("sensitive flag is set for CTC", () => assert.equal(match(d({ label: "Expected CTC" })).sensitive, true));

const profile = normalizeProfile({
  basics: { firstName: "Asha", lastName: "Verma", city: "Bengaluru", country: "India" },
  experience: [{ company: "Acme Corp", title: "Senior DevOps Engineer", start: "2021", end: "Present", bullets: [] }],
  education: [{ institution: "NIT Calicut", degree: "B.Tech", field: "CSE", end: "May 2016" }],
  skills: [{ group: "Cloud", items: ["AWS", "Kubernetes"] }],
});
test("valueFor derives composite values", () => {
  assert.equal(valueFor("fullName", profile), "Asha Verma");
  assert.equal(valueFor("location", profile), "Bengaluru, India");
  assert.equal(valueFor("currentCompany", profile), "Acme Corp");
  assert.equal(valueFor("currentTitle", profile), "Senior DevOps Engineer");
  assert.equal(valueFor("degree", profile), "B.Tech, CSE");
  assert.equal(valueFor("graduationYear", profile), "2016");
  assert.equal(valueFor("skills", profile), "AWS, Kubernetes");
  assert.equal(valueFor("email", profile), "");
});

test("pickOption matches text loosely and ignores placeholders", () => {
  const opts = [{ value: "", text: "Select…" }, { value: "in", text: "India" }, { value: "us", text: "United States" }];
  assert.equal(pickOption(opts, "india"), "in");
  assert.equal(pickOption(opts, "Bengaluru, India"), "in");
  assert.equal(pickOption(opts, "Germany"), null);
  assert.equal(pickOption(opts, ""), null);
});

test("answerFor matches question text", () => {
  const answers = [{ question: "Why do you want to join Initech?", answer: "Because…", sensitive: false }];
  assert.equal(answerFor(d({ label: "Why do you want to join Initech? *" }), answers).answer, "Because…");
  assert.equal(answerFor(d({ label: "Anything else?" }), answers), null);
  assert.equal(answerFor(d({ label: "Notice" }), [{ question: "Notice", answer: "", sensitive: true }]), null);
});
