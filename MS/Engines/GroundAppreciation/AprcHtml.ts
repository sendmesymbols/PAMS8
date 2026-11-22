/**
 * AprcHtml.ts
 *
 * The appreciation as a page of service writing (pure: strings only). The same body is the sheet's page in the app and
 * the document sent to print (PDF through the browser's print): the marking as a ruled line at head and foot of every
 * page (filled or stamped by hand), address block as titles with ruled lines, the title,
 * centred part headings, underlined group and paragraph headings, paragraphs indented by level, ruled tables, figures.
 *
 * Fair copy: what goes up; a paragraph not written and a proposal not accepted print a ruled line.
 * Draft copy: the same with a mark on each paragraph, the heads to consider under a ruled line, proposals shown as
 * proposals, and annexes: Confirm on Gr, the basis of each drafted paragraph, the data.
 */

import { lines, numberOf, shown, tableOf, type AprcCopy, type AprcDoc, type AprcFigure, type AprcPara, type AprcTable } from './AprcModel';

export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Styles of the page, scoped under `.aprc-doc`. Paper colours on purpose: it is a printed page, in the app too. */
export const APRC_DOC_CSS = `
.aprc-doc{background:#fff;color:#111;font:12pt/1.45 Arial,Helvetica,sans-serif;text-align:left}
.aprc-doc *{box-sizing:border-box}
.aprc-doc .ap-mkg{text-align:center;font-weight:700;letter-spacing:.02em;min-height:1.45em}
.aprc-doc .ap-addr{margin:6pt 0 12pt auto;width:16em;line-height:1.8}
.aprc-doc .ap-rule{display:inline-block;border-bottom:1px solid #444;min-width:9em;height:1.1em;vertical-align:-2px}
.aprc-doc .ap-rule.long{min-width:22em;max-width:100%}
.aprc-doc .ap-title,.aprc-doc .ap-part{text-align:center;font-weight:700;text-decoration:underline;margin:14pt 0 8pt}
.aprc-doc .ap-group{font-weight:700;text-decoration:underline;margin:10pt 0 4pt}
.aprc-doc .ap-p{display:grid;grid-template-columns:2.6em minmax(0,1fr);margin:5pt 0;break-inside:avoid-page}
.aprc-doc .ap-p.d1{margin-left:2.6em}.aprc-doc .ap-p.d2{margin-left:5.2em}.aprc-doc .ap-p.d3{margin-left:7.8em}.aprc-doc .ap-p.d4{margin-left:10.4em}
.aprc-doc .ap-h{text-decoration:underline}
.aprc-doc table{border-collapse:collapse;margin:6pt 0 8pt;font-size:11pt;width:100%}
.aprc-doc th,.aprc-doc td{border:1px solid #222;padding:3pt 6pt;text-align:left;vertical-align:top;height:1.9em}
.aprc-doc th{font-weight:700;background:#eee}
.aprc-doc figure{margin:8pt 0 10pt;break-inside:avoid-page}
.aprc-doc figure .ap-fr{border:1px solid #222;line-height:0}
.aprc-doc figure svg,.aprc-doc figure img{display:block;width:100%;height:auto}
.aprc-doc figcaption{font-size:10.5pt;margin-top:3pt;text-align:center}
.aprc-doc .ap-mk{display:inline-block;font:700 7.5pt/1 Arial,sans-serif;border-radius:3px;padding:2px 4px;margin-left:6px;vertical-align:1px;white-space:nowrap}
.aprc-doc .ap-mk.GR{background:#d9f3e5;color:#11663b}.aprc-doc .ap-mk.MAP{background:#dbe8ff;color:#143e94}
.aprc-doc .ap-mk.JUDGE{background:#fff0c7;color:#7a5200}.aprc-doc .ap-mk.YOURS{background:#eceff2;color:#4a535d}
.aprc-doc .ap-mk.WRITTEN{background:#e6dcf7;color:#4a2a8a}.aprc-doc .ap-mk.STALE{background:#ffd9d9;color:#8a1c1c}
.aprc-doc .ap-prop{background:#fff7dd}
.aprc-doc .ap-hint{color:#6a5a2a;font-style:italic;font-size:10.5pt}
.aprc-doc .ap-anx{break-before:page;margin-top:18pt}
.aprc-doc .ap-anx h4{text-align:center;text-decoration:underline;font-size:12pt;margin:0 0 8pt}
.aprc-doc .ap-anx ol{margin:0;padding-left:2em}
.aprc-doc .ap-anx li{margin:3pt 0}
.aprc-doc .ap-basis{font-size:10.5pt;margin:4pt 0}
.aprc-doc .ap-basis b{font-weight:700}
.aprc-doc .ap-read{font-size:10pt;color:#444;margin-top:10pt}
`;

const MARK_CLASS: Record<string, string> = { GR: 'GR', MAP: 'MAP', 'YOU JUDGE': 'JUDGE', YOURS: 'YOURS', WRITTEN: 'WRITTEN' };

function tableHtml(t: AprcTable): string {
  const cols = t.widths?.length === t.head.length ? `<colgroup>${t.widths.map((w) => `<col style="width:${(w * 100).toFixed(1)}%">`).join('')}</colgroup>` : '';
  return `<table>${cols}<tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
}

function figureHtml(f: AprcFigure, n: number): string {
  const pic = f.svg ?? (f.png ? `<img alt="${esc(f.caption)}" src="${esc(f.png)}">` : '');
  if (!pic) return '';
  return `<figure><div class="ap-fr">${pic}</div><figcaption>Fig ${n}. ${esc(f.caption)}</figcaption></figure>`;
}

function paraHtml(p: AprcPara, depth: number, lab: string, copy: AprcCopy, figs: Map<string, { f: AprcFigure; n: number }>): string {
  const s = shown(p, copy);
  const head = p.head ? `<span class="ap-h">${esc(p.head)}</span>. ` : '';
  const body = s.text === null ? `<span class="ap-rule long"></span>` : esc(s.text);
  let extra = '';
  if (copy === 'draft') {
    if (s.text !== '' || p.table) extra += `<span class="ap-mk ${MARK_CLASS[s.mark]}">${s.proposal ? 'PROPOSAL' : s.mark}</span>`;
    if (s.stale) extra += `<span class="ap-mk STALE">GR CHANGED SINCE</span>`;
    if (s.text === null && p.prompts.length) extra += `<br><span class="ap-hint">${esc(p.prompts.join(' · '))}</span>`;
  }
  let html = `<div class="ap-p d${Math.min(depth, 4)}${s.proposal ? ' ap-prop' : ''}" data-id="${esc(p.id)}"><span class="ap-n">${esc(lab)}</span><span class="ap-b">${head}${body}${extra}</span></div>`;
  const pad = `margin-left:${((Math.min(depth, 4) + 1) * 2.6).toFixed(1)}em`;
  const tb = tableOf(p, copy);
  if (tb) html += `<div style="${pad}">${tableHtml(tb)}</div>`;
  const fig = p.figure ? figs.get(p.figure) : null;
  if (fig) html += `<div style="${pad}">${figureHtml(fig.f, fig.n)}</div>`;
  return html;
}

/** The address block: titles and ruled lines only, to be filled by hand (user, 22 Nov 2026). */
function headBlock(doc: AprcDoc): string {
  const r = '<span class="ap-rule"></span>';
  return `<div class="ap-addr">Copy no ${r.replace('ap-rule', 'ap-rule" style="min-width:3em')} of ${r.replace('ap-rule', 'ap-rule" style="min-width:3em')}<br>${r}<br>${r}<br>Tel Mil : ${r.replace('ap-rule', 'ap-rule" style="min-width:5em')}<br>G – ${r.replace('ap-rule', 'ap-rule" style="min-width:6.4em')}<br>${r}</div>
<div class="ap-title">${esc(doc.title)}</div><div>Ref: <span class="ap-rule"></span></div>`;
}

/** The page content. `marking` false leaves the marking's ruled line off the head and foot (print puts it in the page margins). */
export function bodyHtml(doc: AprcDoc, copy: AprcCopy, o: { marking?: boolean } = {}): string {
  const figs = new Map<string, { f: AprcFigure; n: number }>();
  let fn = 0;
  const used = new Set<string>();
  const all = lines(doc);
  for (const l of all) if (l.type === 'para' && l.p.figure) used.add(l.p.figure);
  for (const f of doc.figures) if (used.has(f.id) && (f.svg || f.png)) figs.set(f.id, { f, n: ++fn });
  const H: string[] = [];
  const mk = o.marking !== false ? '<div class="ap-mkg"><span class="ap-rule"></span></div>' : '';
  H.push(mk, headBlock(doc));
  for (const l of all) {
    if (l.type === 'part') H.push(`<div class="ap-part">${esc(l.title)}</div>`);
    else if (l.type === 'group') H.push(`<div class="ap-group">${esc(l.title)}</div>`);
    else H.push(paraHtml(l.p, l.depth, l.label, copy, figs));
  }
  // Figures no paragraph points at (the shot of the map) go behind as an annex.
  const loose = doc.figures.filter((f) => !used.has(f.id) && (f.svg || f.png));
  if (loose.length) H.push(`<div class="ap-anx"><h4>ANX: THE MAP</h4>${loose.map((f) => figureHtml(f, ++fn)).join('')}</div>`);
  if (copy === 'draft') {
    if (doc.confirm.length) H.push(`<div class="ap-anx"><h4>CONFIRM ON GR</h4><ol>${doc.confirm.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ol></div>`);
    const basis: string[] = [];
    for (const l of all) if (l.type === 'para' && l.p.basis.length && !l.p.mine) basis.push(`<div class="ap-basis"><b>${esc(numberOf(doc, l.p.id))}${l.p.head ? ` ${esc(l.p.head)}` : ''}.</b> ${l.p.basis.map((b) => `${esc(cap(b.kind))}: ${esc(b.text)}`).join('. ')}.</div>`);
    if (basis.length) H.push(`<div class="ap-anx"><h4>BASIS OF THE DRAFTED PARAGRAPHS</h4>${basis.join('')}</div>`);
    if (doc.sources.length || doc.frame) {
      const fr = doc.frame;
      H.push(`<div class="ap-anx"><h4>DATA</h4><ol>${doc.sources.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>${fr ? `<div class="ap-read">Read ${esc(fr.readAt)}: ${esc(fr.echelon)} AOR (${esc(fr.aor)}), ${esc(fr.mover)}, ${esc(fr.month)}, ${fr.season === 'wet' ? 'after rain' : 'dry'}; threat ${esc(fr.threat)}. A plan to check on the ground.</div>` : ''}</div>`);
    }
  }
  H.push(mk);
  return H.join('\n');
}
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

/** A whole document for the print window: A4, the page number and the marking's ruled line in the page margins. */
export function printHtml(doc: AprcDoc, copy: AprcCopy): string {
  const m = '________________';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
@page{size:A4;margin:22mm 20mm 20mm 25mm;@top-center{content:counter(page) "\\A ${m}";white-space:pre;font:700 11pt Arial,sans-serif;text-align:center}@bottom-center{content:"${m}";font:700 11pt Arial,sans-serif}}
html,body{margin:0;background:#fff}
${APRC_DOC_CSS}
@media screen{body{background:#777}.aprc-doc{max-width:210mm;margin:10mm auto;padding:22mm 20mm 20mm 25mm;box-shadow:0 2px 14px rgba(0,0,0,.4)}}
@media print{.aprc-doc .ap-mkg{display:none}}
</style></head><body><div class="aprc-doc">${bodyHtml(doc, copy)}</div></body></html>`;
}
