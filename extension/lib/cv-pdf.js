(function (root) {
  const PAGE = [595.28, 841.89]; // A4 in points
  const MARGIN = 48;
  const WIDTH = PAGE[0] - MARGIN * 2;
  const INK = [0.09, 0.09, 0.13];
  const MUTED = [0.38, 0.4, 0.46];
  const ACCENT = [0.31, 0.27, 0.9]; // indigo-600

  function sanitize(s) {
    return String(s || "")
      .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
      .replace(/[\u0000-\u0008\u000B-\u001F]/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function wrapText(text, font, size, maxWidth) {
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
    const b = profile.basics;
    doc.setTitle(sanitize(`${b.firstName} ${b.lastName} — CV`));
    let page = doc.addPage(PAGE);
    let y = PAGE[1] - MARGIN;

    const ensure = (h) => { if (y - h < MARGIN) { page = doc.addPage(PAGE); y = PAGE[1] - MARGIN; } };
    const text = (t, x, size, font, c = INK) => page.drawText(sanitize(t), { x, y, size, font, color: color(c) });
    const para = (t, size, font, c = INK, indent = 0, lead = 1.35) => {
      for (const line of wrapText(t, font, size, WIDTH - indent)) {
        ensure(size * lead);
        y -= size * lead;
        text(line, MARGIN + indent, size, font, c);
      }
    };
    const rightText = (t, size, c = MUTED) => {
      const s = sanitize(t);
      page.drawText(s, { x: PAGE[0] - MARGIN - regular.widthOfTextAtSize(s, size), y, size, font: regular, color: color(c) });
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
        const lines = wrapText(item, regular, 9.5, WIDTH - 12);
        lines.forEach((line, i) => {
          ensure(13);
          y -= 13;
          if (i === 0) text("•", MARGIN + 2, 9.5, regular, MUTED);
          text(line, MARGIN + 12, 9.5, regular);
        });
      }
    };
    const dates = (e) => [e.start, e.end].filter(Boolean).join(" – ");

    // Header
    y -= 22;
    text(`${b.firstName} ${b.lastName}`.trim(), MARGIN, 22, bold);
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
        text(e.title, MARGIN, 10.5, bold);
        rightText(dates(e), 9);
        para([e.company, e.location].filter(Boolean).join(" · "), 9.5, regular, MUTED, 0, 1.3);
        bullets(e.bullets);
        y -= 3;
      }
    }

    if (profile.skills.length) {
      section("Skills");
      for (const g of profile.skills) para(`${g.group}: ${(g.items || []).join(", ")}`, 9.5, regular);
    }

    if (profile.projects.length) {
      section("Projects");
      for (const p of profile.projects) {
        ensure(30);
        y -= 14;
        text(p.name, MARGIN, 10, bold);
        if (p.link) rightText(p.link, 8.5);
        if (p.description) para(p.description, 9.5, regular);
        bullets(p.bullets);
      }
    }

    if (profile.education.length) {
      section("Education");
      for (const e of profile.education) {
        ensure(30);
        y -= 14;
        text([e.degree, e.field].filter(Boolean).join(", "), MARGIN, 10, bold);
        rightText(dates(e), 9);
        para([e.institution, e.grade].filter(Boolean).join(" · "), 9.5, regular, MUTED, 0, 1.3);
      }
    }

    if (profile.certifications.length) {
      section("Certifications");
      for (const c of profile.certifications) para([c.name, c.issuer, c.date].filter(Boolean).join(" · "), 9.5, regular);
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
    const p = structuredClone(profile);
    const notes = [];
    for (;;) {
      const doc = await render(p, deps);
      const pages = doc.getPageCount();
      const note = pages > maxPages ? trimOnce(p) : null;
      if (!note) {
        const trimmed = [...new Set(notes)];
        return { bytes: await doc.save(), pages, trimmed };
      }
      notes.push(note);
    }
  }

  const api = { buildCvPdf, wrapText, sanitize };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.JobPilot = root.JobPilot || {}).cvPdf = api;
})(globalThis);
