(function (root) {
  const JP = (root.JobPilot = root.JobPilot || {});
  const { match, valueFor, pickOption, answerFor, questionText } = JP.matcher;
  const { collectFields, extractJobDescription } = JP.extract;
  const COLORS = { filled: "#22c55e", sensitive: "#f59e0b", unmatched: "#3b82f6" };
  const QUESTION_TYPES = new Set(["text", "textarea", "select", "radio", "number", "url", "contenteditable"]);

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

  // Returns true if the value was written.
  function write(desc, value) {
    if (desc.type === "radio") {
      const optValue = pickOption(desc.options, value);
      const radio = optValue && byId(optValue);
      if (!radio) return false;
      radio.click();
      return radio.checked;
    }
    const el = byId(desc.jpId);
    if (!el) return false;
    if (desc.type === "select") {
      const optValue = pickOption(desc.options, value);
      if (optValue == null) return false;
      setNativeValue(el, optValue);
      return true;
    }
    if (desc.type === "contenteditable") {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return true;
    }
    setNativeValue(el, value);
    return true;
  }

  function autofill({ profile, answers = [], pdf = null }) {
    const report = { filled: 0, sensitive: 0, unmatched: 0, kept: 0, fileFieldFound: false, fileAttached: false, fieldCount: 0 };
    for (const desc of collectFields(document)) {
      report.fieldCount++;
      const el = byId(desc.jpId);
      const m = match(desc);
      if (desc.type === "file") {
        if (m && m.key === "resumeFile") {
          report.fileFieldFound = true;
          if (pdf && attachFile(el, pdf)) { report.fileAttached = true; mark(el, "filled"); }
        }
        continue;
      }
      const ownedByUs = el && el.dataset.jobpilotFilled === "1";
      const userTyped = desc.type !== "radio" && desc.type !== "select" && desc.value && !ownedByUs;
      if (userTyped) { report.kept++; continue; }

      const ans = answerFor(desc, answers);
      const value = ans ? ans.answer : m ? valueFor(m.key, profile) : "";
      const sensitive = ans ? ans.sensitive : !!(m && m.sensitive);
      if (value && write(desc, value)) {
        const target = desc.type === "radio" ? el.closest("fieldset") || el : el;
        if (el) el.dataset.jobpilotFilled = "1";
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
      if (!QUESTION_TYPES.has(desc.type)) continue;
      const m = match(desc);
      const needsAnswer = !m || (m.sensitive && !valueFor(m.key, profile));
      const question = questionText(desc);
      if (needsAnswer && question.length >= 3) {
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

  function selectionText() {
    return String(getSelection() || "").trim();
  }

  JP.content = { scan, autofill, selectionText };
})(globalThis);
