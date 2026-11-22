/**
 * AprcDocx.ts
 *
 * The appreciation as a Word document (.docx). Pure: it returns the parts of the package (path → XML text or image
 * bytes); the engine zips them with the JSZip that the PowerPoint bundle already carries (no new dependency).
 *
 * WordprocessingML written by hand for this one layout: A4, Arial 12, the page number and the marking's ruled line in
 * the header, the ruled line again in the footer (filled or stamped by hand), paragraphs numbered as typed text with a hanging indent per level (so they stay as the
 * planner reads them when he edits), ruled tables, pictures inline. Fair and draft copies as in AprcHtml.
 */

import { lines, numberOf, shown, tableOf, type AprcCopy, type AprcDoc, type AprcTable } from './AprcModel';

export interface DocxImage {
  /** PNG bytes. */
  bytes: Uint8Array;
  /** Pixels, for the aspect. */
  w: number;
  h: number;
}

const x = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const STEP = 567; // 1 cm in twentieths of a point
const TEXT_W = 9026; // A4 less the side margins below, twips
const RULE = '________________________';

type RunOpt = { b?: boolean; u?: boolean; i?: boolean; size?: number; color?: string };
function run(text: string, o: RunOpt = {}): string {
  if (!text) return '';
  const pr = `${o.b ? '<w:b/>' : ''}${o.i ? '<w:i/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}${o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : ''}${o.u ? '<w:u w:val="single"/>' : ''}`;
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${x(text)}</w:t></w:r>`;
}
const TAB = '<w:r><w:tab/></w:r>';
function p(inner: string, o: { align?: 'center' | 'right'; left?: number; hanging?: number; before?: number; after?: number; keep?: boolean; pageBreak?: boolean } = {}): string {
  const ind = o.left || o.hanging ? `<w:ind w:left="${o.left ?? 0}"${o.hanging ? ` w:hanging="${o.hanging}"` : ''}/>` : '';
  const tabs = o.hanging ? `<w:tabs><w:tab w:val="left" w:pos="${o.left ?? 0}"/></w:tabs>` : '';
  const sp = `<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 100}"/>`;
  return `<w:p><w:pPr>${o.keep ? '<w:keepNext/>' : ''}${o.pageBreak ? '<w:pageBreakBefore/>' : ''}${tabs}${sp}${ind}${o.align ? `<w:jc w:val="${o.align}"/>` : ''}</w:pPr>${inner}</w:p>`;
}

function table(t: AprcTable, left: number): string {
  const total = TEXT_W - left;
  const ws = (t.widths?.length === t.head.length ? t.widths : t.head.map(() => 1 / t.head.length)).map((w) => Math.round(w * total));
  const bd = (k: string) => `<w:${k} w:val="single" w:sz="6" w:space="0" w:color="222222"/>`;
  const cell = (text: string, w: number, head: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>' : ''}</w:tcPr>${p(run(text || ' ', { b: head, size: 22 }), { after: 40, before: 40 })}</w:tc>`;
  const row = (cells: string[], head: boolean) => `<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.map((c, i) => cell(c, ws[i] ?? ws[0], head)).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblInd w:w="${left}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(bd).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${ws.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${row(t.head, true)}${t.rows.map((r) => row(r, false)).join('')}</w:tbl>${p('', { after: 60 })}`;
}

function picture(rid: string, n: number, img: DocxImage, left: number): string {
  const maxEmu = Math.round(((TEXT_W - left) / 1440) * 914400);
  const cx = maxEmu, cy = Math.round((maxEmu * img.h) / Math.max(1, img.w));
  return p(
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Fig ${n}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="Fig ${n}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln w="6350"><a:solidFill><a:srgbClr val="222222"/></a:solidFill></a:ln></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`,
    { left, after: 40, keep: true },
  );
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/**
 * The parts of the .docx package. `images` holds a PNG for each figure id that should print (a figure without one is
 * left out, with its caption kept as a line so the reader knows a figure belongs there).
 */
export function docxFiles(doc: AprcDoc, copy: AprcCopy, images: Record<string, DocxImage> = {}): Record<string, string | Uint8Array> {
  const B: string[] = [];
  const rels: string[] = [];
  const media: Record<string, Uint8Array> = {};
  let rid = 10, figN = 0;
  const addFig = (id: string, left: number): void => {
    const f = doc.figures.find((q) => q.id === id);
    if (!f) return;
    figN++;
    const img = images[id];
    if (img) {
      const r = `rId${rid++}`;
      const name = `image${figN}.png`;
      media[`word/media/${name}`] = img.bytes;
      rels.push(`<Relationship Id="${r}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
      B.push(picture(r, figN, img, left));
    }
    B.push(p(run(`Fig ${figN}. ${f.caption}`, { size: 21 }), { align: 'center', after: 140 }));
  };

  // the address block: titles and ruled lines
  for (const t of ['Copy no ____ of ____', '________________', '________________', 'Tel Mil : __________', 'G – ____________', '________________']) B.push(p(run(t), { left: 6000, after: 60 }));
  B.push(p(run(doc.title, { b: true, u: true }), { align: 'center', before: 200, after: 140 }));
  B.push(p(run('Ref: ________________')));

  const all = lines(doc);
  const used = new Set<string>();
  for (const l of all) {
    if (l.type === 'part') {
      B.push(p(run(l.title, { b: true, u: true }), { align: 'center', before: 240, after: 140, keep: true }));
      continue;
    }
    if (l.type === 'group') {
      B.push(p(run(l.title, { b: true, u: true }), { before: 160, after: 80, keep: true }));
      continue;
    }
    const s = shown(l.p, copy);
    const left = (Math.min(l.depth, 4) + 1) * STEP;
    let inner = run(l.label) + TAB;
    if (l.p.head) inner += run(l.p.head, { u: true }) + run('. ');
    inner += s.text === null ? run(RULE) : run(s.text);
    if (copy === 'draft') {
      if (s.text !== '' || l.p.table) inner += run(`  [${s.proposal ? 'PROPOSAL' : s.mark}${s.stale ? ', GR CHANGED SINCE' : ''}]`, { b: true, size: 16, color: s.proposal || s.mark === 'YOU JUDGE' ? '7A5200' : s.mark === 'GR' ? '11663B' : s.mark === 'MAP' ? '143E94' : '4A535D' });
    }
    B.push(p(inner, { left, hanging: STEP, keep: !!l.p.table || !!l.p.figure }));
    if (copy === 'draft' && s.text === null && l.p.prompts.length) B.push(p(run(l.p.prompts.join(' · '), { i: true, size: 20, color: '6A5A2A' }), { left }));
    const tb = tableOf(l.p, copy);
    if (tb) B.push(table(tb, left));
    if (l.p.figure) {
      used.add(l.p.figure);
      addFig(l.p.figure, left);
    }
  }

  const loose = doc.figures.filter((f) => !used.has(f.id));
  if (loose.length) {
    B.push(p(run('ANX: THE MAP', { b: true, u: true }), { align: 'center', pageBreak: true, after: 140 }));
    for (const f of loose) addFig(f.id, 0);
  }
  if (copy === 'draft') {
    if (doc.confirm.length) {
      B.push(p(run('CONFIRM ON GR', { b: true, u: true }), { align: 'center', pageBreak: true, after: 140 }));
      doc.confirm.forEach((c, i) => B.push(p(run(`${i + 1}.`) + TAB + run(c.text), { left: STEP, hanging: STEP })));
    }
    const basis = all.filter((l) => l.type === 'para' && l.p.basis.length && !l.p.mine);
    if (basis.length) {
      B.push(p(run('BASIS OF THE DRAFTED PARAGRAPHS', { b: true, u: true }), { align: 'center', pageBreak: true, after: 140 }));
      for (const l of basis) {
        if (l.type !== 'para') continue;
        B.push(p(run(`${numberOf(doc, l.p.id)}${l.p.head ? ` ${l.p.head}` : ''}. `, { b: true, size: 21 }) + run(`${l.p.basis.map((b) => `${b.kind[0].toUpperCase()}${b.kind.slice(1)}: ${b.text}`).join('. ')}.`, { size: 21 }), { after: 80 }));
      }
    }
    if (doc.sources.length) {
      B.push(p(run('DATA', { b: true, u: true }), { align: 'center', pageBreak: true, after: 140 }));
      doc.sources.forEach((s, i) => B.push(p(run(`${i + 1}.`) + TAB + run(s), { left: STEP, hanging: STEP })));
      const fr = doc.frame;
      if (fr) B.push(p(run(`Read ${fr.readAt}: ${fr.echelon} AOR (${fr.aor}), ${fr.mover}, ${fr.month}, ${fr.season === 'wet' ? 'after rain' : 'dry'}; threat ${fr.threat}. A plan to check on the ground.`, { size: 20, color: '444444' }), { before: 160 }));
    }
  }

  const sect = `<w:sectPr><w:headerReference w:type="default" r:id="rId1"/><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1247" w:left="1746" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
  const marking = '________________';
  const field = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const header = `${XML}<w:hdr ${NS}>${p(field, { align: 'center', after: 0 })}${p(run(marking), { align: 'center', after: 0 })}</w:hdr>`;
  const footer = `${XML}<w:ftr ${NS}>${p(run(marking), { align: 'center', after: 0 })}</w:ftr>`;
  const styles = `${XML}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;
  const out: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels.join('')}</Relationships>`,
    'word/document.xml': `${XML}<w:document ${NS}><w:body>${B.join('')}${sect}</w:body></w:document>`,
    'word/styles.xml': styles,
    'word/header1.xml': header,
    'word/footer1.xml': footer,
  };
  for (const [k, v] of Object.entries(media)) out[k] = v;
  return out;
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
