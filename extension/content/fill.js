(function (root) {
  const JP = (root.JobPilot = root.JobPilot || {});
  const { match, valueFor, pickOption, answerFor, questionText, isPlaceholderOption } = JP.matcher;
  const { collectFields, extractJobDescription } = JP.extract;
  const COLORS = { filled: "#22c55e", sensitive: "#f59e0b", unmatched: "#3b82f6" };
  const QUESTION_TYPES = new Set(["text", "textarea", "select", "radio", "number", "url", "contenteditable"]);

  // One predicate for "this field is a question for Claude": scan() sends exactly these,
  // and autofill() consults Claude's answers only for these.
  const isQuestionField = (desc, m, profile) =>
    QUESTION_TYPES.has(desc.type) && (!m || (m.sensitive && !valueFor(m.key, profile)));

  const byId = (id) => document.querySelector(`[data-jobpilot-id="${id}"]`);

  function mark(el, kind) {
    el.style.outline = `2px ${kind === "unmatched" ? "dashed" : "solid"} ${COLORS[kind]}`;
    el.style.outlineOffset = "2px";
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value); // bypasses React's value tracker
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  }

  function attachFile(el, pdf) {
    const file = new File([JP.util.base64ToBytes(pdf.base64)], pdf.name, { type: "application/pdf" });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.files.length === 1;
  }

  // Returns true if the value was written. exact: choices must match an option exactly.
  function write(desc, value, { exact = false } = {}) {
    if (desc.type === "radio") {
      const optValue = pickOption(desc.options, value, { exact });
      const radio = optValue && byId(optValue);
      if (!radio) return false;
      radio.click();
      if (!radio.checked) return false;
      const first = byId(desc.jpId);
      if (first) first.dataset.jobpilotFilled = optValue;
      return true;
    }
    const el = byId(desc.jpId);
    if (!el) return false;
    if (desc.type === "select") {
      const optValue = pickOption(desc.options, value, { exact });
      if (optValue == null) return false;
      setNativeValue(el, optValue);
      el.dataset.jobpilotFilled = optValue;
      return true;
    }
    if (desc.type === "contenteditable") {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      el.dataset.jobpilotFilled = el.textContent;
      return true;
    }
    setNativeValue(el, value);
    el.dataset.jobpilotFilled = el.value;
    return true;
  }

  // A field is ours only while its state still equals what we last wrote; anything else non-empty is the user's.
  function isUserSet(desc, el) {
    const written = el && el.dataset.jobpilotFilled;
    if (desc.type === "radio") return !!desc.checked && !(written !== undefined && desc.checked === written);
    const ownedByUs = written !== undefined && desc.value === written;
    if (desc.type === "select") {
      const cur = desc.options.find((o) => o.value === desc.value);
      return !!desc.value && !!cur && !isPlaceholderOption(cur.text) && !ownedByUs;
    }
    return !!desc.value && !ownedByUs;
  }

  function currentText(desc) {
    if (desc.type === "radio") return (desc.options.find((o) => o.value === desc.checked) || {}).text || "";
    if (desc.type === "select") return (desc.options.find((o) => o.value === desc.value) || {}).text || "";
    return desc.value;
  }

  // Resume upload fields get the PDF unless the user attached their own file.
  function handleFile(desc, el, pdf, report) {
    const m = match(desc);
    if (!m || m.key !== "resumeFile") return;
    report.fileFieldFound = true;
    const ours = el.files.length === 1 && el.files[0].name === el.dataset.jobpilotFile;
    if (el.files.length > 0 && !ours) { report.kept++; return; } // user's own file
    if (pdf && attachFile(el, pdf)) {
      el.dataset.jobpilotFile = pdf.name;
      report.fileAttached = true;
      mark(el, "filled");
    }
  }

  function autofill({ profile, answers = [], pdf = null }) {
    const report = { filled: 0, sensitive: 0, unmatched: 0, kept: 0, fileFieldFound: false, fileAttached: false, fieldCount: 0 };
    for (const desc of collectFields(document)) {
      report.fieldCount++;
      const el = byId(desc.jpId);
      const m = match(desc);
      if (desc.type === "file") { handleFile(desc, el, pdf, report); continue; }
      if (isUserSet(desc, el)) { report.kept++; continue; }

      const ans = isQuestionField(desc, m, profile) ? answerFor(desc, answers) : null;
      const value = ans ? ans.answer : m ? valueFor(m.key, profile) : "";
      const sensitive = ans ? ans.sensitive : !!(m && m.sensitive);
      // A sensitive choice filled from free profile text (not a Claude answer) needs an exact option.
      if (value && write(desc, value, { exact: !ans && sensitive })) {
        const target = desc.type === "radio" ? el.closest("fieldset") || el : el;
        mark(target, sensitive ? "sensitive" : "filled");
        report.filled++;
        if (sensitive) report.sensitive++;
      } else if (QUESTION_TYPES.has(desc.type)) {
        if (el) mark(el, "unmatched");
        report.unmatched++;
      }
    }
    return report;
  }

  function scan({ profile }) {
    const fields = collectFields(document);
    const questions = [];
    for (const desc of fields) {
      if (!isQuestionField(desc, match(desc), profile)) continue;
      const question = questionText(desc);
      if (question.length >= 3) {
        questions.push({ question, type: desc.type, options: desc.options.map((o) => o.text).filter(Boolean) });
      }
    }
    const jd = window === window.top ? extractJobDescription(document) : null;
    return {
      jd: jd && jd.text ? { text: jd.text, source: jd.source } : null,
      title: jd ? jd.title : "",
      company: jd ? jd.company : "",
      questions,
      fieldCount: fields.length,
    };
  }

  const FILL_TYPES = new Set([...QUESTION_TYPES, "email", "tel", "date", "month", "week", "time", "search"]);

  // Every field Claude could fill, plus what the user already typed (as context).
  function formFields() {
    const fields = [];
    const filled = [];
    for (const desc of collectFields(document)) {
      if (!FILL_TYPES.has(desc.type)) continue;
      const el = byId(desc.jpId);
      const question = questionText(desc).slice(0, 300);
      if (isUserSet(desc, el)) { filled.push({ question, value: currentText(desc).slice(0, 300) }); continue; }
      const hint = [desc.nearby, desc.aria].find((t) => t && t !== question) || "";
      const options = desc.options.map((o) => o.text).filter((t) => t && !isPlaceholderOption(t));
      const maxLength = el && el.maxLength > 0 ? el.maxLength : undefined;
      fields.push({ id: desc.jpId, question, hint, placeholder: desc.placeholder !== question ? desc.placeholder : "",
        type: desc.type, options, maxLength, required: desc.required });
    }
    const jd = window === window.top ? extractJobDescription(document) : null;
    return { fields, filled, jd: jd && jd.text ? jd.text : "", title: window === window.top ? document.title : "" };
  }

  // values: [{id, value, sensitive}] from Claude. Only those ids are touched; user input is kept.
  function fillValues({ values = [], pdf = null }) {
    const report = { filled: 0, sensitive: 0, unmatched: 0, kept: 0, fileFieldFound: false, fileAttached: false, fieldCount: 0 };
    const byField = new Map(values.map((v) => [v.id, v]));
    for (const desc of collectFields(document)) {
      report.fieldCount++;
      const el = byId(desc.jpId);
      if (desc.type === "file") { handleFile(desc, el, pdf, report); continue; }
      if (!FILL_TYPES.has(desc.type)) continue;
      if (isUserSet(desc, el)) { report.kept++; continue; }
      const v = byField.get(desc.jpId);
      if (v && write(desc, v.value)) {
        const target = desc.type === "radio" ? el.closest("fieldset") || el : el;
        mark(target, v.sensitive ? "sensitive" : "filled");
        report.filled++;
        if (v.sensitive) report.sensitive++;
      } else {
        if (el) mark(el, "unmatched");
        report.unmatched++;
      }
    }
    return report;
  }

  function selectionText() {
    return String(getSelection() || "").trim();
  }

  JP.content = { scan, autofill, formFields, fillValues, selectionText };
})(globalThis);
