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

test("pickOption uses whole-token matching", () => {
  const yn = [{ value: "y", text: "Yes" }, { value: "n", text: "No" }];
  assert.equal(pickOption(yn, "Notice"), null);
  assert.equal(pickOption(yn, "Not applicable"), null);
  const mf = [{ value: "m", text: "Male" }, { value: "f", text: "Female" }];
  assert.equal(pickOption(mf, "female"), "f");
  assert.equal(pickOption([{ value: "m", text: "Male" }], "female"), null);
});

test("third-party contact fields are never matched", () => {
  for (const label of ["Emergency contact phone", "Hiring manager email", "Reference email",
    "Name of your manager", "Company website", "Phone type"]) {
    assert.equal(match(d({ label })), null, label);
  }
  assert.equal(match(d({ label: "Name" })).key, "fullName");
  assert.equal(match(d({ label: "Full name" })).key, "fullName");
});

test("yearsExperience only matches total experience", () => {
  assert.equal(match(d({ label: "Years of experience with Kubernetes" })), null);
  assert.equal(match(d({ label: "How many years of experience do you have in Python?" })), null);
  assert.equal(match(d({ label: "Years of experience" })).key, "yearsExperience");
  assert.equal(match(d({ label: "Total years of experience" })).key, "yearsExperience");
});

test("answerFor never gives a long question's answer to a short standard label", () => {
  const answers = [
    { question: "Which city would you be willing to relocate to?", answer: "Pune", sensitive: false },
    { question: "May we contact you by phone or email about future openings?", answer: "Yes", sensitive: false },
  ];
  for (const label of ["City", "Phone", "Email", "City *"]) assert.equal(answerFor(d({ label }), answers), null, label);
  assert.equal(answerFor(d({ label: "Which city would you be willing to relocate to? *" }), answers).answer, "Pune");
});

test("answerFor containment needs comparable lengths", () => {
  const answers = [{ question: "Why do you want to join Initech and what do you bring?", answer: "Because", sensitive: false }];
  assert.equal(answerFor(d({ label: "Why do you want to join" }), answers), null);
  const close = [{ question: "Why do you want to join Initech", answer: "Because", sensitive: false }];
  assert.equal(answerFor(d({ label: "Why do you want to join Initech today" }), close).answer, "Because");
});

test("pickOption exact mode refuses token-loose matches", () => {
  const yn = [{ value: "", text: "Select…" }, { value: "y", text: "Yes" }, { value: "n", text: "No" }];
  assert.equal(pickOption(yn, "Yes - authorized to work in India"), "y", "loose mode still matches");
  assert.equal(pickOption(yn, "Yes - authorized to work in India", { exact: true }), null);
  assert.equal(pickOption(yn, "yes", { exact: true }), "y");
  assert.equal(pickOption(yn, "No thanks", { exact: true }), null);
  assert.equal(pickOption([{ value: "IN", text: "India" }], "in", { exact: true }), "IN");
});
