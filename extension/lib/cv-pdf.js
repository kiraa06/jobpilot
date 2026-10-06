(function (root) {
  const PAGE = [595.28, 841.89]; // A4 in points
  const MARGIN = 48;
  const WIDTH = PAGE[0] - MARGIN * 2;
  const INK = [0.09, 0.09, 0.13];
  const MUTED = [0.38, 0.4, 0.46];
  const ACCENT = [0.31, 0.27, 0.9]; // indigo-600

  function sanitize(s) {
    return String(s || "")
      .replace(/[\u{1F000}-\u{1FFFF}\u{FE0F}\u{200D}]/gu, "")
      .replace(/[\u0000-\u0008\u000B-\u001F]/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function fitText(text, font, size, maxWidth) {
    const sanitized = sanitize(text);
    if (font.widthOfTextAtSize(sanitized, size) <= maxWidth) return sanitized;
    let cut = sanitized.length - 1;
    while (cut > 0 && font.widthOfTextAtSize(sanitized.slice(0, cut) + "…", size) > maxWidth) cut--;
    return sanitized.slice(0, cut) + "…";
  }

  function wrapText(text, font, size, maxWidth, fontKitFont = null) {
    const lines = [];
    for (const para of sanitize(text).split(/\n+/)) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue; }
        if (line) lines.push(line);
        line = "";
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > maxWidth) {
          let cut = rest.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
          lines.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        line = rest;
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  async function render(profile, { PDFLib, fontkit, fonts }) {
    const { PDFDocument, rgb } = PDFLib;
    const color = (c) => rgb(c[0], c[1], c[2]);
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const regular = await doc.embedFont(fonts.regular, { subset: true });
    const bold = await doc.embedFont(fonts.bold, { subset: true });
    const regularFontkit = fontkit.create(fonts.regular);
    const boldFontkit = fontkit.create(fonts.bold);

    const filterGlyphs = (text, font) => {
      return [...text].filter(c => font.hasGlyphForCodePoint(c.charCodeAt(0))).join("");
    };

    const b = profile.basics;
    doc.setTitle(sanitize(`${b.firstName} ${b.lastName} — CV`));
    let page = doc.addPage(PAGE);
    let y = PAGE[1] - MARGIN;

    const ensure = (h) => { if (y - h < MARGIN) { page = doc.addPage(PAGE); y = PAGE[1] - MARGIN; } };
    const text = (t, x, size, font, c = INK, fontKitFont = null) => {
      let s = sanitize(t);
      if (fontKitFont) s = filterGlyphs(s, fontKitFont);
      page.drawText(s, { x, y, size, font, color: color(c) });
    };
    const para = (t, size, font, c = INK, indent = 0, lead = 1.35, fontKitFont = null) => {
      for (const line of wrapText(t, font, size, WIDTH - indent, fontKitFont)) {
        ensure(size * lead);
        y -= size * lead;
        text(line, MARGIN + indent, size, font, c, fontKitFont);
      }
    };
    const rightText = (t, size, c = MUTED) => {
      const s = fitText(t, regular, size, WIDTH * 0.45);
      page.drawText(filterGlyphs(s, regularFontkit), { x: PAGE[0] - MARGIN - regular.widthOfTextAtSize(s, size), y, size, font: regular, color: color(c) });
    };
    const section = (title) => {
      ensure(40);
      y -= 18;
      text(title.toUpperCase(), MARGIN, 10, bold, ACCENT);
      y -= 5;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE[0] - MARGIN, y }, thickness: 0.6, color: color(ACCENT) });
      y -= 2;
    };
    const bullets = (items) => {
      for (const item of items || []) {
        const lines = wrapText(item, regular, 9.5, WIDTH - 12, regularFontkit);
        lines.forEach((line, i) => {
          ensure(13);
          y -= 13;
          if (i === 0) text("•", MARGIN + 2, 9.5, regular, MUTED);
          text(line, MARGIN + 12, 9.5, regular, INK, regularFontkit);
        });
      }
    };
    const dates = (e) => [e.start, e.end].filter(Boolean).join(" – ");

    // Header
    const nameLines = wrapText(`${b.firstName} ${b.lastName}`.trim(), bold, 22, WIDTH, boldFontkit);
    for (const line of nameLines) {
      ensure(22 * 1.2);
      y -= 22 * 1.2;
      text(line, MARGIN, 22, bold, INK, boldFontkit);
    }
    if (b.headline) para(b.headline, 11, regular, ACCENT, 0, 1.35, regularFontkit);
    const contact = [b.email, b.phone, b.location || [b.city, b.country].filter(Boolean).join(", "), b.linkedin, b.github, b.website]
      .filter(Boolean).join("  ·  ");
    if (contact) para(contact, 9, regular, MUTED, 0, 1.35, regularFontkit);

    if (b.summary) { section("Summary"); para(b.summary, 10, regular); }

    if (profile.experience.length) {
      section("Experience");
      for (const e of profile.experience) {
        ensure(40);
        y -= 15;
        const dateStr = dates(e);
        const dateWidth = bold.widthOfTextAtSize(dateStr, 9);
        rightText(dateStr, 9);
        const titleFitted = fitText(e.title, bold, 10.5, WIDTH - dateWidth - 12);
        text(titleFitted, MARGIN, 10.5, bold, INK, boldFontkit);
        para([e.company, e.location].filter(Boolean).join(" · "), 9.5, regular, MUTED, 0, 1.3, regularFontkit);
        bullets(e.bullets);
        y -= 3;
      }
    }

    if (profile.skills.length) {
      section("Skills");
      for (const g of profile.skills) para(`${g.group}: ${(g.items || []).join(", ")}`, 9.5, regular, INK, 0, 1.35, regularFontkit);
    }

    if (profile.projects.length) {
      section("Projects");
      for (const p of profile.projects) {
        ensure(30);
        y -= 14;
        const linkStr = p.link || "";
        const linkWidth = linkStr ? regular.widthOfTextAtSize(linkStr, 8.5) : 0;
        if (p.link) rightText(p.link, 8.5);
        const nameFitted = fitText(p.name, bold, 10, WIDTH - linkWidth - 12);
        text(nameFitted, MARGIN, 10, bold, INK, boldFontkit);
        if (p.description) para(p.description, 9.5, regular, INK, 0, 1.35, regularFontkit);
        bullets(p.bullets);
      }
    }

    if (profile.education.length) {
      section("Education");
      for (const e of profile.education) {
        ensure(30);
        y -= 14;
        const dateStr = dates(e);
        const dateWidth = regular.widthOfTextAtSize(dateStr, 9);
        rightText(dateStr, 9);
        const degreeFitted = fitText([e.degree, e.field].filter(Boolean).join(", "), bold, 10, WIDTH - dateWidth - 12);
        text(degreeFitted, MARGIN, 10, bold, INK, boldFontkit);
        para([e.institution, e.grade].filter(Boolean).join(" · "), 9.5, regular, MUTED, 0, 1.3, regularFontkit);
      }
    }

    if (profile.certifications.length) {
      section("Certifications");
      for (const c of profile.certifications) para([c.name, c.issuer, c.date].filter(Boolean).join(" · "), 9.5, regular, INK, 0, 1.35, regularFontkit);
    }
    return doc;
  }

  // Removes one unit of content; returns a human note, or null when nothing more can go.
  function trimOnce(p) {
    for (let i = p.experience.length - 1; i >= 1; i--) {
      if ((p.experience[i].bullets || []).length > 2) {
        p.experience[i].bullets.pop();
        return `Shortened ${p.experience[i].company}`;
      }
    }
    if (p.experience[0] && (p.experience[0].bullets || []).length > 4) {
      p.experience[0].bullets.pop();
      return `Shortened ${p.experience[0].company}`;
    }
    for (let i = p.projects.length - 1; i >= 0; i--) {
      if ((p.projects[i].bullets || []).length > 1) { p.projects[i].bullets.pop(); return `Shortened project ${p.projects[i].name}`; }
    }
    if (p.projects.length) return `Dropped project ${p.projects.pop().name}`;
    for (let i = p.experience.length - 1; i >= 1; i--) {
      if ((p.experience[i].bullets || []).length > 0) { p.experience[i].bullets.pop(); return `Shortened ${p.experience[i].company}`; }
    }
    return null;
  }

  async function buildCvPdf(profile, deps, { maxPages = 2 } = {}) {
    // Check if original profile fits
    const originalDoc = await render(structuredClone(profile), deps);
    const originalPages = originalDoc.getPageCount();

    if (originalPages <= maxPages) {
      return { bytes: await originalDoc.save(), pages: originalPages, trimmed: [], overflow: false };
    }

    // Original exceeds maxPages - find maximum number of trim steps K
    const cloneForK = structuredClone(profile);
    let K = 0;
    while (trimOnce(cloneForK)) K++;

    // Binary search for smallest k in [1, K] that fits within maxPages
    let bestK = 0;
    let bestDoc = originalDoc;

    let left = 1, right = K;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const pMid = structuredClone(profile);
      for (let i = 0; i < mid; i++) trimOnce(pMid);
      const docMid = await render(pMid, deps);
      const pagesMid = docMid.getPageCount();

      if (pagesMid <= maxPages) {
        bestK = mid;
        bestDoc = docMid;
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    // Render at bestK and collect trim notes
    const pBest = structuredClone(profile);
    const notes = [];
    for (let i = 0; i < bestK; i++) {
      const note = trimOnce(pBest);
      if (note) notes.push(note);
    }

    const trimmed = [...new Set(notes)];
    const pages = bestDoc.getPageCount();
    return { bytes: await bestDoc.save(), pages, trimmed, overflow: pages > maxPages };
  }

  const api = { buildCvPdf, wrapText, sanitize, fitText };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.JobPilot = root.JobPilot || {}).cvPdf = api;
})(globalThis);
