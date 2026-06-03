const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "PAMS8 Template";

// ── Palette (from screenshot) ─────────────────────────────────────────────
const BG   = "D0E8AC";   // light sage green
const DARK = "263318";   // dark olive (lines, text)
const MID  = "4A6830";   // mid green (secondary text, accents)

// ── Helper: 4-corner bracket frame ────────────────────────────────────────
function brackets(slide, x, y, w, h, arm = 0.35, thick = 2, color = DARK) {
  [
    [x,           y,           arm,  0.001],   // TL horiz
    [x,           y,           0.001, arm ],   // TL vert
    [x + w - arm, y,           arm,  0.001],   // TR horiz
    [x + w,       y,           0.001, arm ],   // TR vert
    [x,           y + h,       arm,  0.001],   // BL horiz
    [x,           y + h - arm, 0.001, arm ],   // BL vert
    [x + w - arm, y + h,       arm,  0.001],   // BR horiz
    [x + w,       y + h - arm, 0.001, arm ],   // BR vert
  ].forEach(([lx, ly, lw, lh]) =>
    slide.addShape(pres.shapes.LINE, {
      x: lx, y: ly, w: lw, h: lh,
      line: { color, width: thick }
    })
  );
}

// ── Helper: solid + dashed circle motif ───────────────────────────────────
function circleMotif(slide, cx, cy, r, color = DARK) {
  // solid ring
  slide.addShape(pres.shapes.OVAL, {
    x: cx - r, y: cy - r, w: r * 2, h: r * 2,
    fill: { type: "none" }, line: { color, width: 1.5 }
  });
  // dashed ring (larger, offset slightly like the screenshot)
  const dr = r * 1.18;
  slide.addShape(pres.shapes.OVAL, {
    x: cx - dr + 0.07, y: cy - dr - 0.07, w: dr * 2, h: dr * 2,
    fill: { type: "none" }, line: { color, width: 1, dashType: "dash" }
  });
}

// ── Helper: filled circle bullet ──────────────────────────────────────────
function dotBullet(slide, cx, cy, r, color = DARK) {
  slide.addShape(pres.shapes.OVAL, {
    x: cx - r, y: cy - r, w: r * 2, h: r * 2,
    fill: { color }, line: { color, width: 0 }
  });
}

// ── Helper: slide footer label ────────────────────────────────────────────
function footer(slide, label) {
  slide.addText(label, {
    x: 0.55, y: 5.12, w: 8.9, h: 0.25,
    fontSize: 7.5, color: MID, charSpacing: 1.5, fontFace: "Calibri",
    align: "left", margin: 0
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 1 — Title
// ══════════════════════════════════════════════════════════════════════════
(function () {
  const s = pres.addSlide();
  s.background = { color: BG };

  // Outer bracket frame
  brackets(s, 0.22, 0.22, 9.56, 5.185, 0.52, 2, DARK);

  // Large circle motif (right)
  circleMotif(s, 7.15, 2.812, 1.7, DARK);

  // Inner concentric ring
  s.addShape(pres.shapes.OVAL, {
    x: 7.15 - 0.75, y: 2.812 - 0.75, w: 1.5, h: 1.5,
    fill: { type: "none" }, line: { color: DARK, width: 1 }
  });

  // Terminal icon "^—" inside inner ring
  s.addText("^  —", {
    x: 6.4, y: 2.58, w: 1.5, h: 0.45,
    fontSize: 17, color: DARK, fontFace: "Consolas",
    align: "center", valign: "middle", margin: 0
  });

  // Title bracket box
  brackets(s, 0.62, 1.15, 5.7, 2.0, 0.26, 1.5, MID);

  s.addText("PRESENTATION", {
    x: 0.9, y: 1.42, w: 5.1, h: 0.62,
    fontSize: 34, color: DARK, bold: true, fontFace: "Calibri",
    charSpacing: 5, align: "left", margin: 0
  });
  s.addText("TITLE", {
    x: 0.9, y: 1.98, w: 5.1, h: 0.72,
    fontSize: 52, color: DARK, bold: true, fontFace: "Calibri",
    charSpacing: 10, align: "left", margin: 0
  });

  // Subtitle
  s.addText("Subtitle  ·  Organisation  ·  Date", {
    x: 0.9, y: 3.35, w: 5.3, h: 0.38,
    fontSize: 12.5, color: MID, fontFace: "Calibri",
    charSpacing: 1.5, align: "left", margin: 0
  });

  // Small decorative circle left
  circleMotif(s, 0.85, 4.55, 0.2, MID);

  footer(s, "CLASSIFICATION  ·  DISTRIBUTION STATEMENT  ·  REVISION 1.0");
})();

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 2 — Three-Card Content
// ══════════════════════════════════════════════════════════════════════════
(function () {
  const s = pres.addSlide();
  s.background = { color: BG };

  brackets(s, 0.22, 0.22, 9.56, 5.185, 0.4, 2, DARK);

  // Slide number
  s.addText("02", {
    x: 8.85, y: 0.28, w: 0.7, h: 0.38,
    fontSize: 11, color: MID, fontFace: "Calibri", align: "right", margin: 0
  });

  // Title with small dot accent
  s.addText("SECTION TITLE", {
    x: 0.72, y: 0.32, w: 7.8, h: 0.5,
    fontSize: 21, color: DARK, bold: true, charSpacing: 5,
    fontFace: "Calibri", align: "left", margin: 0
  });
  dotBullet(s, 0.56, 0.565, 0.065, DARK);

  // Three cards
  [
    { x: 0.42, n: "01", title: "Key Point Alpha", body: "Supporting information and context for this critical element. Data-driven insights that reinforce the main argument and narrative." },
    { x: 3.6,  n: "02", title: "Key Point Bravo", body: "Detailed explanation of the second major point. Include metrics and specific outcomes for maximum clarity and impact." },
    { x: 6.78, n: "03", title: "Key Point Charlie", body: "Actionable recommendations and next steps. Final element for stakeholder consideration and executive decision support." },
  ].forEach(({ x, n, title, body }) => {
    const cy = 1.1, cw = 2.85, ch = 3.7;

    // Card background
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: cy, w: cw, h: ch,
      fill: { color: "C2DE9C", transparency: 35 },
      line: { color: DARK, width: 0.75 }
    });

    // Card corner brackets
    brackets(s, x, cy, cw, ch, 0.18, 1.5, DARK);

    // Numbered circle
    s.addShape(pres.shapes.OVAL, {
      x: x + 0.14, y: cy + 0.16, w: 0.38, h: 0.38,
      fill: { type: "none" }, line: { color: MID, width: 1.2 }
    });
    s.addText(n, {
      x: x + 0.14, y: cy + 0.16, w: 0.38, h: 0.38,
      fontSize: 9, color: DARK, bold: true, fontFace: "Calibri",
      align: "center", valign: "middle", margin: 0
    });

    // Card title
    s.addText(title, {
      x: x + 0.16, y: cy + 0.7, w: cw - 0.32, h: 0.5,
      fontSize: 12.5, color: DARK, bold: true, fontFace: "Calibri",
      align: "left", margin: 0
    });

    // Thin separator line
    s.addShape(pres.shapes.LINE, {
      x: x + 0.16, y: cy + 1.26, w: cw - 0.32, h: 0.001,
      line: { color: MID, width: 0.75 }
    });

    // Card body
    s.addText(body, {
      x: x + 0.16, y: cy + 1.35, w: cw - 0.32, h: 2.1,
      fontSize: 10.5, color: DARK, fontFace: "Calibri",
      align: "left", valign: "top", margin: 0
    });
  });

  footer(s, "TEMPLATE  ·  SECTION 02  ·  UNCLASSIFIED");
})();

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 3 — Two-Column (circle stat + bracket list)
// ══════════════════════════════════════════════════════════════════════════
(function () {
  const s = pres.addSlide();
  s.background = { color: BG };

  brackets(s, 0.22, 0.22, 9.56, 5.185, 0.4, 2, DARK);

  s.addText("03", {
    x: 8.85, y: 0.28, w: 0.7, h: 0.38,
    fontSize: 11, color: MID, fontFace: "Calibri", align: "right", margin: 0
  });

  s.addText("ANALYSIS  &  INSIGHTS", {
    x: 0.72, y: 0.32, w: 7.8, h: 0.5,
    fontSize: 21, color: DARK, bold: true, charSpacing: 5,
    fontFace: "Calibri", align: "left", margin: 0
  });
  dotBullet(s, 0.56, 0.565, 0.065, DARK);

  // Left column heading
  s.addText("Performance Overview", {
    x: 0.42, y: 0.98, w: 4.0, h: 0.38,
    fontSize: 13, color: DARK, bold: true, fontFace: "Calibri",
    align: "center", margin: 0
  });

  // Large circle motif (left col, center)
  const cx = 2.42, cy = 3.05, r = 1.65;
  circleMotif(s, cx, cy, r, DARK);

  // Inner ring
  s.addShape(pres.shapes.OVAL, {
    x: cx - 0.9, y: cy - 0.9, w: 1.8, h: 1.8,
    fill: { type: "none" }, line: { color: DARK, width: 1 }
  });

  // Stat inside
  s.addText("73%", {
    x: cx - 0.88, y: cy - 0.48, w: 1.76, h: 0.62,
    fontSize: 30, color: DARK, bold: true, fontFace: "Calibri",
    align: "center", margin: 0
  });
  s.addText("EFFICIENCY RATE", {
    x: cx - 0.88, y: cy + 0.2, w: 1.76, h: 0.3,
    fontSize: 7.5, color: MID, charSpacing: 1.5, fontFace: "Calibri",
    align: "center", margin: 0
  });

  // Divider
  s.addShape(pres.shapes.LINE, {
    x: 4.7, y: 0.95, w: 0.001, h: 4.15,
    line: { color: DARK, width: 0.75 }
  });

  // Right column — bracket list items
  [
    { lbl: "A", text: "Primary Metric — 47.2% improvement over the baseline period with a sustained growth trajectory confirmed by field data." },
    { lbl: "B", text: "Secondary Metric — Consistent 94% target achievement across all operational phases throughout the reporting window." },
    { lbl: "C", text: "Tertiary Metric — Risk-adjusted performance index remains within acceptable parameters per governing standards." },
  ].forEach(({ lbl, text }, i) => {
    const iy = 1.05 + i * 1.33;
    const ix = 4.9;
    brackets(s, ix, iy, 4.6, 1.05, 0.17, 1.4, DARK);

    // Filled circle label
    s.addShape(pres.shapes.OVAL, {
      x: ix + 0.16, y: iy + 0.3, w: 0.38, h: 0.38,
      fill: { color: DARK }, line: { color: DARK, width: 0 }
    });
    s.addText(lbl, {
      x: ix + 0.16, y: iy + 0.3, w: 0.38, h: 0.38,
      fontSize: 10, color: BG, bold: true, fontFace: "Calibri",
      align: "center", valign: "middle", margin: 0
    });

    s.addText(text, {
      x: ix + 0.66, y: iy + 0.1, w: 3.72, h: 0.88,
      fontSize: 10, color: DARK, fontFace: "Calibri",
      align: "left", valign: "middle", margin: 0
    });
  });

  footer(s, "TEMPLATE  ·  SECTION 03  ·  UNCLASSIFIED");
})();

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 4 — Section Divider
// ══════════════════════════════════════════════════════════════════════════
(function () {
  const s = pres.addSlide();
  s.background = { color: BG };

  brackets(s, 0.22, 0.22, 9.56, 5.185, 0.55, 2, DARK);

  // Three concentric rings (centered)
  const cx = 5.0, cy = 2.812;
  s.addShape(pres.shapes.OVAL, {
    x: cx - 2.15, y: cy - 2.15, w: 4.3, h: 4.3,
    fill: { type: "none" }, line: { color: DARK, width: 1.5 }
  });
  // dashed outer ring (the larger one offset like the screenshot)
  s.addShape(pres.shapes.OVAL, {
    x: cx - 2.45 + 0.08, y: cy - 2.45 - 0.08, w: 4.9, h: 4.9,
    fill: { type: "none" }, line: { color: DARK, width: 1, dashType: "dash" }
  });
  // inner ring
  s.addShape(pres.shapes.OVAL, {
    x: cx - 1.25, y: cy - 1.25, w: 2.5, h: 2.5,
    fill: { type: "none" }, line: { color: DARK, width: 1 }
  });

  s.addText("04", {
    x: cx - 1.1, y: cy - 0.72, w: 2.2, h: 0.6,
    fontSize: 38, color: DARK, bold: true, charSpacing: 8,
    fontFace: "Calibri", align: "center", margin: 0
  });

  s.addText("SECTION HEADER", {
    x: cx - 2.0, y: cy + 0.1, w: 4.0, h: 0.5,
    fontSize: 17, color: DARK, bold: true, charSpacing: 5,
    fontFace: "Calibri", align: "center", margin: 0
  });

  s.addText("Brief description of this section's scope and objectives", {
    x: cx - 2.2, y: cy + 0.68, w: 4.4, h: 0.38,
    fontSize: 10, color: MID, fontFace: "Calibri",
    align: "center", margin: 0
  });

  // Four small corner dot accents inside the outer bracket frame
  [[0.5, 0.5],[9.5, 0.5],[0.5, 5.125],[9.5, 5.125]].forEach(([dx, dy]) =>
    dotBullet(s, dx, dy, 0.055, MID)
  );

  footer(s, "TEMPLATE  ·  SECTION 04  ·  UNCLASSIFIED");
})();

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 5 — Closing / Thank You
// ══════════════════════════════════════════════════════════════════════════
(function () {
  const s = pres.addSlide();
  s.background = { color: BG };

  brackets(s, 0.22, 0.22, 9.56, 5.185, 0.5, 2, DARK);

  // Circle motif left
  circleMotif(s, 2.55, 2.812, 1.85, DARK);
  s.addShape(pres.shapes.OVAL, {
    x: 2.55 - 0.85, y: 2.812 - 0.85, w: 1.7, h: 1.7,
    fill: { type: "none" }, line: { color: DARK, width: 1 }
  });

  // "^—" terminal icon in inner ring
  s.addText("^  —", {
    x: 1.75, y: 2.6, w: 1.6, h: 0.42,
    fontSize: 16, color: DARK, fontFace: "Consolas",
    align: "center", valign: "middle", margin: 0
  });

  // Thank you
  s.addText("THANK YOU", {
    x: 4.85, y: 1.45, w: 4.6, h: 0.72,
    fontSize: 42, color: DARK, bold: true, charSpacing: 8,
    fontFace: "Calibri", align: "left", margin: 0
  });

  // Divider line
  s.addShape(pres.shapes.LINE, {
    x: 4.85, y: 2.3, w: 4.5, h: 0.001,
    line: { color: MID, width: 0.75 }
  });

  // Contact block with bracket
  brackets(s, 4.85, 2.55, 4.5, 1.75, 0.22, 1.5, MID);
  s.addText([
    { text: "Name Surname",         options: { bold: true, breakLine: true } },
    { text: "Position Title",       options: { breakLine: true } },
    { text: "email@organisation.com", options: { breakLine: true } },
    { text: "+1 234 567 8900",      options: {} }
  ], {
    x: 5.1, y: 2.75, w: 4.0, h: 1.35,
    fontSize: 11, color: DARK, fontFace: "Calibri",
    align: "left", valign: "top", margin: 0
  });

  // Bottom-right small circle
  circleMotif(s, 9.18, 4.55, 0.2, MID);

  footer(s, "TEMPLATE  ·  CLOSING SLIDE  ·  UNCLASSIFIED");
})();

// ── Write ──────────────────────────────────────────────────────────────────
pres.writeFile({ fileName: "D:\\Projects\\PAMS8\\PAMS8_Template.pptx" });
console.log("Done → PAMS8_Template.pptx");
