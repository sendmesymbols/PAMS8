/**
 * MovementGuideWaterDetail.ts
 *
 * The Water card's lenses in the Mov Detail, in the Ground Detail's manner (user, 2026-11-11: "like bottom card styles
 * switched with keys like the Ground Guide"): a lens row under the card's tabs, each lens with its own answer under
 * its name; the answer strip gives the lens's answer and key facts; the band runs its pictures first, then its lists,
 * down the newspaper columns. 9 (the Water tab's key) walks the band's pages, then the lenses (Shift+9 back); a click on
 * a lens works too. (W belongs to the Night March chart.)
 *
 *   Type       the ten Annex P types as silhouettes with this one lit, why, the month wheel, the pamphlet's notes
 *              (and, from an axis, every obstacle in order); the input and settings
 *   Section    the fisheye cross-section with the scale figures, every figure with its source
 *   Banks      home and far bank towers against the tank's climb and a man, bunds, marsh, the water's level
 *   Going      tanks / wheels / foot with their reasons, the depth / step / width gauges, the figures behind them
 *   Crossings  the plan radar, the obstacle straightened, the list, the months fords and ferries are in use
 *   Recce      what to confirm on the ground, and how much of the card is measured (the sources donut)
 *   Reach      (after Along the Reach) the stations' widths and banks, narrowest and lowest far bank
 * Strings only, from numbers, fixed words and escaped names (the Mov Detail sets them as innerHTML).
 */

import Utils from '../../Support/utils';
import type { CardResult } from './MovementGuide';
import { SRC_WORD, type Fig, type WaterReading, type WaterRules } from './MovementGuideWater';
import { alongStrip, annexTiles, bankTowers, figWord, fisheyeSection, gaugesPic, GO_C, GO_W, monthWheel, moverChips, planRadar, sourceCounts, sourceDonut, SRC_COLOR, SRC_LETTER } from './MovementGuideWaterPics';
import { axisStrip, reachStrip } from './MovementGuideWaterViz';

const esc = (s: unknown): string => Utils.escapeHtml(String(s ?? ''));
export type WaterLens = 'type' | 'section' | 'banks' | 'going' | 'crossings' | 'recce' | 'reach';
const LENS_LABEL: Record<WaterLens, string> = { type: 'Type', section: 'Section', banks: 'Banks', going: 'Going', crossings: 'Crossings', recce: 'Recce', reach: 'Reach' };
type WaterResult = Extract<CardResult, { card: 'water' }>;
export interface LensFact {
  k: string;
  v: string;
  s?: string;
  c?: string;
}

export function lensesFor(r: WaterResult | null): WaterLens[] {
  const L: WaterLens[] = ['type', 'section', 'banks', 'going', 'crossings', 'recce'];
  if (r?.reach) L.push('reach');
  return L;
}

const bankFig = (b: WaterReading['home']): Fig => (b.aboveWater.src !== 'none' ? b.aboveWater : b.aboveLand);
const src = (f: Fig) => `<span class="mgw-src" style="background:${SRC_COLOR[f.src]}" title="${esc(SRC_WORD[f.src])}">${SRC_LETTER[f.src]}</span>`;
const sec = (title: string, body: string, flow = false) => (body ? `<section class="mgd-sec${flow ? ' flow' : ''}"><div class="mgd-cap">${esc(title)}</div>${body}</section>` : '');
const xy = (x: number, y: number) => `data-x="${x}" data-y="${y}"`;
const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

/** Each lens's short answer for the lens row, and a colour when it carries a verdict. */
export function lensAnswer(lens: WaterLens, r: WaterResult): { a: string; c?: string } {
  const w = r.reading;
  if (!w) return { a: '–' };
  switch (lens) {
    case 'type':
      return { a: w.annex ? `${w.annex}. ${w.typeLabel.replace(/ \(.*\)$/, '')}` : w.typeLabel };
    case 'section':
      return { a: `${figWord(w.width)}${w.shape ? ` · ${w.shape === 'raised' ? 'in-filled' : w.shape === 'sunk' ? 'in-cut' : 'level'}` : ''}` };
    case 'banks':
      return { a: `${figWord(bankFig(w.home))} / ${figWord(bankFig(w.far))}` };
    case 'going':
      return { a: `Tanks ${GO_W[w.verdict.tanks.v]}`, c: GO_C[w.verdict.tanks.v] };
    case 'crossings': {
      const c60 = w.crossings.filter((q) => q.tankable).length;
      return { a: w.crossings.length ? `${w.crossings.length} · ${c60} Cl 60` : 'none', c: c60 ? GO_C.go : GO_C.nogo };
    }
    case 'recce':
      return { a: `${w.recce.length} to confirm` };
    case 'reach': {
      const q = r.reach;
      return { a: q ? `${q.stations.length} stations · ${km(q.lengthM)}` : '–' };
    }
  }
}

/** The lens row: lens buttons with their answers, then the keys. */
export function lensRow(r: WaterResult | null, lens: WaterLens): string {
  if (!r?.reading) return '';
  const b = lensesFor(r)
    .map((l) => {
      const a = lensAnswer(l, r);
      return `<button class="mgd-lens${l === lens ? ' on' : ''}" data-lens="${l}" title="${esc(LENS_LABEL[l])} (9 walks the lenses)"><span class="mgd-ln">${esc(LENS_LABEL[l])}</span><span class="mgd-la">${a.c ? `<i style="background:${a.c}"></i>` : ''}${esc(a.a)}</span></button>`;
    })
    .join('');
  return `<div class="mgd-lenses">${b}<span class="mgd-sp"></span><span class="mgd-lk"><span class="mgd-k">9</span>next <span class="mgd-k">⇧</span><span class="mgd-k">9</span>back <span class="mgd-k">Q</span>cursor card</span></div>`;
}

/** The answer strip for a lens. */
export function lensSummary(lens: WaterLens, r: WaterResult, params: Record<string, any>): { v: string; s: string; facts: LensFact[] } {
  const w = r.reading!;
  const pre = r.mode === 'axis' && r.axis ? `${r.chosen + 1} of ${r.axis.obstacles.length}: ` : '';
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][w.season.month - 1];
  const t = w.verdict.tanks;
  switch (lens) {
    case 'type':
      return {
        v: `${pre}${w.annex ? `${w.annex}. ` : ''}${w.typeLabel}`,
        s: `${w.name ? `${w.name} · ` : ''}${w.typeWhy.join('; ')}`,
        facts: [
          { k: 'Source', v: w.typeSrc, s: w.annex ? `IBB Annex P ${w.annex}` : 'not an Annex P type' },
          { k: 'Month', v: `${month} · ${w.season.wet ? 'monsoon' : 'dry'}`, s: w.season.text },
          { k: 'Tanks', v: GO_W[t.v], s: t.why, c: GO_C[t.v] },
        ],
      };
    case 'section':
      return {
        v: `${figWord(w.width)} wide · ${figWord(w.depth)} deep`,
        s: w.shape === 'raised' ? 'The water stands above the land (in-filled): a breach floods the ground.' : w.shape === 'sunk' ? 'The water lies below the land (in-cut): the exit is the climb.' : 'Read across the obstacle from 30 m ground and the sheet.',
        facts: [
          { k: 'Width', v: figWord(w.width), s: SRC_WORD[w.width.src] },
          { k: 'Depth', v: figWord(w.depth), s: SRC_WORD[w.depth.src] },
          { k: 'Current', v: figWord(w.current, 'm/s'), s: w.bed ? `bed: ${w.bed}` : SRC_WORD[w.current.src] },
        ],
      };
    case 'banks':
      return {
        v: `Home ${figWord(bankFig(w.home))} · Far ${figWord(bankFig(w.far))}`,
        s: `Home ${w.home.dir} (${w.homeWhy}); far ${w.far.dir}.${w.sheetBanks ? ' The sheet does not say which bank is which.' : ''}`,
        facts: [
          { k: `Home ${w.home.dir}`, v: figWord(bankFig(w.home)), s: SRC_WORD[bankFig(w.home).src], c: GO_C.go },
          { k: `Far ${w.far.dir}`, v: figWord(bankFig(w.far)), s: SRC_WORD[bankFig(w.far).src], c: GO_C.nogo },
          { k: 'Marsh beside', v: `${w.home.marshM} / ${w.far.marshM} m`, s: 'home / far' },
        ],
      };
    case 'going':
      return {
        v: `Tanks ${GO_W[t.v]}`,
        s: `${w.purpose === 'cross' ? 'We cross it' : 'The enemy crosses it'}: ${t.why}`,
        facts: [
          { k: 'Wheels', v: GO_W[w.verdict.wheels.v], s: w.verdict.wheels.why, c: GO_C[w.verdict.wheels.v] },
          { k: 'Foot', v: GO_W[w.verdict.foot.v], s: w.verdict.foot.why, c: GO_C[w.verdict.foot.v] },
          { k: 'Unknowns', v: w.purpose === 'cross' ? 'bigger end' : 'smaller end', s: w.purpose === 'cross' ? 'the obstacle never understated' : 'its value never overstated' },
        ],
      };
    case 'crossings': {
      const c60 = w.crossings.filter((q) => q.tankable);
      const near = w.crossings[0];
      return {
        v: w.crossings.length ? `${w.crossings.length} crossing${w.crossings.length === 1 ? '' : 's'} · ${c60.length} class 60` : 'No crossing recorded',
        s: near ? `Nearest: ${near.label}${near.name ? ` ${near.name}` : ''} ${km(near.distM)} ${near.dir}${near.load ? ` (${near.load})` : ''}` : `Nothing on this obstacle within ${params.crossingsKm} km: an assault crossing or a bridge to build.`,
        facts: [
          { k: 'Class 60', v: c60[0] ? `${km(c60[0].distM)} ${c60[0].dir}` : 'none', c: c60.length ? GO_C.go : GO_C.nogo },
          { k: 'Fords / ferries', v: String(w.crossings.filter((q) => q.kind === 'ford' || q.kind === 'ferry').length), s: `${w.crossings.filter((q) => q.inUseNow === false).length} not in use this month` },
          { k: 'Searched', v: `${params.crossingsKm} km`, s: 'each way along it' },
        ],
      };
    }
    case 'recce': {
      const sc = sourceCounts(w);
      const tot = sc.reduce((a, p) => a + p.n, 0);
      return {
        v: `${w.recce.length} things to confirm`,
        s: 'A plan plus a recce task list, not a replacement for recce.',
        facts: sc.filter((p) => p.n).slice(0, 4).map((p) => ({ k: p.label, v: `${p.n} of ${tot}`, c: p.c })),
      };
    }
    case 'reach': {
      const q = r.reach!;
      const N = q.narrowest !== null ? q.stations[q.narrowest] : null;
      const Lw = q.lowestFar !== null ? q.stations[q.lowestFar] : null;
      return {
        v: `${q.stations.length} stations along ${km(q.lengthM)}`,
        s: 'A shortlist for the crossing or breach site, read from 30 m ground: walk it before choosing.',
        facts: [
          { k: 'Narrowest', v: N ? `${N.widthM ?? '?'} m` : 'all alike', s: N ? `at ${km(N.alongM)}` : '' },
          { k: 'Lowest far bank', v: Lw ? `${Lw.farM ?? '?'} m` : 'all alike', s: Lw ? `at ${km(Lw.alongM)}` : '' },
          { k: 'Crossings on it', v: String(q.stations.filter((s) => s.crossing).length) },
        ],
      };
    }
  }
}

/** The band for a lens (pictures first). `head`: the input and settings sections, shown on the Type lens. */
export function lensBand(lens: WaterLens, r: WaterResult, R: WaterRules, params: Record<string, any>, head: string): string {
  const w = r.reading!;
  const kmS = Number(params.crossingsKm) || 5;
  switch (lens) {
    case 'type': {
      const axis =
        r.axis && r.axis.obstacles.length
          ? sec(
              `Along the axis (${r.axis.obstacles.length}): click one`,
              axisStrip(r.axis, r.chosen) +
                `<table class="mgd-t">${r.axis.obstacles.map((o, i) => `<tr data-choose="${i}" class="${i === r.chosen ? 'sel' : ''}"><td>${i + 1}</td><td>${(o.chainM / 1000).toFixed(2)} km</td><td>${esc(`${o.reading.annex ? `${o.reading.annex}. ` : ''}${o.reading.typeLabel}`)}</td><td><span class="mgd-dot" style="background:${GO_C[o.reading.verdict.tanks.v]}"></span>${GO_W[o.reading.verdict.tanks.v]}</td></tr>`).join('')}</table>`,
            )
          : '';
      return (
        sec('IBB Annex P · the ten types', annexTiles(R, w.type)) +
        axis +
        sec(
          `${w.annex ? `Annex P ${w.annex}: ` : ''}${w.typeLabel}`,
          `<div class="mgw-row">${monthWheel(w, R, 112)}<div class="mgd-in" style="flex:1;min-width:130px"><b>Why:</b> ${esc(w.typeWhy.join('; '))}<br><b>${w.season.wet ? 'Monsoon' : 'Dry season'}:</b> ${esc(w.season.text)}</div></div>${w.notes.length ? `<div class="mgd-in" style="margin-top:4px">${w.notes.map((n) => `· ${esc(n)}`).join('<br>')}</div>` : ''}`,
        ) +
        head
      );
    }
    case 'section': {
      const row = (k: string, f: Fig, unit = 'm') => `<tr><td>${esc(k)}</td><td><b>${esc(figWord(f, unit))}</b>${src(f)}</td><td class="mgd-why">${esc(f.src === 'none' ? 'unknown: recce' : `${SRC_WORD[f.src]}${f.note ? `, ${f.note}` : ''}`)}</td></tr>`;
      return (
        sec('Cross-section · home left, far right', fisheyeSection(w, { width: 300, height: 150 })) +
        sec(
          'Figures and where they come from',
          `<table class="mgd-t">${row('Width', w.width)}${row('Depth', w.depth)}${w.current.src !== 'none' ? row('Current', w.current, 'm/s') : ''}${row(`Home ${w.home.dir} above water`, w.home.aboveWater)}${row(`Home ${w.home.dir} above land`, w.home.aboveLand)}${row(`Far ${w.far.dir} above water`, w.far.aboveWater)}${row(`Far ${w.far.dir} above land`, w.far.aboveLand)}</table>${w.bed ? `<div class="mgd-in" style="margin-top:4px">Bed: ${esc(w.bed)} (sheet reach)</div>` : ''}`,
          true,
        ) +
        sec('Sources', `<div class="mgw-row">${sourceDonut(w, 90)}<div class="mgw-key">${sourceCounts(w).map((p) => `<span><i style="background:${p.c}"></i>${esc(p.label)} ${p.n}</span>`).join('')}</div></div>`)
      );
    }
    case 'banks':
      return (
        sec('Home and far bank', bankTowers(w, R, { width: 300, height: 150 })) +
        sec(
          'On each bank',
          `<table class="mgd-t"><tr><th></th><th>Home ${esc(w.home.dir)}</th><th>Far ${esc(w.far.dir)}</th></tr><tr><td>Above water</td><td>${esc(figWord(w.home.aboveWater))}${src(w.home.aboveWater)}</td><td>${esc(figWord(w.far.aboveWater))}${src(w.far.aboveWater)}</td></tr><tr><td>Above land</td><td>${esc(figWord(w.home.aboveLand))}${src(w.home.aboveLand)}</td><td>${esc(figWord(w.far.aboveLand))}${src(w.far.aboveLand)}</td></tr><tr><td>Crest from the water</td><td>${w.home.crestM !== null ? `${Math.round(w.home.crestM)} m` : '?'}</td><td>${w.far.crestM !== null ? `${Math.round(w.far.crestM)} m` : '?'}</td></tr><tr><td>Bund</td><td>${esc(w.home.bund ?? '-')}</td><td>${esc(w.far.bund ?? '-')}</td></tr><tr><td>Marsh beside</td><td>${w.home.marshM} m</td><td>${w.far.marshM} m</td></tr></table>${w.sheetBanks ? `<div class="mgd-in" style="margin-top:4px">The sheet: ${esc([w.sheetBanks.a, w.sheetBanks.b].filter((v) => v !== null).map((v) => `${v} m`).join(' / '))}, side not recorded${w.flow === 'unknown' ? ' (the 30 m heights along it do not show which way it flows)' : ''}.</div>` : ''}<div class="mgd-in" style="margin-top:4px">Home: ${esc(w.homeWhy)}.</div><div class="mgd-row" style="margin-top:6px"><button class="mgd-btn" data-act="swapHome">⇄ Swap Home</button></div>`,
        )
      );
    case 'going':
      return (
        sec(`Going across · ${w.purpose === 'cross' ? 'we cross' : 'the enemy crosses'}`, moverChips(w)) +
        sec('Against what each mover can do', gaugesPic(w, R, { width: 300, height: 150 })) +
        sec(
          'The figures behind it',
          `<div class="mgd-in">Tanks climb ${R.tank.stepM} m and cross a ${R.tank.gapM} m gap; a ${R.tank.fullDitchM} m ditch is a full obstacle (${esc(R.tank.src ?? 'roadmap')}).<br>Wading without preparation: tank ${R.ford.tankDepthM} m, wheels ${R.ford.wheeledDepthM} m, foot ${R.ford.footDepthM} m and under ${R.ford.footCurrentMs} m/s (a proposal: correct it in MovementDoctrine.json).<br>Bridge spans: ${esc(((R.bridging?.spans ?? []) as Array<{ label: string; m: number }>).map((s) => `${s.label} ${s.m} m`).join(', '))} (IBB Annex Q).</div>`,
        )
      );
    case 'crossings': {
      const list = w.crossings.length
        ? `<table class="mgd-t"><tr><th>Crossing</th><th>Load / use</th><th>Where</th></tr>${w.crossings.map((q) => `<tr ${xy(q.x, q.y)}><td>${esc(q.label)}${q.name ? `<br><span class="mgd-why">${esc(q.name)}</span>` : ''}</td><td>${q.load ? `<span class="mgd-dot" style="background:${q.tankable ? GO_C.go : q.tankable === false ? GO_C.slow : '#8a96a3'}"></span>${esc(q.load)}` : ''}${q.months ? `${q.load ? '<br>' : ''}${esc(q.months)}${q.inUseNow === false ? ' <b style="color:#ff6b6f">not now</b>' : q.inUseNow ? ' <span class="mgd-ok">now</span>' : ''}` : ''}${q.boats ? `<br>${esc(q.boats)}` : ''}</td><td>${km(q.distM)} ${esc(q.dir)}</td></tr>`).join('')}</table>`
        : `<div class="mgd-in">None recorded on this obstacle within ${kmS} km: an assault crossing (IBB Annex Q: M2 boats, 12 men, 10 min a round trip per 30 m) or a bridge to build.</div>`;
      return (
        sec('From above · turns with the map', `<div class="mgw-row">${planRadar(w, { size: 160, km: kmS })}<div class="mgw-key"><span><i style="background:${GO_C.go}"></i>class 60</span><span><i style="background:${GO_C.slow}"></i>lighter</span><span><i style="background:#c3cbd3"></i>class not recorded</span><span><i style="background:#6b7480"></i>not in use now</span><span><i style="background:${GO_C.go};opacity:.5"></i>home half</span><span><i style="background:${GO_C.nogo};opacity:.5"></i>far half</span></div></div>`) +
        sec('Along the obstacle', alongStrip(w, kmS, { width: 300 })) +
        sec(`Crossings (${w.crossings.length})`, list, true) +
        (w.crossings.some((q) => q.months) ? sec('Months in use (fords tan, ferries teal)', monthWheel(w, R, 120)) : '')
      );
    }
    case 'recce':
      return (
        sec('How much is measured', `<div class="mgw-row">${sourceDonut(w, 100)}<div class="mgw-key">${sourceCounts(w).map((p) => `<span><i style="background:${p.c}"></i>${esc(p.label)} ${p.n}</span>`).join('')}</div></div><div class="mgd-in" style="margin-top:4px">S sheet · R sheet reach · M map class · Y symbol · E 30 m estimate · I IBB typical · ? unknown</div>`) +
        sec('Confirm on the ground', `<table class="mgd-t">${w.recce.map((t, i) => `<tr><td style="width:18px"><span style="display:inline-block;width:12px;height:12px;border:1.5px solid #8ec1ea;border-radius:3px"></span></td><td>${i + 1}. ${esc(t)}</td></tr>`).join('')}</table>`, true)
      );
    case 'reach': {
      const q = r.reach!;
      return (
        sec(`Along the reach · ${km(q.lengthM)}`, reachStrip(q) + '<div class="mgd-in">Bars: width. Lines: home (green) and far (red) bank. N narrowest, L lowest far bank, B a crossing.</div>') +
        sec(
          `Stations (${q.stations.length})`,
          `<table class="mgd-t"><tr><th>#</th><th>Along</th><th>Width</th><th>Home / far</th></tr>${q.stations.map((s, i) => `<tr ${xy(s.at[0], s.at[1])} class="${i === q.narrowest || i === q.lowestFar ? 'sel' : ''}"><td>${s.n}${i === q.narrowest ? ' N' : ''}${i === q.lowestFar ? ' L' : ''}</td><td>${km(s.alongM)}</td><td>${s.widthM ?? '?'} m</td><td>${s.homeM ?? '?'} / ${s.farM ?? '?'} m${s.marsh ? ' <span class="mgd-why">marsh</span>' : ''}${s.crossing ? `<br><span class="mgd-why">${esc(s.crossing)}</span>` : ''}</td></tr>`).join('')}</table>`,
          true,
        )
      );
    }
  }
}

/** The lens row's CSS (added to the Mov Detail's sheet). */
export const LENS_CSS = `
.mgd-lenses{flex:none;display:flex;align-items:stretch;gap:5px;padding:6px 12px;background:#1d2229;border-bottom:1px solid rgba(255,255,255,.12);overflow:hidden}
.mgd-lens{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:0;max-width:170px;padding:4px 10px 5px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.03);color:#c3cbd3;cursor:pointer;text-align:left}
.mgd-lens:hover{background:rgba(255,255,255,.08)}
.mgd-lens.on{background:linear-gradient(180deg,rgba(58,149,216,.28),rgba(58,149,216,.1));border-color:#3a95d8;color:#fff;box-shadow:inset 0 -2px 0 #7cc8ff}
.mgd-ln{font:750 12px/1.2 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.03em;text-transform:uppercase}
.mgd-la{display:flex;align-items:center;gap:5px;max-width:100%;font:600 12.5px/1.25 system-ui,Segoe UI,Arial,sans-serif;color:#f1f3f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mgd-la>i{flex:none;width:8px;height:8px;border-radius:50%}
.mgd-lk{display:flex;align-items:center;gap:4px;font-size:12px;color:#aab3bd;white-space:nowrap}
`;
