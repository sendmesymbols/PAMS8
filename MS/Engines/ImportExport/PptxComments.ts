/**
 * PptxComments.ts
 *
 * Native PowerPoint comments for the briefing exporter. pptxgenjs cannot write
 * comments, so the generated package is reopened and legacy PresentationML
 * comment parts are injected: ppt/commentAuthors.xml, one
 * ppt/comments/commentN.xml per commented slide, two relationships and two
 * content-type overrides.
 *
 * Legacy parts rather than modern threaded ones (p188): legacy is fully
 * specified in ISO/IEC 29500 and read by every PowerPoint version as well as
 * LibreOffice and Google Slides, where modern comments are a Microsoft
 * extension with GUID-named parts and thin public documentation.
 *
 * THE UNITS TRAP: ISO/IEC 29500 declares p:pos's x/y as ST_Coordinate (EMU),
 * but MS-OI29500 §19.4.5 note (b) records that PowerPoint actually reads them
 * as ST_EighthPointMeasure — 1/8 point, 1/576 inch. Writing EMUs puts every
 * marker in the slide's top-left corner.
 *
 * The XML and string work below is pure and separately exported so it can run
 * under bare `node` for tests, which is also why this module has NO runtime
 * imports (node's ESM resolver rejects the extensionless imports Vite accepts).
 */

/** 1/8 point = 1/576 inch — the unit of p:pos. See the note above. */
export const EIGHTH_POINTS_PER_INCH = 576;

export const REL_TYPE_COMMENTS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
export const REL_TYPE_COMMENT_AUTHORS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors';
export const CT_COMMENTS =
  'application/vnd.openxmlformats-officedocument.presentationml.comments+xml';
export const CT_COMMENT_AUTHORS =
  'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml';

const PML_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const DML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export interface PptxCommentRecord {
  /** 1-based pptx slide number this comment belongs to. */
  slide: number;
  author: string;
  /** ISO datetime. */
  at: string;
  text: string;
  /** Eighth-points from the slide's top-left. */
  x: number;
  y: number;
}

export interface PptxCommentParts {
  /** ppt/commentAuthors.xml */
  authorsXml: string;
  /** One per commented slide, in ascending slide order. */
  slideParts: Array<{ slide: number; path: string; xml: string }>;
}

function esc(v: string): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "Sara Khan" → "SK"; falls back to '?' for an empty name. */
function initialsOf(name: string): string {
  const letters = String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return letters.slice(0, 4) || '?';
}

/**
 * PowerPoint writes `dt` without a timezone suffix, at millisecond precision.
 * An unparseable value falls back to the epoch rather than emitting `Invalid
 * Date`, which would make the part unreadable.
 */
function dtOf(iso: string): string {
  const ms = Date.parse(iso);
  const d = new Date(Number.isFinite(ms) ? ms : 0);
  return d.toISOString().replace(/Z$/, '');
}

/** Records → the XML of every part that has to be added to the package. */
export function buildCommentParts(records: readonly PptxCommentRecord[]): PptxCommentParts {
  // Authors are ids 1..n in first-seen order; clrIdx is id-1 so PowerPoint
  // gives each one a different marker colour.
  const authorIds = new Map<string, number>();
  for (const r of records) {
    if (!authorIds.has(r.author)) authorIds.set(r.author, authorIds.size + 1);
  }

  // idx is unique per author across the whole document, starting at 1.
  const nextIdx = new Map<string, number>();
  const bySlide = new Map<number, string[]>();
  for (const r of [...records].sort((a, b) => a.slide - b.slide)) {
    const idx = (nextIdx.get(r.author) ?? 0) + 1;
    nextIdx.set(r.author, idx);
    const cm =
      `<p:cm authorId="${authorIds.get(r.author)}" dt="${dtOf(r.at)}" idx="${idx}">` +
      `<p:pos x="${Math.round(r.x)}" y="${Math.round(r.y)}"/>` +
      `<p:text>${esc(r.text)}</p:text>` +
      '</p:cm>';
    const list = bySlide.get(r.slide);
    if (list) list.push(cm);
    else bySlide.set(r.slide, [cm]);
  }

  const authorsXml =
    `${XML_DECL}<p:cmAuthorLst xmlns:p="${PML_NS}">` +
    [...authorIds.entries()]
      .map(
        ([name, id]) =>
          `<p:cmAuthor id="${id}" name="${esc(name)}" initials="${esc(initialsOf(name))}"` +
          ` lastIdx="${nextIdx.get(name) ?? 1}" clrIdx="${id - 1}"/>`,
      )
      .join('') +
    '</p:cmAuthorLst>';

  // The part NUMBER counts commented slides, not slide numbers: a deck whose
  // only comments are on slide 3 gets ppt/comments/comment1.xml.
  const slideParts = [...bySlide.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slide, cms], i) => ({
      slide,
      path: `ppt/comments/comment${i + 1}.xml`,
      xml: `${XML_DECL}<p:cmLst xmlns:a="${DML_NS}" xmlns:p="${PML_NS}">${cms.join('')}</p:cmLst>`,
    }));

  return { authorsXml, slideParts };
}

/**
 * Append a Relationship, allocating `rId(max+1)` **within this specific rels
 * part**. A fixed id would collide with pptxgenjs's own numbering and silently
 * break the package.
 */
export function addRelationship(relsXml: string, type: string, target: string): string {
  let max = 0;
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) {
    max = Math.max(max, Number(m[1]));
  }
  const rel = `<Relationship Id="rId${max + 1}" Type="${type}" Target="${esc(target)}"/>`;
  return relsXml.replace('</Relationships>', `${rel}</Relationships>`);
}

/** Append `<Override>` entries before `</Types>`, skipping any already present. */
export function addContentTypeOverrides(
  ctXml: string,
  overrides: ReadonlyArray<{ partName: string; contentType: string }>,
): string {
  const add = overrides
    .filter((o) => !ctXml.includes(`PartName="${o.partName}"`))
    .map((o) => `<Override PartName="${o.partName}" ContentType="${o.contentType}"/>`)
    .join('');
  return add ? ctXml.replace('</Types>', `${add}</Types>`) : ctXml;
}

export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/**
 * Map one comment's anchor to its position in eighth-points (see THE UNITS
 * TRAP above). Anchor priority mirrors `SlideComment`: a pinned overlay's box
 * top-right corner, then a normalized point, then a stacked slide-corner
 * fallback. `stackIndex` is the caller's running fallback counter — it only
 * advances for comments that actually reach the fallback branch, which is why
 * it is passed in rather than computed here.
 */
export function commentAnchorEighths(
  fit: { x: number; y: number; w: number; h: number },
  overlayBox: { x: number; y: number; w: number; h: number } | undefined,
  point: { x: number; y: number } | undefined,
  stackIndex: number,
): { x: number; y: number } {
  let xIn: number;
  let yIn: number;
  if (overlayBox) {
    // Box top-right, matching where the editor draws the marker.
    xIn = fit.x + (overlayBox.x + overlayBox.w) * fit.w;
    yIn = fit.y + overlayBox.y * fit.h;
  } else if (point) {
    xIn = fit.x + point.x * fit.w;
    yIn = fit.y + point.y * fit.h;
  } else {
    xIn = fit.x + 0.02 * fit.w;
    yIn = fit.y + (0.02 + stackIndex * 0.05) * fit.h;
  }
  return {
    x: Math.round(xIn * EIGHTH_POINTS_PER_INCH),
    y: Math.round(yIn * EIGHTH_POINTS_PER_INCH),
  };
}

/**
 * Inject legacy comment parts into a pptxgenjs-generated package.
 *
 * `window.JSZip` is read INSIDE the function, never at module scope, so this
 * module stays importable in node for the unit tests. The global is the pptxgen
 * bundle's first UMD segment — the same one PptxImporter already relies on, so
 * it is present whenever an export has just run.
 */
export async function injectPptxComments(
  pkg: ArrayBuffer,
  records: readonly PptxCommentRecord[],
  compress = false,
): Promise<Blob> {
  const JSZip = (globalThis as any).JSZip;
  if (!JSZip) throw new Error('window.JSZip unavailable — cannot inject comments');
  const zip = await JSZip.loadAsync(pkg);
  const parts = buildCommentParts(records);
  // Re-zipping here REPLACES pptxgenjs' own compression choice, so the flag has
  // to be threaded through — otherwise asking for a compressed deck and also
  // having comments would silently hand back a stored (uncompressed) package.
  const zipOpts = compress
    ? { type: 'blob', mimeType: PPTX_MIME, compression: 'DEFLATE', compressionOptions: { level: 6 } }
    : { type: 'blob', mimeType: PPTX_MIME };
  if (!parts.slideParts.length) return zip.generateAsync(zipOpts);

  zip.file('ppt/commentAuthors.xml', parts.authorsXml);
  for (const p of parts.slideParts) zip.file(p.path, p.xml);

  // presentation.xml.rels → commentAuthors.xml
  const presRelsPath = 'ppt/_rels/presentation.xml.rels';
  const presRels = await zip.file(presRelsPath)?.async('string');
  if (!presRels) throw new Error(`${presRelsPath} missing from the generated package`);
  zip.file(
    presRelsPath,
    addRelationship(presRels, REL_TYPE_COMMENT_AUTHORS, 'commentAuthors.xml'),
  );

  // slideN.xml.rels → ../comments/commentM.xml
  for (const p of parts.slideParts) {
    const relPath = `ppt/slides/_rels/slide${p.slide}.xml.rels`;
    const rels = await zip.file(relPath)?.async('string');
    if (!rels) throw new Error(`${relPath} missing — cannot attach comments to slide ${p.slide}`);
    const target = `../comments/${p.path.split('/').pop()}`;
    zip.file(relPath, addRelationship(rels, REL_TYPE_COMMENTS, target));
  }

  // [Content_Types].xml → one override per part
  const ctPath = '[Content_Types].xml';
  const ct = await zip.file(ctPath)?.async('string');
  if (!ct) throw new Error(`${ctPath} missing from the generated package`);
  zip.file(
    ctPath,
    addContentTypeOverrides(ct, [
      { partName: '/ppt/commentAuthors.xml', contentType: CT_COMMENT_AUTHORS },
      ...parts.slideParts.map((p) => ({
        partName: `/${p.path}`,
        contentType: CT_COMMENTS,
      })),
    ]),
  );

  return zip.generateAsync({ type: 'blob', mimeType: PPTX_MIME });
}
