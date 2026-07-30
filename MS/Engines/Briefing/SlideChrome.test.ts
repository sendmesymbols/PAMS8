/**
 * SlideChrome.test.ts — run with: node MS/Engines/Briefing/SlideChrome.test.ts
 * House style follows SlideLinks.test.ts: plain console assertions, non-zero
 * exit on failure. No test framework in this repo.
 */
import {
  BANNER_H,
  STRIP_H,
  chromeBands,
  chromeForSlide,
  chromeInsets,
  classificationColor,
  contentHeightFraction,
  contentRect,
  cssColor,
  expandTokens,
  formatDtg,
  formatSlideNumber,
  hasChrome,
  pageRect,
  resolveChrome,
  type DeckChrome,
} from './SlideChrome.ts';

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (cond) return;
  failures++;
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) return;
  failures++;
  console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
}
/** Float compare — band heights are fractions and never land on round numbers. */
function near(label: string, actual: number, expected: number, tol = 1e-9): void {
  if (Math.abs(actual - expected) <= tol) return;
  failures++;
  console.error(`FAIL  ${label} — expected ~${expected}, actual ${actual}`);
}

const ON: DeckChrome = { enabled: true };

// ── The enable gate ─────────────────────────────────────────────────────────
// The whole point of `enabled`: a deck whose settings hold a stale
// classification with the switch off must not start showing a banner.

check('no chrome without the gate', !hasChrome({ classification: 'SECRET' }));
check('gate alone is not chrome', !hasChrome({ enabled: true }));
check('gate plus content is chrome', hasChrome({ ...ON, classification: 'SECRET' }));
check('null is not chrome', !hasChrome(null));
check('slide numbers alone are chrome', hasChrome({ ...ON, slideNumbers: true }));
eq('nothing drawn without the gate', chromeBands({ classification: 'SECRET' }), []);
eq('no insets without the gate', chromeInsets({ classification: 'SECRET' }), { top: 0, bottom: 0 });

// ── resolveChrome: per-field precedence over the settings ───────────────────

eq(
  'settings supply what the deck omits',
  resolveChrome({ classification: 'SECRET' }, { useMaster: true, footerText: '1 Bde' }),
  { enabled: true, classification: 'SECRET', footerText: '1 Bde' },
);
eq(
  'deck wins field by field',
  resolveChrome(
    { classification: 'CUI' },
    { useMaster: true, classification: 'SECRET', footerText: '1 Bde' },
  ),
  { enabled: true, classification: 'CUI', footerText: '1 Bde' },
);
eq(
  'useMaster is the settings spelling of enabled',
  resolveChrome(null, { useMaster: true, classification: 'SECRET' }),
  { enabled: true, classification: 'SECRET' },
);
eq(
  "the deck's own enabled:false beats useMaster:true",
  resolveChrome({ enabled: false }, { useMaster: true, classification: 'SECRET' }),
  { classification: 'SECRET' },
);
eq('empty strings are dropped, not stored', resolveChrome({ classification: '   ' }, {}), {});
eq('whitespace is trimmed', resolveChrome({ classification: '  SECRET  ' }, {}), {
  classification: 'SECRET',
});
eq('a bogus number format falls away', resolveChrome({ numberFormat: 'roman' as any }, {}), {});
eq('n-of-m survives', resolveChrome({ numberFormat: 'n-of-m' }, {}), { numberFormat: 'n-of-m' });
eq('truthy-but-not-true booleans are not honoured', resolveChrome({ slideNumbers: 1 as any }, {}), {});
eq('resolve of nothing is nothing', resolveChrome(null, null), {});

// ── Bands: order, edges, and what carries text ──────────────────────────────

{
  const bands = chromeBands({
    ...ON,
    classification: 'SECRET',
    headerText: 'HEAD',
    footerText: 'FOOT',
  });
  eq('four bands', bands.length, 4);
  // Outermost first per edge — a consumer stacks top bands downward and bottom
  // bands upward in array order, so the banner has to come before the strips.
  eq(
    'classification precedes the strips',
    bands.map((b) => b.role),
    ['classification', 'classification', 'header', 'footer'],
  );
  eq(
    'a banner is drawn on both edges',
    bands.filter((b) => b.role === 'classification').map((b) => b.edge),
    ['top', 'bottom'],
  );
  eq('the header is a top band', bands.find((b) => b.role === 'header')!.edge, 'top');
  eq('the footer is a bottom band', bands.find((b) => b.role === 'footer')!.edge, 'bottom');
  eq('banners are bold', bands[0].bold, true);
  eq('banners are centred', bands[0].align, 'center');
  eq('strips are left-aligned', bands[2].align, 'left');
}

// A footer strip exists for the slide number alone — the number lives on it.
{
  const bands = chromeBands({ ...ON, slideNumbers: true }, { page: 3, pages: 9 });
  eq('numbers alone still make a strip', bands.length, 1);
  eq('and it is the footer', bands[0].role, 'footer');
  eq('with no text of its own', bands[0].text, '');
  eq('carrying the stamp', bands[0].rightText, '3');
}

// ── Insets ─────────────────────────────────────────────────────────────────

near('a banner reserves BANNER_H top', chromeInsets({ ...ON, classification: 'S' }).top, BANNER_H);
near(
  'and BANNER_H bottom',
  chromeInsets({ ...ON, classification: 'S' }).bottom,
  BANNER_H,
);
near('a header reserves STRIP_H top only', chromeInsets({ ...ON, headerText: 'H' }).top, STRIP_H);
eq('a header reserves nothing at the bottom', chromeInsets({ ...ON, headerText: 'H' }).bottom, 0);
near('a footer reserves STRIP_H bottom only', chromeInsets({ ...ON, footerText: 'F' }).bottom, STRIP_H);
eq('a footer reserves nothing at the top', chromeInsets({ ...ON, footerText: 'F' }).top, 0);
{
  const all: DeckChrome = { ...ON, classification: 'S', headerText: 'H', footerText: 'F' };
  near('banner + header stack at the top', chromeInsets(all).top, BANNER_H + STRIP_H);
  near('banner + footer stack at the bottom', chromeInsets(all).bottom, BANNER_H + STRIP_H);
  near('content is what is left', contentHeightFraction(all), 1 - 2 * (BANNER_H + STRIP_H));
}

// Insets must NOT depend on the token context: they are read once to size the
// editor canvas, and a strip that vanished on the slides where its template
// expanded to '' would make the canvas jump as you navigated.
{
  const c: DeckChrome = { ...ON, footerText: '{AUTHOR}' };
  eq(
    'an empty expansion keeps its strip',
    chromeInsets(c),
    chromeInsets(c),
  );
  near('and still reserves height', chromeInsets(c).bottom, STRIP_H);
  eq('even though the text is empty', chromeBands(c, { author: '' })[0].text, '');
}

// ── Per-slide suppression ──────────────────────────────────────────────────

{
  const c: DeckChrome = { ...ON, classification: 'SECRET' };
  check('a normal slide gets the chrome', chromeForSlide(c, 2, {}) === c);
  check('noChrome suppresses it', chromeForSlide(c, 2, { noChrome: true }) === null);
  check('a missing slide is fine', chromeForSlide(c, 2, null) === c);

  const skip: DeckChrome = { ...c, skipFirst: true };
  check('skipFirst clears slide 1', chromeForSlide(skip, 0, {}) === null);
  check('but not slide 2', chromeForSlide(skip, 1, {}) === skip);
  check('skipFirst without chrome is still null', chromeForSlide({ skipFirst: true }, 5, {}) === null);
}

// ── Tokens ─────────────────────────────────────────────────────────────────

const NOW = new Date(Date.UTC(2026, 6, 29, 14, 30));
eq('DTG is DDHHMMZMONYY, UTC', formatDtg(NOW), '291430ZJUL26');
eq('DTG pads single digits', formatDtg(new Date(Date.UTC(2026, 0, 5, 3, 7))), '050307ZJAN26');

eq('DTG token', expandTokens('{DTG}', { now: NOW }), '291430ZJUL26');
eq('DATE token', expandTokens('{DATE}', { now: NOW }), '2026-07-29');
eq('deck title is {TITLE}', expandTokens('{TITLE}', { deckTitle: 'OP HUSKY' }), 'OP HUSKY');
eq('slide title is {SLIDE}', expandTokens('{SLIDE}', { slideTitle: 'Scheme of Manoeuvre' }), 'Scheme of Manoeuvre');
eq('section token', expandTokens('{SECTION}', { section: 'Execution' }), 'Execution');
eq('page tokens', expandTokens('{PAGE} of {PAGES}', { page: 4, pages: 12 }), '4 of 12');
eq('tokens are case-insensitive', expandTokens('{dtg}|{Date}', { now: NOW }), '291430ZJUL26|2026-07-29');
eq('several tokens in one template', expandTokens('{COMPANY} · {AUTHOR}', { company: '1 Bde', author: 'S3' }), '1 Bde · S3');
// An unresolved token must not reach a projector as literal braces.
eq('unset tokens become empty', expandTokens('[{AUTHOR}]', {}), '[]');
eq('page 0 is not a page', expandTokens('{PAGE}', { page: 0 }), '');
eq('literal text is untouched', expandTokens('1 Bde', {}), '1 Bde');
eq('a null template is empty', expandTokens(null as any, {}), '');

// ── Slide numbering ────────────────────────────────────────────────────────

eq('bare number', formatSlideNumber('n', 7, 24), '7');
eq('n of m', formatSlideNumber('n-of-m', 7, 24), '7 / 24');
eq('undefined format is bare', formatSlideNumber(undefined, 7, 24), '7');
// A total that is not known must degrade rather than print "7 / 0".
eq('n-of-m without a total is bare', formatSlideNumber('n-of-m', 7, 0), '7');
eq('n-of-m with an undefined total is bare', formatSlideNumber('n-of-m', 7, undefined), '7');
eq('no page, no stamp', formatSlideNumber('n', 0, 24), '');
eq('a negative page is no page', formatSlideNumber('n', -1, 24), '');

// ── Classification colours ─────────────────────────────────────────────────

// Longest-prefix-first, or 'TOP SECRET//SCI' would be coloured as SECRET.
eq('TOP SECRET beats SECRET', classificationColor('TOP SECRET//SCI'), 'FF8C00');
eq('SECRET', classificationColor('SECRET//NOFORN'), 'C8102E');
eq('CONFIDENTIAL', classificationColor('CONFIDENTIAL'), '0033A0');
eq('RESTRICTED shares the blue', classificationColor('RESTRICTED'), '0033A0');
eq('UNCLASSIFIED', classificationColor('UNCLASSIFIED//FOUO'), '007A33');
eq('CUI', classificationColor('CUI'), '502B85');
eq('lower case still matches', classificationColor('secret'), 'C8102E');
eq('an unknown marking is grey, not a wrong colour', classificationColor('NATO RESTREINT'), '3A4450');
eq('empty is grey', classificationColor(''), '3A4450');
eq('css adds the hash', cssColor('C8102E'), '#C8102E');
eq('css does not double the hash', cssColor('#C8102E'), '#C8102E');

// ── Page / content rect round trip ─────────────────────────────────────────

{
  const chrome: DeckChrome = { ...ON, classification: 'SECRET', footerText: 'F' };
  const page = { left: 0, top: 0, width: 1600, height: 900 };
  const content = contentRect(page, chrome);
  const ins = chromeInsets(chrome);

  near('content starts below the top bands', content.top, ins.top * 900);
  near('content keeps the full width', content.width, 1600);
  near('content height is what is left', content.height, 900 * (1 - ins.top - ins.bottom));

  // The editor goes the other way: its canvas IS the content rect, so the page
  // has to be derived back out of it. Round-tripping must land where it started.
  const back = pageRect(content, chrome);
  near('page round-trips: top', back.top, page.top, 1e-6);
  near('page round-trips: height', back.height, page.height, 1e-6);
  near('page round-trips: left', back.left, page.left, 1e-6);
}
{
  // No chrome: the content rect is the page, untouched.
  const page = { left: 12, top: 34, width: 800, height: 450 };
  eq('no chrome leaves the page alone', contentRect(page, null), page);
  eq('and the inverse is identity too', pageRect(page, null), page);
}
{
  // A pathological definition must not produce a zero or negative content area.
  const absurd: DeckChrome = { ...ON, classification: 'S', headerText: 'H', footerText: 'F' };
  const c = contentRect({ left: 0, top: 0, width: 100, height: 10 }, absurd);
  check('content height stays positive', c.height > 0, c.height);
}

// ── Export/editor agreement on band proportions ────────────────────────────
// The exporter multiplies band heights by slide height in inches; the editor
// multiplies by page height in pixels. Both must give the same RATIO of band to
// content, or the canvas and the .pptx disagree about where the map sits.
{
  const chrome: DeckChrome = { ...ON, classification: 'SECRET', footerText: 'F' };
  const ratio = (pageH: number): number => {
    const band = BANNER_H * pageH;
    const content = pageH * contentHeightFraction(chrome);
    return band / content;
  };
  near('band:content ratio is scale-free', ratio(7.5), ratio(900), 1e-9);
  // 0.26in on a 7.5in slide is what the exporter drew before the chrome became
  // proportional — the two standard PowerPoint layouts are both 7.5in tall.
  near('BANNER_H reproduces 0.26in at 7.5in', BANNER_H * 7.5, 0.26, 1e-12);
  near('STRIP_H reproduces 0.22in at 7.5in', STRIP_H * 7.5, 0.22, 1e-12);
}

if (failures) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('SlideChrome: all assertions passed');
