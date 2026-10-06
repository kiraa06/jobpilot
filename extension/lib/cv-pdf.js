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

  // pdf-lib font -> fontkit font, so we can ask which code points a font really has.
  const FK = new WeakMap();
  function registerFont(pdfFont, fkFont) { FK.set(pdfFont, fkFont); return pdfFont; }

  // THE text filter: sanitize, then drop every code point the font lacks.
  // All drawText / widthOfTextAtSize input in this file comes from here.
  function glyphSafe(text, font) {
    const s = sanitize(text);
    const fk = FK.get(font);
    if (!fk) return s;
    let out = "";
    for (const ch of s) if (fk.hasGlyphForCodePoint(ch.codePointAt(0))) out += ch;
    return out;
  }

  function fitText(text, font, size, maxWidth) {
    const s = glyphSafe(text, font);
    if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
    const chars = Array.from(s);
    let cut = chars.length - 1;
    while (cut > 0 && font.widthOfTextAtSize(glyphSafe(chars.slice(0, cut).join("") + "…", font), size) > maxWidth) cut--;
    return glyphSafe(chars.slice(0, cut).join("") + "…", font);
  }

  function wrapText(text, font, size, maxWidth) {
    const w = (t) => font.widthOfTextAtSize(t, size);
    const lines = [];
    for (const para of glyphSafe(text, font).split(/\n+/)) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (w(candidate) <= maxWidth) { line = candidate; continue; }
        if (line) lines.push(line);
        line = "";
        let rest = Array.from(word);
        while (w(rest.join("")) > maxWidth && rest.length > 1) {
          let cut = rest.length - 1;
          while (cut > 1 && w(rest.slice(0, cut).join("")) > maxWidth) cut--;
          lines.push(rest.slice(0, cut).join(""));
          rest = rest.slice(cut);
        }
        line = rest.join("");
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

    registerFont(regular, fontkit.create(fonts.regular));
    registerFont(bold, fontkit.create(fonts.bold));

    const b = profile.basics;
    doc.setTitle(glyphSafe(`${b.firstName} ${b.lastName} — CV`, bold));
    let page = doc.addPage(PAGE);
    let y = PAGE[1] - MARGIN;

    const ensure = (h) => { if (y - h < MARGIN) { page = doc.addPage(PAGE); y = PAGE[1] - MARGIN; } };
    const text = (t, x, size, font, c = INK) => {
      page.drawText(glyphSafe(t, font), { x, y, size, font, color: color(c) });
    };
    const para = (t, size, font, c = INK, indent = 0, lead = 1.35) => {
      for (const line of wrapText(t, font, size, WIDTH - indent)) {
        ensure(size * lead);
        y -= size * lead;
        text(line, MARGIN + indent, size, font, c);
      }
    };
    // Row: right text (capped to 45% of WIDTH) is drawn first, then the left text
    // is fitted to the space that remains.
    const row = (left, leftFont, leftSize, right, rightSize) => {
      let rightWidth = 0;
      if (right) {
        const s = fitText(right, regular, rightSize, WIDTH * 0.45);
        rightWidth = regular.widthOfTextAtSize(s, rightSize);
        page.drawText(s, { x: PAGE[0] - MARGIN - rightWidth, y, size: rightSize, font: regular, color: color(MUTED) });
      }
      const l = fitText(left, leftFont, leftSize, WIDTH - rightWidth - 12);
      page.drawText(l, { x: MARGIN, y, size: leftSize, font: leftFont, color: color(INK) });
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
        wrapText(item, regular, 9.5, WIDTH - 12).forEach((line, i) => {
          ensure(13);
          y -= 13;
          if (i === 0) text("•", MARGIN + 2, 9.5, regular, MUTED);
          text(line, MARGIN + 12, 9.5, regular);
        });
      }
    };
    const dates = (e) => [e.start, e.end].filter(Boolean).join(" – ");

    // Header
    const nameLines = wrapText(`${b.firstName} ${b.lastName}`.trim(), bold, 22, WIDTH);
    for (const line of nameLines) {
      ensure(22 * 1.2);
      y -= 22 * 1.2;
      text(line, MARGIN, 22, bold, INK);
    }
    if (b.headline) para(b.headline, 11, regular, ACCENT);
    const contact = [b.email, b.phone, b.location || [b.city, b.country].filter(Boolean).join(", "), b.linkedin, b.github, b.website]
      .filter(Boolean).join("  ·  ");
    if (contact) para(contact, 9, regular, MUTED);

    if (b.summary) { section("Summary"); para(b.summary, 10, regular); }

    if (profile.experience.length) {
      section("Experience");
      for (const e of profile.experience) {
        ensure(40);
        y -= 15;
        row(e.title, bold, 10.5, dates(e), 9);
        para([e.company, e.location].filter(Boolean).join(" · "), 9.5, regular, MUTED, 0, 1.3);
        bullets(e.bullets);
        y -= 3;
      }
    }

    if (profile.skills.length) {
      section("Skills");
      for (const g of profile.skills) para(`${g.group}: ${(g.items || []).join(", ")}`, 9.5, regular, INK, 0, 1.35);
    }

    if (profile.projects.length) {
      section("Projects");
      for (const p of profile.projects) {
        ensure(30);
        y -= 14;
        row(p.name, bold, 10, p.link, 8.5);
        if (p.description) para(p.description, 9.5, regular, INK, 0, 1.35);
        bullets(p.bullets);
      }
    }

    if (profile.education.length) {
      section("Education");
      for (const e of profile.education) {
        ensure(30);
        y -= 14;
        row([e.degree, e.field].filter(Boolean).join(", "), bold, 10, dates(e), 9);
        para([e.institution, e.grade].filter(Boolean).join(" · "), 9.5, regular, MUTED, 0, 1.3);
      }
    }

    if (profile.certifications.length) {
      section("Certifications");
      for (const c of profile.certifications) para([c.name, c.issuer, c.date].filter(Boolean).join(" · "), 9.5, regular, INK, 0, 1.35);
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
    const result = async (doc, notes) => {
      const pages = doc.getPageCount();
      return { bytes: await doc.save(), pages, trimmed: [...new Set(notes)], overflow: pages > maxPages };
    };
    const trimmedBy = (k) => {
      const p = structuredClone(profile);
      const notes = [];
      for (let i = 0; i < k; i++) notes.push(trimOnce(p));
      return { p, notes };
    };

    const doc0 = await render(structuredClone(profile), deps);
    if (doc0.getPageCount() <= maxPages) return result(doc0, []);

    let K = 0;
    const probe = structuredClone(profile);
    while (trimOnce(probe)) K++;

    // Smallest k in [1, K] whose render fits (page count is monotone in k).
    let lo = 1, hi = K, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const { p, notes } = trimmedBy(mid);
      const doc = await render(p, deps);
      if (doc.getPageCount() <= maxPages) { best = { doc, notes }; hi = mid - 1; }
      else lo = mid + 1;
    }
    if (best) return result(best.doc, best.notes);

    // Nothing fits: return the fully trimmed render, flagged as overflow.
    const { p, notes } = trimmedBy(K);
    return result(await render(p, deps), notes);
  }

  const api = { buildCvPdf, wrapText, sanitize, fitText, glyphSafe, registerFont };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.JobPilot = root.JobPilot || {}).cvPdf = api;
})(globalThis);
