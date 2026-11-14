/**
 * GroundGuideIpbTemplateView.ts
 *
 * Tab 5 page 2 of the Extended View (IPB_Plan.md §6.7; Phase 7): the situation template laid on the area read
 * (GroundGuideIpbTemplate.ts, worked out in GroundGuide.ts), its check, the template phases and the templates library,
 * plus the rail's row and Copy as Text. Shares the avenue cards' styles (GroundGuideIpbApchView.ts).
 */

import { fmtDistance } from './GroundGuideEvaluator';
import { FONT } from './GroundGuideTokens';
import { ensureApchCss } from './GroundGuideIpbApchView';
import type { GroundGuideOcoka, IpbApchView, IpbTemplateView, MercXY } from './GroundGuideTypes';

const SVGNS = 'http://www.w3.org/2000/svg';
const RED = '#ff6b6f';
const MOVED = '#ffb02e';
const KNOWN = '#8ec1ea';
const LETTER: Record<string, string> = { armour: 'A', mech: 'M', dismounted: 'I', gun: 'G' };
const MOVER: Record<string, string> = { armour: 'tanks', mech: 'mech', dismounted: 'inf', gun: 'guns' };
const STATUS: Record<string, string> = { fixed: 'fixed', ok: 'ok', moved: 'moved', known: 'known', outside: 'outside', nowhere: 'no Gr', none: 'no place' };

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function svgEl(tag: string, attrs: Record<string, string | number>, parent?: Element, text?: string): SVGElement {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}
function tile(caption: string, ...content: Array<Node | string | null | undefined | false>): HTMLElement {
  const sec = el('div', 'ms-ggb-sec');
  sec.append(el('div', 'ms-ggb-cap ms-ggd-cap', caption));
  for (const c of content) if (c) sec.append(c);
  return sec;
}
const note = (text: string): HTMLElement => el('div', 'ms-gx-note', text);
const km = (m: number): string => (m >= 10000 ? `${Math.round(m / 1000)} km` : fmtDistance(m));

/** The area read with the avenues and the template: doctrine's place (a hollow ring), the ground's (the diamond). */
function templatePicture(o: GroundGuideOcoka, v: IpbApchView, tv: IpbTemplateView, wpx = 380): SVGSVGElement {
  const pts: MercXY[] = [...v.frame, ...tv.elements.filter((e) => e.status !== 'none' && e.status !== 'outside').map((e) => e.at)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = 12;
  const sc = (wpx - 2 * pad) / Math.max(1, x1 - x0);
  const hpx = Math.round(Math.min(420, Math.max(180, (y1 - y0) * sc + 2 * pad)));
  const s = Math.min(sc, (hpx - 2 * pad) / Math.max(1, y1 - y0));
  const ox = (wpx - (x1 - x0) * s) / 2, oy = (hpx - (y1 - y0) * s) / 2;
  const X = (p: MercXY): number => ox + (p[0] - x0) * s;
  const Y = (p: MercXY): number => oy + (y1 - p[1]) * s;
  const d = (ps: MercXY[], close = false): string => ps.map((p, i) => `${i ? 'L' : 'M'}${X(p).toFixed(1)} ${Y(p).toFixed(1)}`).join('') + (close ? 'Z' : '');
  const svg = svgEl('svg', { width: wpx, height: hpx, viewBox: `0 0 ${wpx} ${hpx}`, class: 'ms-gia-pic' }) as SVGSVGElement;
  svgEl('rect', { width: wpx, height: hpx, fill: '#11161b', rx: 8 }, svg);
  const clip = `ms-gtp-clip-${Math.random().toString(36).slice(2, 8)}`;
  const cp = svgEl('clipPath', { id: clip }, svgEl('defs', {}, svg));
  svgEl('rect', { width: wpx, height: hpx, rx: 8 }, cp);
  const g = svgEl('g', { 'clip-path': `url(#${clip})` }, svg);
  if (v.raster) {
    const [rx0, ry0, rx1, ry1] = v.raster.extent;
    svgEl('image', { href: v.raster.url, x: X([rx0, ry1]).toFixed(1), y: Y([rx0, ry1]).toFixed(1), width: ((rx1 - rx0) * s).toFixed(1), height: ((ry1 - ry0) * s).toFixed(1), preserveAspectRatio: 'none', opacity: 0.4 }, g);
  }
  if (v.frame.length === 4) svgEl('path', { d: d(v.frame, true), fill: 'none', stroke: '#e9edf1', 'stroke-opacity': 0.5, 'stroke-width': 1, 'stroke-dasharray': '4 3' }, g);
  for (const a of v.aas) svgEl('path', { d: d(a.line), fill: 'none', stroke: a.viable ? (v.side === 'enemy' ? '#ff5a60' : '#8ec1ea') : '#aab2ba', 'stroke-opacity': 0.55, 'stroke-width': a.main ? 2 : 1.3, 'stroke-dasharray': a.main ? '' : '5 3' }, g);
  const k = Math.cosh(((y0 + y1) / 2) / 6378137);
  for (const e of tv.elements) {
    if (e.status === 'none') continue;
    const cx = X(e.at), cy = Y(e.at);
    const r = Math.max(3, e.footM * k * s);
    if (e.doc && e.movedM > 0 && (e.status === 'moved' || e.status === 'known')) {
      svgEl('path', { d: d([e.doc, e.at]), stroke: '#e9edf1', 'stroke-width': 1.1, 'stroke-dasharray': '3 2', fill: 'none' }, g);
      svgEl('circle', { cx: X(e.doc).toFixed(1), cy: Y(e.doc).toFixed(1), r: 4, fill: 'none', stroke: '#e9edf1', 'stroke-width': 1 }, g);
    }
    if (e.role === 'objective') svgEl('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r: r.toFixed(1), fill: RED, 'fill-opacity': 0.08, stroke: RED, 'stroke-width': 1.6, 'stroke-dasharray': '5 3' }, g);
    else if (e.role === 'assy') svgEl('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r: r.toFixed(1), fill: 'none', stroke: RED, 'stroke-width': 1.2, 'stroke-dasharray': '2 2' }, g);
    else if (e.box && e.box.length === 4) svgEl('path', { d: d(e.box, true), fill: RED, 'fill-opacity': 0.08, stroke: RED, 'stroke-width': 1.5, 'stroke-dasharray': '5 3' }, g);
    else if (e.role === 'fup') {
      const b = (e.dirDeg * Math.PI) / 180;
      const qx = Math.cos(b), qy = Math.sin(b);
      svgEl('path', { d: `M${(cx - qx * r).toFixed(1)} ${(cy - qy * r).toFixed(1)}L${(cx + qx * r).toFixed(1)} ${(cy + qy * r).toFixed(1)}`, stroke: RED, 'stroke-width': 2.2 }, g);
    }
    if (e.mover && e.role !== 'fup' && e.role !== 'assy' && !e.box) {
      const ring = e.status === 'moved' ? MOVED : e.status === 'known' ? KNOWN : null;
      if (ring) svgEl('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r: 9, fill: 'none', stroke: ring, 'stroke-width': 1.8 }, g);
      svgEl('path', { d: `M${cx.toFixed(1)} ${(cy - 7).toFixed(1)}l7 7-7 7-7-7z`, fill: '#5a1d22', stroke: RED, 'stroke-width': 1.4, opacity: e.status === 'outside' ? 0.5 : 1 }, g);
      svgEl('text', { x: cx.toFixed(1), y: (cy + 3.6).toFixed(1), 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 800, fill: '#fff', 'font-family': FONT }, g, LETTER[e.mover] ?? '?');
      if (e.status === 'nowhere') svgEl('path', { d: `M${(cx - 6).toFixed(1)} ${(cy - 6).toFixed(1)}l12 12m0-12l-12 12`, stroke: '#fff', 'stroke-width': 1.6 }, g);
    }
  }
  const sx = X(o.at), sy = Y(o.at);
  svgEl('rect', { x: (sx - 5).toFixed(1), y: (sy - 4).toFixed(1), width: 10, height: 8, rx: 1.5, fill: '#1d3f66', stroke: '#8ec1ea', 'stroke-width': 1.5 }, g);
  svgEl('text', { x: wpx - 14, y: 18, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 800, fill: '#fff', 'font-family': FONT }, svg, 'N↑');
  const kmPx = 1000 * k * s;
  const barKm = kmPx * 5 < wpx * 0.4 ? 5 : kmPx * 2 < wpx * 0.4 ? 2 : 1;
  svgEl('path', { d: `M12 ${hpx - 12}h${(barKm * kmPx).toFixed(1)}`, stroke: '#fff', 'stroke-width': 2.2 }, svg);
  svgEl('text', { x: (12 + (barKm * kmPx) / 2).toFixed(1), y: hpx - 17, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#fff', 'font-family': FONT }, svg, `${barKm} km`);
  return svg;
}

function checkTable(tv: IpbTemplateView): HTMLElement {
  const t = el('table', 'ms-gia-dt');
  const h = el('tr');
  for (const x of ['Element', 'Check']) h.append(el('th', undefined, x));
  t.append(h);
  for (const e of tv.elements) {
    const tr = el('tr');
    const a = el('td', 'ms-dp', e.label);
    a.style.color = e.status === 'moved' ? MOVED : e.status === 'known' ? KNOWN : e.status === 'nowhere' ? '#ff9a9d' : e.status === 'none' || e.status === 'outside' ? '#9aa3ad' : '#e6eaee';
    const b = el('td');
    const chip = el('span', 'ms-gia-chip', STATUS[e.status] ?? e.status);
    if (e.status === 'moved') chip.classList.add('ms-no');
    else if (e.status === 'ok' || e.status === 'known') chip.classList.add('ms-ok');
    b.append(chip, document.createTextNode(` ${e.mover ? `${MOVER[e.mover]} · ` : ''}${e.why}`));
    b.title = `${e.basis}${e.src ? ` · ${e.src}` : ''}`;
    tr.append(a, b);
    t.append(tr);
  }
  return t;
}

/** Tab 5 page 2: the situation template, its check, the template phases, the library, Create on Map. */
export function templateTiles(o: GroundGuideOcoka): HTMLElement[] {
  const v = o.ipbApch;
  const tv = v?.template;
  if (v === undefined || tv === undefined) return [];
  ensureApchCss();
  if (!v || !tv) {
    const t = tile('Situation Template', note('Laying the doctrinal template along the avenues and checking it on the ground.'));
    t.classList.add('ms-ggd-brk');
    return [t];
  }
  const out: HTMLElement[] = [];
  const key = el('div', 'ms-gia-key');
  const kk = (c: string, t: string): void => {
    const s = el('span');
    const i = el('i');
    i.style.background = c;
    s.append(i, t);
    key.append(s);
  };
  kk(RED, 'en element (A tanks, M mech, I inf, G guns)');
  kk(MOVED, 'moved by the Gr');
  kk(KNOWN, 'known: not moved');
  const pic = tile(`Situation Template · ${tv.label}`, templatePicture(o, v, tv), key, note(tv.text));
  pic.classList.add('ms-ggd-brk');
  out.push(pic);
  const ck = tile(
    `Template Check · ${tv.moved} moved${tv.known ? ` · ${tv.known} known` : ''}`,
    checkTable(tv),
    note(`Each element on its own mover's IPB coding: more than a quarter NO-GO, or guns high on a hill, and it goes to the nearest usable ground within 3 km. An enemy symbol on the map takes its place and is never moved (book p 23).${tv.notes.length ? ` ${tv.notes.join(' ')}` : ''}`),
  );
  ck.classList.add('ms-ggd-brk');
  out.push(ck);
  const ph = el('div', 'ms-gx-list');
  for (const r of tv.phases.rows) {
    const k2 = el('div', undefined, r.phase);
    const v2 = el('div', undefined, r.time);
    v2.title = `${r.basis} · ${r.src}`;
    ph.append(k2, v2);
  }
  const pt = tile(tv.phases.label, ph, note('Hover a line for its source. KYE timings from M (mobilisation); the Desert Warfare and OoW figures as written.'));
  pt.classList.add('ms-ggd-brk');
  out.push(pt);
  const lib = el('div', 'ms-gia-acts');
  const btn = (id: string, text: string, title: string, on: boolean): void => {
    const b = el('button', on ? 'ms-gia-btn ms-all' : 'ms-gia-btn', text) as HTMLButtonElement;
    b.type = 'button';
    b.title = title;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      b.dispatchEvent(new CustomEvent('ms-gg-ipb-tpl', { bubbles: true, detail: { id } }));
    });
    lib.append(b);
  };
  btn('auto', 'Auto', 'The template that fits Read for and the HQ row (a mountain one in mountains)', tv.auto);
  for (const t of tv.library) btn(t.id, t.label, `${t.kind === 'attack' ? 'En attack' : 'En defence'} · fits ${t.fits} · basis ${t.basis}`, !tv.auto && t.chosen);
  btn('off', 'Off', 'No template (not worked out)', false);
  out.push(
    tile(
      'Templates',
      lib,
      note(`${tv.confirmed ? '' : 'Some figures are my readings of the book\'s Fig 6 / 7 images, not yet confirmed. '}Templates are rough approximations, not fact; over-reliance invites deception (book p 32). Source: ${tv.src}.`),
    ),
  );
  const acts = el('div', 'ms-gia-acts');
  const b = el('button', 'ms-gia-btn ms-all', 'Template') as HTMLButtonElement;
  b.type = 'button';
  b.title = 'The template as the enemy\'s symbols where the ground lets them be: objectives, FUP, assembly areas, bridgeheads, units';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    b.dispatchEvent(new CustomEvent('ms-gg-ipb-create', { bubbles: true, detail: { kind: 'template' } }));
  });
  acts.append(b);
  out.push(tile('Create on Map', acts, note('Hostile symbols, one undo step; making them again replaces them.')));
  return out;
}

export function templateScopeRows(o: GroundGuideOcoka): Array<{ icon: 'avenue' | 'choke'; bold: string; rest: string }> {
  const tv = o.ipbApch?.template;
  if (!tv) return [];
  const mv = tv.elements.find((e) => e.status === 'moved');
  return [{ icon: 'choke', bold: `Tpl ${tv.label}`, rest: mv ? `${tv.moved} moved: ${mv.label} ${km(mv.movedM)}` : tv.known ? `${tv.known} known` : 'fits the Gr' }];
}

export function templateText(o: GroundGuideOcoka): string[] {
  const tv = o.ipbApch?.template;
  if (!tv) return [];
  const L = [`Situation template: ${tv.label} (${tv.kind === 'attack' ? 'en attack' : 'en defence'}; ${tv.src}${tv.confirmed ? '' : '; Fig 6 / 7 readings unconfirmed'}).`];
  for (const e of tv.elements) if (e.status !== 'none') L.push(`  ${e.label}: ${STATUS[e.status]}${e.mover ? ` (${MOVER[e.mover]})` : ''}, ${e.why}.`);
  for (const n of tv.notes) L.push(`  ${n}`);
  L.push(`  ${tv.phases.label}:`);
  for (const r of tv.phases.rows) L.push(`    ${r.phase}: ${r.time} (${r.src}).`);
  L.push('  Templates are rough approximations, not fact; over-reliance invites deception (book p 32).');
  return L;
}
