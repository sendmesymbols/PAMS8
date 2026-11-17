/**
 * CrossSectionChart.ts
 *
 * The cross-section as one SVG string (no DOM, so Node can test it): the ground's height along the line with the steep
 * stretches in red; under it a band of the going for the mover (GO / SLOW-GO / NO-GO, grey where not read), a row of the
 * obstacles crossed or followed, and (with a threat) a band of what the threat sees; distance markers along the foot;
 * no-data stretches hatched across the whole height with their reason. Colours from GroundGuideTokens' going colours.
 */

import type { LineProfile, ObstacleKind } from '../SiteScan/SiteLine';

const GO = '#2fa862', SLOW = '#ee8a1f', NOGO = '#e5484d', NONE = '#5d6772', SEEN = '#a78bfa', ACCENT = '#8ec1ea';

export interface ChartLayout {
  W: number;
  H: number;
  padL: number;
  padR: number;
  plotTop: number;
  plotH: number;
  goingY: number;
  obstY: number;
  seenY: number;
  axisY: number;
  /** Chart x for a chainage. */
  x: (m: number) => number;
  /** Chart y for a height. */
  y: (e: number) => number;
  eMin: number;
  eMax: number;
}

const KIND_GLYPH: Record<ObstacleKind, { c: string; s: string }> = {
  canal: { c: '#4aa8ff', s: 'W' }, drain: { c: '#4aa8ff', s: 'D' }, river: { c: '#4aa8ff', s: 'S' }, water: { c: '#4aa8ff', s: 'W' },
  marsh: { c: '#6fb3a8', s: 'M' }, rail: { c: '#d5dbe1', s: 'R' }, road: { c: '#f1d646', s: 'r' }, bridge: { c: '#f1d646', s: 'B' },
  footBridge: { c: '#c3cbd3', s: 'b' }, railBridge: { c: '#d5dbe1', s: 'B' }, ford: { c: '#4aa8ff', s: 'F' }, bua: { c: '#ff8a8d', s: 'U' },
  bund: { c: '#c79a5b', s: 'b' }, cutting: { c: '#c79a5b', s: 'c' }, cliff: { c: NOGO, s: 'C' }, wall: { c: '#c3cbd3', s: 'w' },
  dunes: { c: '#e6c27a', s: 'd' }, forest: { c: '#2fa862', s: 'T' }, nullah: { c: '#c79a5b', s: 'n' }, steep: { c: NOGO, s: '^' },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Nice step for distance markers: 0.1 / 0.2 / 0.5 / 1 / 2 / 5 / 10 km... about `n` across. */
export function markerStep(lengthM: number, n = 8): number {
  const raw = lengthM / n;
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  for (const k of [1, 2, 5, 10]) if (k * p >= raw) return k * p;
  return 10 * p;
}

export function layout(p: LineProfile, W: number, withSeen: boolean): ChartLayout {
  const padL = 46, padR = 12, plotTop = 12, plotH = 150;
  const goingY = plotTop + plotH + 8;
  const obstY = goingY + 18;
  const seenY = obstY + 26;
  const axisY = (withSeen ? seenY + 14 : obstY + 26) + 4;
  const H = axisY + 18;
  const lo = p.stats.minElev ?? 0, hi = p.stats.maxElev ?? 1;
  const pad = Math.max(5, (hi - lo) * 0.08);
  const eMin = lo - pad, eMax = hi + pad;
  const L = Math.max(1, p.lengthM);
  return {
    W, H, padL, padR, plotTop, plotH, goingY, obstY, seenY, axisY,
    x: (m) => padL + (m / L) * (W - padL - padR),
    y: (e) => plotTop + plotH - ((e - eMin) / Math.max(1, eMax - eMin)) * plotH,
    eMin, eMax,
  };
}

export function chartSvg(p: LineProfile, W: number, o: { withSeen: boolean; km: (m: number) => string }): { svg: string; L: ChartLayout } {
  const L = layout(p, W, o.withSeen);
  const { x, y } = L;
  const parts: string[] = [];
  parts.push(`<defs><pattern id="xsHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#20262e"/><line x1="0" y1="0" x2="0" y2="6" stroke="#5d6772" stroke-width="2"/></pattern>` +
    `<linearGradient id="xsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.45"/><stop offset="100%" stop-color="${ACCENT}" stop-opacity="0.05"/></linearGradient></defs>`);
  // grid: three heights
  for (const e of [L.eMin, (L.eMin + L.eMax) / 2, L.eMax]) {
    parts.push(`<line x1="${L.padL}" x2="${W - L.padR}" y1="${y(e).toFixed(1)}" y2="${y(e).toFixed(1)}" stroke="rgba(255,255,255,.1)"/>`);
    parts.push(`<text x="${L.padL - 5}" y="${(y(e) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#c3cbd3">${Math.round(e)}</text>`);
  }
  parts.push(`<text x="${L.padL}" y="${L.plotTop - 2}" font-size="10" fill="#9aa3ad">m</text>`);
  // no-data stretches across the full height
  for (const g of p.gaps) {
    const x0 = x(g.fromM), x1 = Math.max(x0 + 2, x(g.toM));
    parts.push(`<rect x="${x0.toFixed(1)}" y="${L.plotTop}" width="${(x1 - x0).toFixed(1)}" height="${(L.obstY + 20 - L.plotTop).toFixed(1)}" fill="url(#xsHatch)" opacity="0.85"><title>No data: ${g.what === 'both' ? 'height and ground class' : g.what === 'elev' ? 'height' : 'ground class'} ${o.km(g.fromM)}-${o.km(g.toM)}</title></rect>`);
  }
  // the ground: filled area and line, broken where the height is missing
  const segs: string[][] = [];
  let cur: string[] = [];
  for (const s of p.samples) {
    if (!Number.isFinite(s.elev)) {
      if (cur.length) segs.push(cur);
      cur = [];
      continue;
    }
    cur.push(`${x(s.m).toFixed(1)},${y(s.elev).toFixed(1)}`);
  }
  if (cur.length) segs.push(cur);
  const floor = (L.plotTop + L.plotH).toFixed(1);
  for (const sg of segs) {
    if (sg.length < 2) continue;
    const first = sg[0].split(',')[0], last = sg[sg.length - 1].split(',')[0];
    parts.push(`<path d="M ${first},${floor} L ${sg.join(' L ')} L ${last},${floor} Z" fill="url(#xsFill)"/>`);
    parts.push(`<path d="M ${sg.join(' L ')}" fill="none" stroke="${ACCENT}" stroke-width="1.8"/>`);
  }
  // steep stretches over the line
  for (const st of p.steep) {
    const pts = p.samples.filter((s) => s.m >= st.fromM && s.m <= st.toM && Number.isFinite(s.elev)).map((s) => `${x(s.m).toFixed(1)},${y(s.elev).toFixed(1)}`);
    if (pts.length >= 2) parts.push(`<path d="M ${pts.join(' L ')}" fill="none" stroke="${NOGO}" stroke-width="3.2"><title>Steep ${esc(st.why)}</title></path>`);
  }
  // going band
  parts.push(`<text x="${L.padL - 5}" y="${L.goingY + 10}" text-anchor="end" font-size="10" fill="#c3cbd3">Going</text>`);
  for (const r of p.runs) {
    const x0 = x(r.fromM), x1 = Math.max(x0 + 0.8, x(r.toM));
    const c = r.going === 'go' ? GO : r.going === 'slow' ? SLOW : r.going === 'nogo' ? NOGO : NONE;
    parts.push(`<rect x="${x0.toFixed(1)}" y="${L.goingY}" width="${(x1 - x0).toFixed(1)}" height="12" fill="${c}"/>`);
  }
  // obstacles: a tick and a letter each; words where there is room
  parts.push(`<text x="${L.padL - 5}" y="${L.obstY + 12}" text-anchor="end" font-size="10" fill="#c3cbd3">Obst</text>`);
  let lastLabelX = -Infinity;
  for (const e of p.events) {
    const g = KIND_GLYPH[e.kind];
    const xm = x(e.m);
    if (e.mode !== 'cross') {
      const x0 = x(e.fromM), x1 = Math.max(x0 + 2, x(e.toM));
      parts.push(`<rect x="${x0.toFixed(1)}" y="${L.obstY + 2}" width="${(x1 - x0).toFixed(1)}" height="4" fill="${g.c}" opacity="0.8"/>`);
    }
    parts.push(`<g><title>${esc(e.label)} at ${o.km(e.m)}${e.going ? ` (${e.going === 'nogo' ? 'NO-GO' : e.going === 'slow' ? 'SLOW-GO' : 'GO'})` : ''}</title><line x1="${xm.toFixed(1)}" x2="${xm.toFixed(1)}" y1="${L.obstY}" y2="${L.obstY + 8}" stroke="${g.c}" stroke-width="2"/>` +
      `<text x="${xm.toFixed(1)}" y="${L.obstY + 19}" text-anchor="middle" font-size="10" font-weight="700" fill="${g.c}">${esc(g.s)}</text></g>`);
    // a word only where it does not run into the last one (about 5.6 px a letter at 10 px)
    const word = e.label.length > 18 ? e.label.slice(0, 17) + '…' : e.label;
    if (xm + 6 > lastLabelX + 8 && xm + 6 + word.length * 5.6 < W - L.padR && e.kind !== 'steep') {
      parts.push(`<text x="${(xm + 6).toFixed(1)}" y="${L.obstY + 8}" font-size="10" fill="#d5dbe1" stroke="#1b1f25" stroke-width="3" paint-order="stroke">${esc(word)}</text>`);
      lastLabelX = xm + 6 + word.length * 5.6;
    }
  }
  // what the threat sees
  if (o.withSeen) {
    parts.push(`<text x="${L.padL - 5}" y="${L.seenY + 8}" text-anchor="end" font-size="10" fill="#c3cbd3">Seen</text>`);
    for (let i = 0; i < p.samples.length; i++) {
      const s = p.samples[i];
      const x0 = x(s.m), x1 = x(i + 1 < p.samples.length ? p.samples[i + 1].m : p.lengthM);
      const c = s.seen === null ? NONE : s.seen >= 0.5 ? SEEN : 'rgba(167,139,250,.18)';
      parts.push(`<rect x="${x0.toFixed(1)}" y="${L.seenY}" width="${Math.max(0.6, x1 - x0).toFixed(1)}" height="8" fill="${c}"/>`);
    }
  }
  // distance markers
  const step = markerStep(p.lengthM);
  for (let m = 0; m <= p.lengthM + 1e-6; m += step) {
    const xm = x(m);
    parts.push(`<line x1="${xm.toFixed(1)}" x2="${xm.toFixed(1)}" y1="${L.axisY - 4}" y2="${L.axisY + 2}" stroke="#9aa3ad"/>`);
    parts.push(`<text x="${xm.toFixed(1)}" y="${L.axisY + 14}" text-anchor="middle" font-size="11" fill="#c3cbd3">${esc(o.km(m))}</text>`);
  }
  parts.push(`<line x1="${L.padL}" x2="${W - L.padR}" y1="${L.axisY - 4}" y2="${L.axisY - 4}" stroke="#5d6772"/>`);
  // hover layer
  parts.push(`<g class="xs-hover" style="display:none;pointer-events:none"><line class="xs-hl" y1="${L.plotTop}" y2="${L.axisY - 4}" stroke="#ffc800" stroke-dasharray="3 3"/><circle class="xs-hd" r="4" fill="#ffc800" stroke="#14181d" stroke-width="1.5"/></g>`);
  parts.push(`<rect class="xs-hit" x="${L.padL}" y="${L.plotTop}" width="${W - L.padL - L.padR}" height="${L.axisY - L.plotTop}" fill="transparent" style="cursor:crosshair"/>`);
  return { svg: `<svg width="${W}" height="${L.H}" viewBox="0 0 ${W} ${L.H}" style="display:block;max-width:100%">${parts.join('')}</svg>`, L };
}
