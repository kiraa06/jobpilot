(function (root) {
  const JP = (root.JobPilot = root.JobPilot || {});
  const FIELD_SELECTOR = "input, textarea, select, [contenteditable=''], [contenteditable='true']";
  const JD_SELECTORS = [
    "[data-automation-id='jobPostingDescription']", ".job__description", "#job-description", ".job-description",
    "[class*='jobDescription']", "[class*='job-description']", "[id*='job-description']", ".posting-page",
    "[class*='description']",
  ];
  const SKIP_INPUT_TYPES = new Set(["checkbox", "hidden", "submit", "button", "reset", "image", "password"]);
  const JD_HINT = /responsibilit|requirement|qualification|what you('|’)ll do|about the role|you will/i;
  const MAX_JD = 20000;
  let counter = 0;
  const prefix = Math.random().toString(36).slice(2, 7);

  const clean = (s) => String(s || "").replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim();
  const textOf = (el) => clean(el ? el.innerText || el.textContent : "");

  function visible(el) {
    if (el.type === "file") return true; // styled uploads hide the real input
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0;
  }

  function labelFor(el) {
    const doc = el.ownerDocument;
    if (el.id) {
      const l = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return textOf(l);
    }
    const wrap = el.closest("label");
    if (wrap) {
      const copy = wrap.cloneNode(true);
      copy.querySelectorAll("input, select, textarea").forEach((n) => n.remove());
      return textOf(copy);
    }
    return "";
  }

  function ariaFor(el) {
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)).filter(Boolean).map(textOf).join(" ");
      if (t) return t;
    }
    return clean(el.getAttribute("aria-label"));
  }

  function nearbyFor(el) {
    const legend = el.closest("fieldset")?.querySelector("legend");
    if (legend && (el.type === "radio" || el.type === "checkbox")) return textOf(legend);
    let node = el;
    for (let depth = 0; depth < 3 && node; depth++) {
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.matches(FIELD_SELECTOR) || sib.querySelector(FIELD_SELECTOR)) break;
        const t = textOf(sib);
        if (t && t.length <= 150) return t;
      }
      node = node.parentElement;
    }
    return "";
  }

  function idOf(el) {
    if (!el.dataset.jobpilotId) el.dataset.jobpilotId = `${prefix}-${++counter}`;
    return el.dataset.jobpilotId;
  }

  function describeField(el) {
    const tag = el.tagName.toLowerCase();
    const type = el.isContentEditable && tag !== "input" && tag !== "textarea"
      ? "contenteditable" : tag === "input" ? (el.type || "text").toLowerCase() : tag;
    const options = tag === "select" ? [...el.options].map((o) => ({ value: o.value, text: clean(o.text) })) : [];
    return {
      jpId: idOf(el), tag, type, label: labelFor(el), aria: ariaFor(el), placeholder: clean(el.placeholder),
      name: el.getAttribute("name") || "", elId: el.id || "", nearby: nearbyFor(el), options,
      value: type === "contenteditable" ? textOf(el) : type === "file" ? "" : el.value || "",
      required: !!el.required || el.getAttribute("aria-required") === "true",
    };
  }

  // Radios become one descriptor per group; options are each radio's label.
  function collectFields(doc = document) {
    const out = [];
    const radioGroups = new Map();
    for (const el of doc.querySelectorAll(FIELD_SELECTOR)) {
      if (el.tagName === "INPUT" && SKIP_INPUT_TYPES.has(el.type)) continue; // never touch consents/buttons
      if (el.disabled || el.readOnly || !visible(el)) continue;
      if (el.type === "radio") {
        const key = el.name || idOf(el);
        if (!radioGroups.has(key)) {
          const d = describeField(el);
          d.type = "radio";
          d.label = nearbyFor(el) || d.label;
          d.radios = [];
          d.checked = "";
          radioGroups.set(key, d);
          out.push(d);
        }
        const group = radioGroups.get(key);
        group.radios.push(idOf(el));
        if (el.checked) group.checked = idOf(el);
        group.options.push({ value: idOf(el), text: labelFor(el) || el.value });
        continue;
      }
      out.push(describeField(el));
    }
    return out;
  }

  function htmlToText(html) {
    const spaced = String(html || "").replace(/<(br\s*\/?|\/(p|li|div|h[1-6]|ul|ol|tr|section))>/gi, "$&\n");
    const doc = new DOMParser().parseFromString(spaced, "text/html");
    const text = clean(doc.body.textContent);
    // double-encoded JSON-LD yields escaped tags after the first pass
    return /<\/?(p|li|ul|br|div|strong)\b/i.test(text) && text !== clean(html) ? htmlToText(text) : text;
  }

  function findJobPosting(node) {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) return node.map(findJobPosting).find(Boolean) || null;
    const type = [].concat(node["@type"] || []);
    if (type.includes("JobPosting")) return node;
    return findJobPosting(node["@graph"]);
  }

  function extractJobDescription(doc = document) {
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const job = findJobPosting(JSON.parse(s.textContent));
        if (job && job.description) {
          return { text: htmlToText(job.description), source: "jsonld", title: clean(job.title),
            company: clean(job.hiringOrganization && job.hiringOrganization.name) };
        }
      } catch (_) { /* malformed JSON-LD is common; ignore */ }
    }
    const meta = {
      title: textOf(doc.querySelector("h1")) || clean(doc.title),
      company: clean(doc.querySelector('meta[property="og:site_name"]')?.content),
    };
    const smallest = (sel) => {
      let pick = "";
      for (const el of doc.querySelectorAll(sel)) {
        const t = textOf(el);
        if (t.length >= 300 && t.length <= MAX_JD && (!pick || t.length < pick.length)) pick = t;
      }
      return pick;
    };
    for (const sel of JD_SELECTORS) {
      const t = smallest(sel);
      if (t) return { text: t, source: "selector", ...meta };
    }
    const main = smallest("main, article, [role='main']");
    if (main) return { text: main, source: "main", ...meta };
    const body = textOf(doc.body);
    if (body.length >= 300 && body.length <= 40000 && JD_HINT.test(body)) return { text: body, source: "body", ...meta };
    return { text: "", source: "none", ...meta };
  }

  JP.extract = { htmlToText, collectFields, describeField, extractJobDescription, FIELD_SELECTOR };
})(globalThis);
