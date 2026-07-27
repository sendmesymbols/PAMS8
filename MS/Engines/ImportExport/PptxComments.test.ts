/**
 * PptxComments.test.ts — run with: node MS/Engines/ImportExport/PptxComments.test.ts
 * Covers the PURE half of the comment injector; the JSZip glue is verified by
 * opening a real export in PowerPoint (see the plan's Task 6).
 */
import {
  addContentTypeOverrides,
  addRelationship,
  buildCommentParts,
  commentAnchorEighths,
  CT_COMMENT_AUTHORS,
  CT_COMMENTS,
  EIGHTH_POINTS_PER_INCH,
  REL_TYPE_COMMENT_AUTHORS,
  REL_TYPE_COMMENTS,
  type PptxCommentRecord,
} from './PptxComments.ts';

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`);
    failed++;
  }
}
function contains(name: string, haystack: string, needle: string): void {
  if (haystack.includes(needle)) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}\n       missing: ${needle}\n       in: ${haystack}`);
    failed++;
  }
}

console.log('units');
// 1/8 point = 1/576 inch. This constant is the whole reason comments land in
// the right place — PowerPoint reads p:pos as ST_EighthPointMeasure, not EMU.
check('eighth-points per inch', EIGHTH_POINTS_PER_INCH, 576);

const recs: PptxCommentRecord[] = [
  { slide: 1, author: 'Abdul', at: '2026-07-26T10:00:00.000Z', text: 'first', x: 100, y: 200 },
  { slide: 1, author: 'Abdul', at: '2026-07-26T10:05:00.000Z', text: 'second', x: 100, y: 200 },
  { slide: 3, author: 'Sara Khan', at: '2026-07-26T11:00:00.000Z', text: 'a < b & "c"', x: 50, y: 60 },
];
const parts = buildCommentParts(recs);

console.log('authors part');
contains('declares the pml namespace', parts.authorsXml,
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"');
contains('first author id 1, clrIdx 0', parts.authorsXml,
  '<p:cmAuthor id="1" name="Abdul" initials="A" lastIdx="2" clrIdx="0"/>');
contains('second author id 2, initials from both words', parts.authorsXml,
  '<p:cmAuthor id="2" name="Sara Khan" initials="SK" lastIdx="1" clrIdx="1"/>');

console.log('slide parts');
check('one part per commented slide', parts.slideParts.length, 2);
check('paths run 1..n over commented slides, not slide numbers',
  parts.slideParts.map((p) => p.path),
  ['ppt/comments/comment1.xml', 'ppt/comments/comment2.xml']);
check('parts carry their pptx slide number', parts.slideParts.map((p) => p.slide), [1, 3]);
contains('position emitted verbatim', parts.slideParts[0].xml, '<p:pos x="100" y="200"/>');
contains('idx increments per author', parts.slideParts[0].xml, 'idx="1"');
contains('second comment is idx 2', parts.slideParts[0].xml, 'idx="2"');
contains('dt drops the timezone suffix', parts.slideParts[0].xml, 'dt="2026-07-26T10:00:00.000"');
contains('text is XML-escaped', parts.slideParts[1].xml,
  '<p:text>a &lt; b &amp; &quot;c&quot;</p:text>');
contains('second author referenced by id', parts.slideParts[1].xml, 'authorId="2"');
check('no records means no parts', buildCommentParts([]).slideParts.length, 0);

console.log('dt fallback for unparseable date');
const unparseable = buildCommentParts([
  { slide: 1, author: 'Test', at: 'not-a-date', text: 'invalid', x: 0, y: 0 },
]);
contains('unparseable date falls back to epoch', unparseable.slideParts[0].xml,
  'dt="1970-01-01T00:00:00.000"');
check('does not emit Invalid Date string', unparseable.slideParts[0].xml.includes('Invalid Date'),
  false);

console.log('constants');
check('REL_TYPE_COMMENT_AUTHORS', REL_TYPE_COMMENT_AUTHORS,
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors');
check('CT_COMMENTS', CT_COMMENTS,
  'application/vnd.openxmlformats-officedocument.presentationml.comments+xml');
check('CT_COMMENT_AUTHORS', CT_COMMENT_AUTHORS,
  'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml');

console.log('addRelationship');
const rels =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="x" Target="a.xml"/>' +
  '<Relationship Id="rId7" Type="y" Target="b.xml"/>' +
  '</Relationships>';
const withRel = addRelationship(rels, REL_TYPE_COMMENTS, '../comments/comment1.xml');
contains('id is max+1, never a fixed number', withRel, 'Id="rId8"');
contains('keeps the existing relationships', withRel, 'Id="rId7"');
contains('inserted before the close tag', withRel, 'comment1.xml"/></Relationships>');
contains('empty rels part gets rId1',
  addRelationship(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
    REL_TYPE_COMMENTS,
    'x.xml',
  ),
  'Id="rId1"');

console.log('addContentTypeOverrides');
const ct =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Override PartName="/ppt/presentation.xml" ContentType="existing"/>' +
  '</Types>';
const withCt = addContentTypeOverrides(ct, [
  { partName: '/ppt/commentAuthors.xml', contentType: 'authors-ct' },
  { partName: '/ppt/comments/comment1.xml', contentType: 'comments-ct' },
]);
contains('adds the authors override', withCt,
  '<Override PartName="/ppt/commentAuthors.xml" ContentType="authors-ct"/>');
contains('adds a per-part comments override', withCt,
  '<Override PartName="/ppt/comments/comment1.xml" ContentType="comments-ct"/>');
contains('keeps existing overrides', withCt, 'PartName="/ppt/presentation.xml"');
check('an already-present override is not duplicated',
  (addContentTypeOverrides(withCt, [{ partName: '/ppt/commentAuthors.xml', contentType: 'authors-ct' }])
    .match(/commentAuthors\.xml/g) ?? []).length,
  1);

console.log('commentAnchorEighths');
// Full 16:9 slide, no letterboxing (fit == the whole 10x5.625in slide).
const fullFit = { x: 0, y: 0, w: 10, h: 5.625 };

// Overlay anchor: box top-right corner, matching where the editor draws its marker.
// (0.1+0.3)*10 = 4in -> 4*576 = 2304; 0.2*5.625 = 1.125in -> 1.125*576 = 648.
check(
  'overlay anchor lands on the box top-right corner',
  commentAnchorEighths(fullFit, { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, undefined, 0),
  { x: 2304, y: 648 },
);

// Normalized point anchor, with a letterboxed (non-zero-origin) fit.
// 0.5 + 0.5*9 = 5in -> 5*576 = 2880; 0 + 0.5*5.625 = 2.8125in -> 2.8125*576 = 1620.
const letterboxFit = { x: 0.5, y: 0, w: 9, h: 5.625 };
check(
  'point anchor used when there is no overlay',
  commentAnchorEighths(letterboxFit, undefined, { x: 0.5, y: 0.5 }, 7 /* ignored: overlay/point win over stack */),
  { x: 2880, y: 1620 },
);

// Slide-level fallback (no overlay, no point): x is fixed, y stacks down by
// 0.05 of fit.h per index — same corner the editor drops sequential markers into.
// x: 0.02*10 = 0.2in -> round(115.2) = 115 at every stack index.
// y(0): 0.02*5.625 = 0.1125in -> round(64.8) = 65
// y(1): 0.07*5.625 = 0.39375in -> round(226.8) = 227
// y(2): 0.12*5.625 = 0.675in -> round(388.8) = 389
check('fallback stack index 0', commentAnchorEighths(fullFit, undefined, undefined, 0), { x: 115, y: 65 });
check('fallback stack index 1', commentAnchorEighths(fullFit, undefined, undefined, 1), { x: 115, y: 227 });
check('fallback stack index 2', commentAnchorEighths(fullFit, undefined, undefined, 2), { x: 115, y: 389 });

// THE UNIT CONVERSION ITSELF: an isolated 1in-per-unit fit turns a point
// anchor directly into inches, so this pins EIGHTH_POINTS_PER_INCH (576) at
// the point of use. 2in -> 2*576 = 1152; 3in -> 3*576 = 1728. A regression to
// EMU (914400/in) or points (72/in) would fail this loudly.
check(
  'known inch value converts to the expected eighth-point integer',
  commentAnchorEighths({ x: 0, y: 0, w: 1, h: 1 }, undefined, { x: 2, y: 3 }, 0),
  { x: 1152, y: 1728 },
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
