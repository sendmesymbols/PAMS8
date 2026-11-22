/**
 * AprcWrite.ts
 *
 * The words of the appreciation, from plain inputs (pure: no DOM, no map, no bundle; the engine collects the inputs).
 *
 *   writeGround   Gr and Weather (Gen Description, Apchs, ITGs, Obs, Cover, Met Conditions, Deductions) from the Gr Scope
 *                 AOR reading, with the readings at the MITG (sections, cover, the Extended View's sight, crops, visibility);
 *   writeSymbols  what is marked on the map: en and own symbols by echelon and place, the relative strength table,
 *                 obstacle symbols;
 *   writePlan     a checked plan (Intelligent Deployment → Check my plan): own disposns, the course, his reactions against
 *                 own moves, advs and disadvs, the general outline.
 *
 * Facts are drafted (`gr`, `map`); anything that is a judgement is a proposal (`judge`) and says what it rests on; what
 * the data cannot tell stays null (a ruled line) with the heads to consider. Never the name of the 1:50k source layer.
 */

import type { AorApproach, AorDefLine, AorReading, AorSide } from '../GroundGuide/GroundGuideAor';
import { aorName, aorSheetRows, aorWords, type AorFrame } from '../GroundGuide/GroundGuideScopeAor';
import { moonState, sunAltitude } from '../GroundGuide/GroundGuideOcoka';
import { APCH_HEADS_ATTK, DP_HEADS, ITG_HEADS_ATTK, MA, TASK_HEAD_ATTK, para, slug, taskRowsAttk, type AprcBasis, type AprcConfirm, type AprcFrame, type AprcPara, type AprcPatch, type AprcTable } from './AprcModel';

const km = (m: number): string => (m / 1000).toFixed(1);
const pct = (x: number): string => `${Math.round(x)} %`;
const list = (a: string[], and = 'and'): string => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} ${and} ${a[a.length - 1]}`);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const cap1 = (t: string): string => (t ? t[0].toUpperCase() + t.slice(1) : t);
const data = (text: string): AprcBasis => ({ kind: 'data', text });
const rule = (text: string): AprcBasis => ({ kind: 'rule', text });
const input = (text: string): AprcBasis => ({ kind: 'input', text });
const calc = (text: string): AprcBasis => ({ kind: 'calc', text });

const SIDES: AorSide[] = ['Lt', 'Cen', 'Rt'];
const COVER_WORD = ['none', 'poor', 'fair', 'good'];
const COUNTRY_WORD: Record<string, string> = { open: 'open country', close: 'close country', veryClose: 'very close country' };

// ── light ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AprcLight {
  /** Local clock times "0612"; null where the sun does not cross the angle that day. */
  firstLight: string | null;
  lastLight: string | null;
  /** Lit share of the moon at local midnight, 0-100. */
  moonPct: number;
  /** Hours east of UTC the times are in. */
  utcOffsetH: number;
  date: string;
}

/**
 * First and last light at a place on a date: the sun 6 degrees below the horizon (civil twilight), found by stepping
 * the sun's altitude through the local day. A method, not a book figure.
 */
export function lightTimes(date: Date, lat: number, lon: number, utcOffsetMin: number): AprcLight {
  const local = new Date(date.getTime() + utcOffsetMin * 60000);
  const midnightUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - utcOffsetMin * 60000;
  let first: number | null = null, last: number | null = null;
  let prev = sunAltitude(new Date(midnightUtc), lat, lon);
  for (let m = 1; m <= 1440; m++) {
    const a = sunAltitude(new Date(midnightUtc + m * 60000), lat, lon);
    if (prev < -6 && a >= -6 && first === null) first = m;
    if (prev >= -6 && a < -6) last = m;
    prev = a;
  }
  const hhmm = (m: number | null): string | null => (m === null ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`);
  const moon = moonState(new Date(midnightUtc + 86400000), lat, lon);
  return { firstLight: hhmm(first), lastLight: hhmm(last), moonPct: Math.round(moon.illum * 100), utcOffsetH: utcOffsetMin / 60, date: local.toISOString().slice(0, 10) };
}

// ── Gr and Weather ───────────────────────────────────────────────────────────────────────────────────────────────

/** The Extended View's sight reading at one point on an approach. */
export interface AprcObsn {
  /** The named place it was read near, or null. */
  near: string | null;
  radiusM: number;
  seenPct: number;
  clearMedianM: number;
  country: string;
  overlook: { riseM: number; distM: number; compass: string } | null;
}

export interface AprcGroundIn {
  reading: AorReading;
  frame: Pick<AorFrame, 'season' | 'month' | 'used' | 'source' | 'profileLabel' | 'echelon' | 'note'>;
  /** At the MITG (GroundGuideSections), any part may be missing. */
  ground?: { elevationM: number | null; slopeBand: string | null; landform: string | null; rough: string | null } | null;
  roads?: { density: number; allWeatherPct: number; radiusM: number; exitDirs: string[] } | null;
  weather?: { monthName: string; tmax: number | null; tmin: number | null; precMm: number; windMs: number | null; source: string; dataDate: string } | null;
  visibility?: { fogPct: number | null; hazePct: number | null; lt2kmPct: number | null; meanViewKm: number | null; stationKm: number | null } | null;
  /** Cover levels at the MITG, 0 (none) to 3 (good). */
  cover?: { direct: number; indirect: number; ground: number; aerial: number } | null;
  crop?: { tallPct: number; hidesPct: number } | null;
  obsn?: Partial<Record<AorSide, AprcObsn | null>>;
  /** The IPB weather values for the month: missions that are marginal or unfavourable. */
  wx?: { marginal: string[]; unfavourable: string[] } | null;
  light?: AprcLight | null;
  /** Obstacle symbols drawn on the map, in words ("Minefield 1.2 km N of X"). */
  drawnObs?: string[];
  /** True when the threat is a place the user marked (the attack: the own start is known). */
  threatMarked: boolean;
  readAt: string;
  /**
   * An attack (`attk`): the reading was taken round the objective (the MITG) from the attacker's side, so its apchs
   * come from own side onto the objective and its sides are the en's (mirrored here to the attacker's Lt / Rt), its
   * lines of def his likely lines facing the attack.
   */
  attack?: boolean;
  /** The attack: the view from the objective toward own side (the Extended View at the MITG). */
  mitgObsn?: AprcObsn | null;
  /** The attack: where own tps start, in words ("FUP 1.2 km SW of Burj"), or null when taken opposite the threat. */
  startWords?: string | null;
}

export interface AprcWritten {
  patches: AprcPatch[];
  confirm: AprcConfirm[];
  frame?: AprcFrame;
}

const AOR_WORD: Record<string, string> = { boundaries: 'Bdy symbols', box: 'a drawn box', echelon: 'the echelon frame round the MITG' };

function rankReason(a: AorApproach, border: string | null): string {
  const bits = [`${km(a.pastM)} km past ${border ? `the ${border}` : 'the front'}`, plural(a.through.length, 'BUA'), a.obstacles.length ? plural(a.obstacles.length, 'water obs', 'water obs') : 'no water obs'];
  if (!a.fits) bits.push(`narrows to ${km(a.minWidthM)} km`);
  return `${a.side} (${bits.join(', ')})`;
}

export function writeGround(g: AprcGroundIn): AprcWritten {
  if (g.attack) return writeGroundAttk(g);
  const r = g.reading, f = g.frame;
  const w = aorWords(r, f);
  // An unnamed MITG (no place near it) is 'the MITG' in a sentence.
  const named = !!r.mitg.name && r.mitg.name !== 'MITG';
  const mitg = named ? r.mitg.name : 'the MITG';
  const season = f.season === 'wet' ? 'after rain' : 'dry';
  const mover = f.profileLabel.toLowerCase();
  const bySide = SIDES.map((s) => r.apchs.find((a) => a.side === s)).filter((a): a is AorApproach => !!a);
  const border = w.ranked[0]?.cross?.border ?? null;
  const patches: AprcPatch[] = [];
  const confirm: AprcConfirm[] = w.confirm.map((text) => ({ text: text.replace(/NCGDB/g, '1:50k map'), paras: ['gr.apchs'] }));
  const goingData = data(`Going: the terrain classes at 30 m (land cover with the 1:50k map's canals, rivers, BUAs) read for ${mover}, ${season}`);
  const featData = data('Rds, canals, rivers, bridges and places: the 1:50k map');
  const frameIn = input(`AOR: ${AOR_WORD[f.used] ?? f.used}${f.note ? ` (${f.note})` : ''}; MITG ${mitg}; threat ${g.threatMarked ? 'marked on the map' : 'assumed forward of the AOR'}`);

  // 5. Gen Description
  {
    const s: string[] = [`${r.country}.`];
    const gd = g.ground;
    if (gd && (gd.elevationM !== null || gd.landform || gd.slopeBand)) {
      const bits = [gd.elevationM !== null ? `${Math.round(gd.elevationM)} m` : '', gd.landform ? gd.landform.toLowerCase() : '', gd.slopeBand ? `slope ${gd.slopeBand.toLowerCase()}` : '', gd.rough ? gd.rough.toLowerCase() : ''].filter(Boolean);
      s.push(`At ${mitg}: ${bits.join(', ')}.`);
    }
    const go = r.going;
    s.push(`For ${mover} in ${f.month} (${season}): GO on ${pct(go.goPct)} of the AOR, SLOW-GO ${pct(go.slowPct)}, NO-GO ${pct(go.nogoPct)}${go.nogoInAor ? ` in ${plural(go.nogoInAor, 'patch', 'patches')}` : ''}. BUAs cover ${pct(go.buaPct)}.`);
    const water = new Map<string, string>();
    for (const a of r.apchs) for (const o of a.obstacles) if (!water.has(o.name)) water.set(o.name, o.type);
    s.push(water.size ? `${cap1(plural(water.size, 'water line'))} ${water.size === 1 ? 'lies' : 'lie'} across the apchs: ${list([...water].map(([n, t]) => `${n} (${t})`))}.` : 'No water line lies across the apchs.');
    const home = r.map.places.filter((p) => !p.across);
    if (home.length) {
      const big = [...home].sort((a, b) => b.people - a.people)[0];
      s.push(`${cap1(plural(home.length, 'named BUA'))} in and round the AOR, the largest ${big.name}${big.people ? ` (about ${Math.round(big.people / 100) * 100} people)` : ''}.`);
    }
    if (g.roads) s.push(`Rd density ${g.roads.density.toFixed(1)} km per km² within ${km(g.roads.radiusM)} km of ${mitg}, ${pct(g.roads.allWeatherPct)} all-weather${g.roads.exitDirs.length ? `; ways out ${g.roads.exitDirs.join(', ')}` : ''}.`);
    if (r.msr) s.push(`MSR: ${aorName(r.msr.name)}${r.msr.cls ? ` ${r.msr.cls}` : ''}, ${km(r.msr.distM)} km from ${mitg}.`);
    patches.push({ id: 'gr.gen', draft: s.join(' '), state: 'gr', basis: [goingData, featData, data('People: the population grid (an estimate, not a census)'), frameIn] });
  }

  // 6. Apchs
  {
    const kids: AprcPara[] = bySide.map((a) => {
      const rows = aorSheetRows(r, a);
      const ob = g.obsn?.[a.side] ?? null;
      const obText = ob
        ? `Gr obsn: about ${pct(ob.seenPct)} of the ground within ${km(ob.radiusM)} km is in view from a point on it${ob.near ? ` near ${ob.near}` : ''}; clear to ${Math.round(ob.clearMedianM / 10) * 10} m before the first dead or screened ground (median of all dirs); ${COUNTRY_WORD[ob.country] ?? ob.country}.${ob.overlook ? ` Overlooked from ground ${Math.round(ob.overlook.riseM)} m higher, ${km(ob.overlook.distM)} km ${ob.overlook.compass}.` : ''} A chance, not a fact.`
        : null;
      const id = `gr.apch.${a.side.toLowerCase()}`;
      return para(id, `${a.side} Apch`, {
        draft: '',
        state: 'gr',
        children: rows.map(([h, t]) => {
          const text = h === 'Obsn' ? obText : t === null ? null : cap1(t);
          const basis: AprcBasis[] =
            h === 'Capacity' ? [goingData, input(`Corridor taken for the threat: ${km(r.corridorM)} km`), calc('The narrowest ground between NO-GO areas along the apch; canals and streams are crossings, not narrowings')]
            : h === 'Obsn' ? [data('Sight: the 30 m elevation with building density, crops by month, trees and bunds (the Extended View)'), calc('Read at one point on the apch; the share seen is a chance')]
            : h === 'Tfc' || h === 'Cover' ? [goingData, calc('A band 1 km wide along the apch')]
            : [featData];
          return para(`${id}.${slug(h)}`, h, { draft: text, state: text === null ? 'yours' : 'gr', basis: text === null ? [] : basis, prompts: text === null ? ['Not in the data: from recce'] : [] });
        }),
      });
    });
    patches.push({
      id: 'gr.apchs',
      draft: bySide.length ? `${cap1(plural(bySide.length, 'apch', 'apchs'))} to ${mitg} from the threat side${g.threatMarked ? '' : ' (start points assumed)'}.` : null,
      state: bySide.length ? 'gr' : 'yours',
      basis: bySide.length ? [calc('Least-cost ways on the going grid from three start points on the threat side to the MITG'), frameIn] : [],
      prompts: bySide.length ? [] : ['No approach was found from the threat side: mark the threat, or write them'],
      figure: bySide.length ? 'trace' : null,
      children: kids,
    });
  }

  // 7. ITGs
  {
    const kids: AprcPara[] = [];
    const facts = [`${plural(r.apchs.length, 'apch', 'apchs')} end here`];
    if (r.thruRoad) facts.push(`Rd ${aorName(r.thruRoad.name)} runs through it`);
    if (r.msr) facts.push(`the MSR is ${km(r.msr.distM)} km away`);
    const sig = `${r.apchs.length ? `${cap1(plural(r.apchs.length, 'apch', 'apchs'))} ${r.apchs.length === 1 ? 'ends' : 'converge'} on it` : 'No apch was found to it'}${r.thruRoad ? `; Rd ${aorName(r.thruRoad.name)}${r.thruRoad.cls ? ` ${r.thruRoad.cls}` : ''} runs through it` : ''}${r.msr ? `; MSR ${aorName(r.msr.name)}${r.msr.cls ? ` ${r.msr.cls}` : ''} ${km(r.msr.distM)} km away` : ''}.`;
    kids.push(para('gr.itg.mitg', named ? `${mitg} (MITG)` : 'MITG', {
      draft: '',
      state: 'gr',
      children: [para('gr.itg.mitg.effs', 'Effs if Lost', { prompts: r.apchs.length ? facts : facts.slice(1) }), r.apchs.length || r.thruRoad || r.msr ? para('gr.itg.mitg.sig', 'Significance', { draft: sig, state: 'gr', basis: [featData, frameIn] }) : para('gr.itg.mitg.sig', 'Significance')],
    }));
    const seen = new Set<string>([mitg]);
    for (const l of r.lines) {
      if (l.role !== 'FDLs' && l.role !== 'Depth') continue;
      for (const b of l.buas) {
        if (!b || seen.has(b)) continue;
        seen.add(b);
        kids.push(para(`gr.itg.${slug(b)}`, b, { draft: `Astride an apch on Line ${l.id}.`, state: 'judge', basis: [featData, calc('A BUA within 800 m of an apch where a line of def cuts it')] }));
      }
    }
    if (r.map.itg.length) kids.push(para('gr.itg.more', null, { draft: `${cap1(plural(r.map.itg.length, 'more candidate'))} in the AOR from the data (high ground, crossings, junctions): shown on the trace.`, state: 'judge', basis: [data('ITG candidates: the bundle features flagged as important ground')] }));
    patches.push({ id: 'gr.itg', draft: '', state: 'gr', children: kids });
  }

  // 8. Obs
  {
    const s: string[] = [];
    const seen = new Map<string, { type: string; widthM: number | null; sides: AorSide[]; bridge: boolean }>();
    for (const a of bySide) for (const o of a.obstacles) {
      const e = seen.get(o.name) ?? { type: o.type, widthM: o.widthM, sides: [], bridge: false };
      if (!e.sides.includes(a.side)) e.sides.push(a.side);
      if (o.bridgeM !== null) e.bridge = true;
      seen.set(o.name, e);
    }
    if (seen.size) s.push(`Natural: ${[...seen].map(([n, e]) => `${n} (${e.type}${e.widthM ? `, ${e.widthM} m` : ''}) across the ${list(e.sides)} ${e.sides.length > 1 ? 'apchs' : 'apch'}${e.bridge ? ', bridged near the crossing' : ', no br within 1 km'}`).join('; ')}.`);
    else s.push('Natural: no water obstacle across the apchs.');
    const out = r.going.nogoOut[0];
    s.push(r.going.nogoInAor ? `NO-GO for ${mover}: ${plural(r.going.nogoInAor, 'patch', 'patches')} in the AOR (on the trace).` : `No NO-GO ground for ${mover} in the AOR${out?.name ? `; ${aorName(out.name)} bed (${out.km2.toFixed(1)} km²) beyond the bdy` : ''}.`);
    s.push(`BUAs are SLOW-GO (${pct(r.going.buaPct)} of the AOR).`);
    if (r.bridges.inAor) s.push(`${cap1(plural(r.bridges.inAor, 'bridge'))} in the AOR, ${r.bridges.classed} with a load class recorded.`);
    if (g.drawnObs?.length) s.push(`Marked on the map: ${g.drawnObs.join('; ')}.`);
    else s.push('Artificial: none marked on the map.');
    patches.push({ id: 'gr.obs', draft: s.join(' '), state: 'gr', basis: [goingData, featData, input('Obstacle symbols drawn on the map')] });
    if (r.bridges.inAor > r.bridges.classed) confirm.push({ text: `Bridge class: ${r.bridges.inAor - r.bridges.classed} of ${r.bridges.inAor} bridges in the AOR carry no load class.`, paras: ['gr.obs'] });
  }

  // 9. Cover
  {
    const s: string[] = [];
    if (bySide.length) s.push(`From view, in a 1 km band along each apch: ${bySide.map((a) => `${a.side} BUAs ${pct(a.band.bua * 100)}, trees and orchards ${pct(a.band.trees * 100)}`).join('; ')}.`);
    if (r.country === 'Canal plains' || r.country === 'Plains' || r.country === 'Riverine') s.push('From dir fire: BUAs only, and the banks of canals and distys.');
    if (g.cover) s.push(`At ${mitg}: cover from dir fire ${COVER_WORD[g.cover.direct] ?? '?'}, from indirect fire ${COVER_WORD[g.cover.indirect] ?? '?'}; concealment from gr obsn ${COVER_WORD[g.cover.ground] ?? '?'}, from aerial obsn ${COVER_WORD[g.cover.aerial] ?? '?'}.`);
    if (g.crop) s.push(`Crops in ${f.month}: ${pct(g.crop.hidesPct)} of the cropland hides a crouching man, ${pct(g.crop.tallPct)} a standing man.`);
    patches.push({ id: 'gr.cover', draft: s.join(' '), state: 'gr', basis: [goingData, data('Crops: the crop calendar by month (a table, not what stands in the field today)'), calc('Cover is graded by ground class, never raised above what the class gives')] });
    confirm.push({ text: `Standing crop height in ${f.month}: the calendar gives the season, not the field.`, paras: ['gr.cover'] });
  }

  // 10. Met Conditions
  {
    const s: string[] = [];
    const wx = g.weather;
    if (wx) s.push(`${wx.monthName}: ${wx.tmax !== null ? `max ${Math.round(wx.tmax)} °C` : ''}${wx.tmin !== null ? `, min ${Math.round(wx.tmin)} °C` : ''}, rain ${Math.round(wx.precMm)} mm${wx.windMs !== null ? `, wind ${wx.windMs.toFixed(1)} m/s` : ''}.`.replace(': ,', ':'));
    const v = g.visibility;
    if (v && (v.fogPct !== null || v.lt2kmPct !== null)) s.push(`Visibility: ${[v.fogPct !== null ? `fog on ${pct(v.fogPct)} of days` : '', v.hazePct !== null ? `haze or dust on ${pct(v.hazePct)}` : '', v.lt2kmPct !== null ? `under 2 km on ${pct(v.lt2kmPct)}` : '', v.meanViewKm !== null ? `mean view ${v.meanViewKm.toFixed(1)} km` : ''].filter(Boolean).join(', ')}${v.stationKm !== null && v.stationKm > 100 ? ` (nearest station ${Math.round(v.stationKm)} km away: a guide only)` : ''}.`);
    if (g.wx && (g.wx.marginal.length || g.wx.unfavourable.length)) s.push(`Against the IPB weather values: ${[g.wx.unfavourable.length ? `unfavourable for ${list(g.wx.unfavourable)}` : '', g.wx.marginal.length ? `marginal for ${list(g.wx.marginal)}` : ''].filter(Boolean).join('; ')}.`);
    const lt = g.light;
    if (lt) s.push(`On ${lt.date}: first lt ${lt.firstLight ?? 'none'}, last lt ${lt.lastLight ?? 'none'} hrs (UTC${lt.utcOffsetH >= 0 ? '+' : ''}${lt.utcOffsetH}); moon ${lt.moonPct} % lit.`);
    s.push(`Going read ${season}.`);
    const basis: AprcBasis[] = [];
    if (wx) basis.push(data(`Climate: ${wx.source}${wx.dataDate ? ` (${wx.dataDate})` : ''}, the mean for the month, not a forecast`));
    if (v) basis.push(data('Visibility: the monthly station grid'));
    if (lt) basis.push(calc('First and last light: the sun 6 degrees below the horizon, worked out from date and place'));
    if (g.wx && (g.wx.marginal.length || g.wx.unfavourable.length)) basis.push(rule('Weather critical values: IPB book Annex A pp 19-20'));
    patches.push({ id: 'gr.met', draft: s.length > 1 ? s.join(' ') : null, state: s.length > 1 ? 'gr' : 'yours', basis, prompts: s.length > 1 ? [] : ['Temperature, rain, visibility, first and last light, moon'] });
    confirm.push({ text: 'Met conditions are the mean of the month: take the forecast before H.', paras: ['gr.met'] });
  }

  // 11. Deductions
  {
    const ranked = w.ranked;
    const rankCalc = calc('Ranked lowest first on: km past the border + 0.3 per BUA on it + 2 per water obstacle + 10 x the share of a 1 km band that is not GO. A method, not a book rule');
    patches.push({
      id: 'gr.ded.pri',
      draft: ranked.length ? `${list(ranked.map((a) => rankReason(a, border)), 'then')}.` : null,
      state: ranked.length ? 'judge' : 'yours',
      basis: ranked.length ? [rankCalc, goingData] : [],
    });
    const lats = [...r.laterals].filter((l) => l.n > 0).sort((a, b) => b.n - a.n);
    patches.push({
      id: 'gr.ded.comb',
      draft: ranked.length < 2 ? null : lats.length ? `${lats.map((l) => `${l.a} and ${l.b} (${plural(l.n, 'metalled lateral')})`).join('; ')}.` : 'No metalled lateral joins the apchs: no combination is served by a Rd.',
      state: ranked.length < 2 ? 'yours' : 'judge',
      basis: ranked.length < 2 ? [] : [featData, calc('Metalled Rds joining two apchs inside the AOR')],
    });
    const order = 'WXYZ';
    const linesOrd = [...r.lines].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const lineText = (l: AorDefLine): string =>
      `${l.name}, ${km(l.frontM)} km between bdys${l.obstacle ? `, along ${l.obstacle}` : ''}${l.lateral ? ', a lateral Rd behind it' : ''}${l.depthM !== null ? `, ${km(l.depthM)} km behind ${border ? `the ${border}` : 'the front of the AOR'}` : ''}.`;
    const pri = (['FDLs', 'Depth', 'Screen'] as const).map((role) => r.lines.find((l) => l.role === role)).filter((l): l is AorDefLine => !!l);
    patches.push({
      id: 'gr.ded.lines',
      draft: linesOrd.length ? '' : null,
      state: linesOrd.length ? 'gr' : 'yours',
      prompts: linesOrd.length ? [] : ['No line cuts every apch: write the possible lines'],
      children: linesOrd.length
        ? [
            para('gr.ded.lines.poss', null, {
              draft: 'Possible lines of def, from the front:',
              state: 'gr',
              basis: [featData, calc('Cuts across the apchs scored on the BUAs astride each apch, a water line or ridge along the cut and a lateral Rd behind it')],
              children: linesOrd.map((l) => para(`gr.ded.line.${l.id.toLowerCase()}`, `Line ${l.id}`, { draft: lineText(l), state: 'gr' })),
            }),
            para('gr.ded.lines.pri', null, {
              draft: pri.length ? `Pri of lines of def: ${pri.map((l) => `Line ${l.id} (${l.role})`).join(', ')}.${w.sub ? ` ${w.sub}.` : ''}` : null,
              state: pri.length ? 'judge' : 'yours',
              basis: pri.length ? [input(`Frontage tested against ${r.frontLimit.label}: ${km(r.frontLimit.m)} km`), calc('Roles from the front: the line with most BUAs astride the apchs and an obstacle is taken for the FDLs')] : [],
            }),
          ]
        : [],
    });
    const role = (x: string): AorDefLine | undefined => r.lines.find((l) => l.role === x);
    const fdl = role('FDLs'), depth = role('Depth'), screen = role('Screen');
    const roadSides = ranked.filter((a) => a.roadsAlong.length && a.fits).map((a) => a.side);
    const dp: Record<string, string | null> = {
      fdls: fdl ? `Line ${fdl.id} (${fdl.name}).` : null,
      depth: depth ? `Line ${depth.id} (${depth.name}).` : null,
      strpt: `${cap1(mitg)}.`,
      screens: screen ? `Ahead of the FDLs, on Line ${screen.id} (${screen.name}).` : null,
      bias: ranked.length ? `${list(ranked.slice(0, 2).map((a) => a.side))}.` : null,
      atk: roadSides.length ? `${list(roadSides)}: a Rd runs along ${roadSides.length > 1 ? 'them' : 'it'} and the corridor fits.` : null,
    };
    for (const [k] of DP_HEADS) {
      const t = dp[k] ?? null;
      patches.push({ id: `gr.ded.dp1.${k}`, draft: t, state: t ? 'judge' : 'yours', basis: t ? [calc('From the lines of def and the pri of apchs above')] : [] });
    }
  }

  return {
    patches,
    confirm,
    frame: {
      place: named ? r.mitg.name : 'MITG (no named place)',
      echelon: f.echelon,
      mover: f.profileLabel,
      month: f.month,
      season: f.season === 'wet' ? 'wet' : 'dry',
      aor: `${AOR_WORD[f.used] ?? f.used}${f.used !== f.source ? ` (asked: ${AOR_WORD[f.source] ?? f.source})` : ''}`,
      threat: g.threatMarked ? 'marked on the map' : 'assumed forward of the AOR',
      readAt: g.readAt,
    },
  };
}

// ── the attack: Gr and Weather ───────────────────────────────────────────────────────────────────────────────────

/** The reading's sides are the en's (as he faces the attack): the attacker's Lt is his Rt. */
const MIRROR: Record<AorSide, AorSide> = { Lt: 'Rt', Cen: 'Cen', Rt: 'Lt' };
const mirrorText = (s: string | null | undefined): string | null => (s === null || s === undefined ? null : s.replace(/\b(Lt|Rt)\b/g, (m) => (m === 'Lt' ? 'Rt' : 'Lt')));
const OBS_WORD = (ob: AprcObsn, toward: string): string =>
  `about ${pct(ob.seenPct)} of the ground within ${km(ob.radiusM)} km is in view${toward}; clear to ${Math.round(ob.clearMedianM / 10) * 10} m before the first dead or screened ground (median of all dirs); ${COUNTRY_WORD[ob.country] ?? ob.country}.`;

/** Capacity of an apch for the attacker: the book's Bde figure, the IPB corridor widths below it. */
function capacityAttk(a: AorApproach): { text: string; basis: AprcBasis[] } {
  const w = a.minWidthM;
  const wide = w >= 20000 ? 'No NO-GO area narrows it' : `No narrower than ${km(w)} km between NO-GO areas`;
  const who = w >= 4000 ? 'a Bde size force' : w >= 1500 ? 'a Bn size force' : w >= 500 ? 'a Coy size force' : null;
  return {
    text: `${wide}: ${who ? `room for ${who}` : 'less than the 500 m a Coy moves on'}${a.obstacles.length ? `; water crossed at ${plural(a.obstacles.length, 'point')}` : ''}.`,
    basis: [rule('A Bde size force takes approx 4 km (Mechs of Aprc (Attk) p 2); a Bn moves on 1.5 km, a Coy on 500 m (IPB book p 7, mobility corridor widths)'), calc('The narrowest ground between NO-GO areas along the apch; canals and streams are crossings, not narrowings')],
  };
}

function writeGroundAttk(g: AprcGroundIn): AprcWritten {
  // Gen Description, Obs, Cover and Met read as for the defence; the rest is the attacker's
  const base = writeGround({ ...g, attack: false });
  const r = g.reading;
  const named = !!r.mitg.name && r.mitg.name !== 'MITG';
  const mitg = named ? r.mitg.name : 'the MITG';
  const keep = new Set(['gr.gen', 'gr.obs', 'gr.cover', 'gr.met']);
  const patches: AprcPatch[] = base.patches.filter((p) => keep.has(p.id)).map((p) => {
    const q: AprcPatch = { ...p, draft: p.id === 'gr.obs' || p.id === 'gr.cover' ? mirrorText(p.draft) : p.draft };
    delete q.prompts; // the book's heads and page stay with the paragraph
    return q;
  });
  const confirm: AprcConfirm[] = base.confirm.map((c) => ({ ...c, text: mirrorText(c.text) ?? c.text }));
  const goingData = data(`Going: the terrain classes at 30 m (land cover with the 1:50k map's canals, rivers, BUAs) read for ${g.frame.profileLabel.toLowerCase()}, ${g.frame.season === 'wet' ? 'after rain' : 'dry'}`);
  const featData = data('Rds, canals, rivers, bridges and places: the 1:50k map');
  const frameIn = input(`Obj (MITG) ${mitg}; own start ${g.threatMarked && g.startWords ? g.startWords : 'taken opposite the threat (assumed)'}`);
  const sideOf = (s: AorSide): AorSide => MIRROR[s];

  // 7. Apchs: from own side onto the objective, the attacker's Lt first
  const ours = (['Rt', 'Cen', 'Lt'] as AorSide[]).map((s) => r.apchs.find((a) => a.side === s)).filter((a): a is AorApproach => !!a);
  {
    const kids = ours.map((a) => {
      const side = sideOf(a.side);
      const id = `gr.apch.${side.toLowerCase()}`;
      const rows = new Map(aorSheetRows(r, a));
      const ob = g.obsn?.[a.side] ?? null;
      const cap = capacityAttk(a);
      const textOf = (h: string): string | null => {
        if (h === 'Capacity') return cap.text;
        if (h === 'Depl Areas') return null;
        if (h === 'Obsn and F of F') return ob ? `Gr obsn: ${OBS_WORD(ob, ` from a point on it${ob.near ? ` near ${ob.near}` : ''}`)}${ob.overlook ? ` Overlooked from ground ${Math.round(ob.overlook.riseM)} m higher, ${km(ob.overlook.distM)} km ${ob.overlook.compass}.` : ''} A chance, not a fact.` : null;
        const t = rows.get(h);
        return t === undefined || t === null ? null : t;
      };
      return para(id, `${side} Apch`, {
        draft: '',
        state: 'gr',
        children: APCH_HEADS_ATTK.map(([h, pr]) => {
          const raw = textOf(h);
          const text = raw === null ? null : mirrorText(cap1(raw));
          const basis: AprcBasis[] =
            h === 'Capacity' ? [goingData, ...cap.basis]
            : h === 'Obsn and F of F' ? [data('Sight: the 30 m elevation with building density, crops by month, trees and bunds (the Extended View)'), calc('Read at one point on the apch; the share seen is a chance')]
            : h === 'Tfc' || h === 'Cover' ? [goingData, calc('A band 1 km wide along the apch')]
            : [featData];
          const page = ['Dir Keeping', 'Significance'].includes(h) ? 3 : 2;
          return para(`${id}.${slug(h)}`, h, { draft: text, state: text === null ? 'yours' : 'gr', basis: text === null ? [] : basis, prompts: text === null ? [...pr, MA(page)] : [] });
        }),
      });
    });
    patches.push({
      id: 'gr.apchs',
      draft: ours.length ? `${cap1(plural(ours.length, 'apch', 'apchs'))} from own side onto ${mitg}${g.threatMarked ? '' : ' (start points assumed)'}, named as own tps face the obj.` : null,
      state: ours.length ? 'gr' : 'yours',
      basis: ours.length ? [calc('Least-cost ways on the going grid from three start points on own side to the MITG'), frameIn] : [],
      prompts: ours.length ? [] : ['No apch was found from own side: mark the own start (an attack plan, or the threat on the far side), or write them', MA(2)],
      figure: ours.length ? 'trace' : null,
      children: kids,
    });
  }

  // 6. Imp Tac Grs: the objective first, with the book's heads
  const others: Array<{ name: string; line: AorDefLine; side: AorSide | null }> = [];
  {
    const cov = g.cover, gd = g.ground, mo = g.mitgObsn ?? null;
    const facts: string[] = [];
    if (r.thruRoad) facts.push(`opens Rd ${aorName(r.thruRoad.name)}${r.thruRoad.cls ? ` ${r.thruRoad.cls}` : ''}, which runs through it`);
    if (r.msr) facts.push(`brings the MSR ${aorName(r.msr.name)} (${km(r.msr.distM)} km away) under obsn and fire`);
    if (ours.length) facts.push(`${plural(ours.length, 'apch', 'apchs')} ${ours.length === 1 ? 'ends' : 'end'} on it: further op from it is open`);
    const draft: Record<string, { t: string | null; st: 'gr' | 'judge'; b: AprcBasis[] }> = {
      loc: { t: `${named ? r.mitg.name : 'The MITG (no named place)'}${r.thruRoad ? `, on Rd ${aorName(r.thruRoad.name)}` : ''}${r.msr ? `; the MSR ${aorName(r.msr.name)} ${km(r.msr.distM)} km away` : ''}.`, st: 'gr', b: [featData, frameIn] },
      cover: { t: cov ? `Cover from dir fire ${COVER_WORD[cov.direct] ?? '?'}, from indir fire ${COVER_WORD[cov.indirect] ?? '?'}; concealment from gr obsn ${COVER_WORD[cov.ground] ?? '?'}, from air ${COVER_WORD[cov.aerial] ?? '?'}.` : null, st: 'gr', b: [goingData, calc('Cover is graded by ground class, never raised above what the class gives')] },
      obsn: { t: mo ? `From it ${OBS_WORD(mo, ' toward own side')} A chance, not a fact.` : null, st: 'gr', b: [data('Sight: the 30 m elevation with building density, crops by month, trees and bunds (the Extended View)')] },
      domination: { t: gd && (gd.elevationM !== null || gd.landform) ? `${[gd.elevationM !== null ? `${Math.round(gd.elevationM)} m` : '', gd.landform ? gd.landform.toLowerCase() : '', gd.slopeBand ? `slope ${gd.slopeBand.toLowerCase()}` : ''].filter(Boolean).join(', ')}${mo?.overlook ? `; overlooked from ground ${Math.round(mo.overlook.riseM)} m higher, ${km(mo.overlook.distM)} km ${mo.overlook.compass}` : '; nothing higher overlooks it within the reading'}.` : null, st: 'gr', b: [data('Heights: the 30 m elevation')] },
      effs: { t: facts.length ? `It ${list(facts)}.` : null, st: 'judge', b: [featData, calc('From the Rds and apchs at the MITG; what its capture unhinges is the planner\'s')] },
    };
    const kids: AprcPara[] = [
      para('gr.itg.mitg', `${named ? r.mitg.name : 'Obj'} (MITG)`, {
        draft: '',
        state: 'gr',
        children: ITG_HEADS_ATTK.map(([k, h, pr]) => {
          const d = draft[k];
          return d?.t ? para(`gr.itg.mitg.${k}`, h, { draft: cap1(d.t), state: d.st, basis: d.b }) : para(`gr.itg.mitg.${k}`, h, { prompts: [...pr, MA(k === 'effs' || k === 'domination' || k === 'dir' ? 2 : 1)] });
        }),
      }),
    ];
    // his localities: the BUAs astride the apchs on the lines facing the attack (his likely FDLs, then depth)
    const seen = new Set<string>([r.mitg.name]);
    for (const role of ['FDLs', 'Depth'] as const) {
      const l = r.lines.find((x) => x.role === role);
      if (!l) continue;
      l.buas.forEach((b, i) => {
        if (!b || seen.has(b)) return;
        seen.add(b);
        const side = l.buas.length === 3 ? sideOf(SIDES[i]) : null;
        others.push({ name: b, line: l, side });
        kids.push(para(`gr.itg.${slug(b)}`, b, { draft: `Astride the ${side ? `${side} ` : ''}apch on Line ${l.id}, his likely ${role === 'FDLs' ? 'FDLs' : 'depth'} facing the attk.`, state: 'judge', basis: [featData, calc('A BUA within 800 m of an apch where a line across the apchs cuts it; the lines are the ones a defender of the MITG would hold')] }));
      });
    }
    if (r.map.itg.length) kids.push(para('gr.itg.more', null, { draft: `${cap1(plural(r.map.itg.length, 'more candidate'))} in the area from the data (high ground, crossings, junctions): shown on the trace.`, state: 'judge', basis: [data('ITG candidates: the bundle features flagged as important ground')] }));
    patches.push({ id: 'gr.itg', draft: '', state: 'gr', children: kids });
    confirm.push({ text: `His localities and the ITGs are read from the ground: confirm them against his disposns (recce, int) before the APs are settled.`, paras: ['gr.itg', 'gr.ded.obj'] });
  }

  // 4. Aim and 11. Deductions the ground can propose
  patches.push({ id: 'aim', draft: `To capture ${named ? `area ${r.mitg.name}` : 'the obj (MITG)'} with fol limitations:-`, state: 'judge', basis: [frameIn] });
  {
    const reasons: string[] = [];
    if (ours.length) reasons.push(`all ${plural(ours.length, 'apch', 'apchs')} terminate on it`);
    if (r.thruRoad) reasons.push(`Rd ${aorName(r.thruRoad.name)} runs through it`);
    if (r.msr) reasons.push(`the MSR is ${km(r.msr.distM)} km away`);
    if (g.mitgObsn) reasons.push(`it sees ${pct(g.mitgObsn.seenPct)} of the ground round it`);
    const rest = others.map((o) => o.name);
    patches.push({
      id: 'gr.ded.obj',
      draft: `${cap1(mitg)} emerges as the MITG${reasons.length ? `: ${list(reasons)}` : ''}.${rest.length ? ` Other imp tac gr in order of pri: ${rest.map((x, i) => `(${i + 1}) ${x}`).join(', ')}.` : ''}`,
      state: 'judge',
      basis: [featData, calc('The MITG first, then his localities on the line nearest the attk, then in depth; a proposal'), frameIn],
    });
    const ranked = [...r.apchs].sort((a, b) => a.rank - b.rank);
    const border = ranked[0]?.cross?.border ?? null;
    if (ranked.length) patches.push({
      id: 'gr.ded.apch',
      draft: `${list(ranked.map((a) => mirrorText(rankReason(a, border)) ?? ''), 'then')}.`,
      state: 'judge',
      basis: [calc('Ranked lowest first on: km past the border + 0.3 per BUA on it + 2 per water obstacle + 10 x the share of a 1 km band that is not GO. A method, not a book rule'), goingData],
    });
    const lats = [...r.laterals].filter((l) => l.n > 0).sort((a, b) => b.n - a.n);
    if (ranked.length >= 2) patches.push({
      id: 'gr.ded.comb',
      draft: lats.length ? `${lats.map((l) => `${sideOf(l.a)} and ${sideOf(l.b)} (${plural(l.n, 'metalled lateral')})`).join('; ')}: mutual sp between them.` : 'No metalled lateral joins the apchs: no comb is served by a Rd.',
      state: 'judge',
      basis: [featData, calc('Metalled Rds joining two apchs inside the area read')],
    });
    // his lines between own start and the objective: the phases they suggest
    const order = 'WXYZ';
    const front = [...r.lines].filter((l) => l.role === 'FDLs' || l.role === 'Depth').sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    if (front.length) patches.push({
      id: 'gr.ded.c.phases',
      draft: `${front.map((l, i) => `Phase ${i + 1}: his ${l.role === 'FDLs' ? 'FDLs' : 'depth'} on Line ${l.id} (${[...new Set(l.buas.filter((x): x is string => !!x))].join(', ') || l.name})`).join('; ')}; then ${mitg}. Lines ${front.map((l) => l.id).join(' and ')} lie ${front.map((l) => (l.depthM !== null ? `${km(l.depthM)} km` : '?')).join(' and ')} past ${border ? `the ${border}` : 'the front of the area read'}.`,
      state: 'judge',
      basis: [featData, calc('The lines across the apchs that a defender of the MITG would hold: each a phase if held; a proposal, his disposns decide')],
    });
  }

  return { patches, confirm, frame: base.frame ? { ...base.frame, threat: g.threatMarked && g.startWords ? `own start ${g.startWords}` : 'own start taken opposite the threat (assumed)' } : undefined };
}

// ── the attack: direction of attack (the IPB reading onto the objective) ─────────────────────────────────────────

/** One approach of the IPB reading onto the objective, as the attacker sees it. */
export interface AprcAttkAvenue {
  id: string;
  rank: number;
  /** How it comes onto the objective (the reading's words): frontal, left, right, turn; null for an avenue through the area. */
  onto: 'frontal' | 'left' | 'right' | 'turn' | null;
  label: string;
  lengthM: number;
  goPct: number;
  minWidthM: number;
  waterLines: number;
  /** The assault from the FUP, metres, and its NO-GO share. */
  assaultM: number | null;
  assaultNogoPct: number | null;
  /** Its FUP in words. */
  fupWhere: string | null;
}

export interface AprcAttkIn {
  objective: string;
  mover: string;
  aaFor: string;
  mcWidthM: number;
  fupM: number;
  avenues: AprcAttkAvenue[];
  /** The choke on his MSR behind the objective a turning apch blocks. */
  turn: { label: string; kind: string; behindM: number; msr: boolean; where: string | null } | null;
  /** Where the approaches start, in words, and whether it was taken (no start on the map). */
  start: string;
  startAssumed: boolean;
}

/** Differences smaller than these are not called better or worse between Lt and Rt (a method setting, as WEIGH_MIN). */
export const LT_RT_MIN = { lengthPct: 10, goPct: 5, nogoPct: 5 };

const ONTO_WORD: Record<string, string> = { left: 'Lt flank', right: 'Rt flank', frontal: 'frontal', turn: 'turning' };

/** Lt against Rt flank on the facts the reading has: which is better on each, only past each head's smallest real difference. */
function lrWeigh(l: AprcAttkAvenue, rt: AprcAttkAvenue): { text: string; lt: number; rt: number } {
  const heads: string[] = [];
  let a = 0, b = 0;
  const say = (better: 'Lt' | 'Rt', what: string): void => {
    heads.push(`${better} ${what}`);
    if (better === 'Lt') a++;
    else b++;
  };
  const len = (Math.abs(l.lengthM - rt.lengthM) / Math.max(1, Math.min(l.lengthM, rt.lengthM))) * 100;
  if (len >= LT_RT_MIN.lengthPct) say(l.lengthM < rt.lengthM ? 'Lt' : 'Rt', `shorter (${km(Math.min(l.lengthM, rt.lengthM))} against ${km(Math.max(l.lengthM, rt.lengthM))} km)`);
  if (Math.abs(l.goPct - rt.goPct) >= LT_RT_MIN.goPct) say(l.goPct > rt.goPct ? 'Lt' : 'Rt', `better going (GO on ${pct(Math.max(l.goPct, rt.goPct))} against ${pct(Math.min(l.goPct, rt.goPct))})`);
  if (l.waterLines !== rt.waterLines) say(l.waterLines < rt.waterLines ? 'Lt' : 'Rt', `fewer water lines (${Math.min(l.waterLines, rt.waterLines)} against ${Math.max(l.waterLines, rt.waterLines)})`);
  if (l.assaultNogoPct !== null && rt.assaultNogoPct !== null && Math.abs(l.assaultNogoPct - rt.assaultNogoPct) >= LT_RT_MIN.nogoPct) say(l.assaultNogoPct < rt.assaultNogoPct ? 'Lt' : 'Rt', `less NO-GO on the assault (${pct(Math.min(l.assaultNogoPct, rt.assaultNogoPct))} against ${pct(Math.max(l.assaultNogoPct, rt.assaultNogoPct))})`);
  return { text: heads.length ? `${heads.join('; ')}.` : 'No real difference on the heads the data gives.', lt: a, rt: b };
}

/** Pri of Apchs / Dir of Attk, the Best Dir of Attk on the MITG, AP-1 and AP-2, the FUP and the blocking posn. */
export function writeAttkDir(e: AprcAttkIn): AprcWritten {
  const patches: AprcPatch[] = [];
  const confirm: AprcConfirm[] = [];
  const onto = e.avenues.filter((a) => a.onto);
  if (!onto.length) return { patches, confirm };
  // the user's rule (22 Nov 2026 memory: frontal attk dangerous): the turning and flanking apchs first, frontal last
  const order = [...onto].sort((a, b) => (a.onto === 'frontal' ? 1 : 0) - (b.onto === 'frontal' ? 1 : 0) || a.rank - b.rank);
  const avIn = data(`The IPB reading: apchs for ${e.aaFor} onto ${e.objective} from ${e.start}${e.startAssumed ? ' (taken)' : ''}, corridors ${km(e.mcWidthM)} km wide, coded GO / SLOW-GO / NO-GO by the book's criteria (${e.mover})`);
  const flankRule = rule('Flanking before frontal: a frontal attk has a small chance (user\'s rule); "being flanking in nature" (Mechs of Aprc (Attk) pp 3-4)');
  const turnRule = rule('A turning apch round the obj onto a choke on his MSR blocks his wdr and rft (OoW Vol II s6; IBB S35 p 140); Aim limitation b (Mechs of Aprc (Attk) p 1)');
  const fupRule = rule(`FUP ${km(e.fupM)} km short of the obj: 1000-1200 m, out of his NVD and SA reach (IBB p 201)`);
  const one = (a: AprcAttkAvenue): string =>
    `${ONTO_WORD[a.onto ?? ''] ?? a.label}: ${km(a.lengthM)} km, GO on ${pct(a.goPct)}, narrowest ${km(a.minWidthM)} km, ${a.waterLines ? plural(a.waterLines, 'water line') : 'no water line'}${a.assaultM !== null ? `; the assault ${km(a.assaultM)} km from the FUP${a.assaultNogoPct ? ` (${pct(a.assaultNogoPct)} NO-GO)` : ''}` : ''}`;
  const lt = onto.find((a) => a.onto === 'left'), rt = onto.find((a) => a.onto === 'right');
  const w = lt && rt ? lrWeigh(lt, rt) : null;
  const turnText = e.turn ? ` The turning apch blocks ${e.turn.msr ? 'his MSR' : 'the main Rd behind him'} at ${e.turn.label} (${e.turn.kind}), ${km(e.turn.behindM)} km behind ${e.objective}.` : '';
  patches.push({
    id: 'gr.ded.apch',
    draft: `Dir of attk in pri: ${order.map((a, i) => `(${i + 1}) ${one(a)}`).join('; ')}.${w ? ` Lt against Rt: ${w.text}${w.lt !== w.rt ? ` Better on ${Math.max(w.lt, w.rt)} of ${w.lt + w.rt} heads: the ${w.lt > w.rt ? 'Lt' : 'Rt'}.` : ''}` : ''}${turnText}`,
    state: 'judge',
    basis: [avIn, flankRule, ...(e.turn ? [turnRule] : []), calc(`Lt against Rt: a head counts only past its smallest real difference (length ${LT_RT_MIN.lengthPct} %, GO ${LT_RT_MIN.goPct} %, NO-GO on the assault ${LT_RT_MIN.nogoPct} %; a method setting); the weighing is the planner's`)],
  });
  const best = order[0];
  // the flank the weighing favours, when the turning apch is not the first
  const firstFlank = best.onto === 'turn' || best.onto === 'frontal' ? best : w && w.lt !== w.rt ? (w.lt > w.rt ? lt! : rt!) : best;
  patches.push({ id: 'gr.itg.mitg.dir', draft: `${cap1(ONTO_WORD[firstFlank.onto ?? ''] ?? firstFlank.label)}${firstFlank.onto === 'turn' ? '' : ` onto ${e.objective}`}.`, state: 'judge', basis: [avIn, flankRule] });
  patches.push({ id: 'gr.ded.ap1', draft: `To attk ${firstFlank.onto === 'turn' ? 'by the turning apch' : `from the ${ONTO_WORD[firstFlank.onto ?? ''] ?? firstFlank.label}`} onto ${e.objective}${e.turn && firstFlank.onto !== 'turn' ? `, with a blocking posn on his ${e.turn.msr ? 'MSR' : 'Rd'} behind it` : ''}.`, state: 'judge', basis: [avIn, flankRule] });
  if (firstFlank.fupWhere) patches.push({ id: 'gr.ded.ap1.fup', draft: `${firstFlank.fupWhere}, ${km(e.fupM)} km short of ${e.objective} on the ${ONTO_WORD[firstFlank.onto ?? ''] ?? firstFlank.label} apch.`, state: 'judge', basis: [avIn, fupRule] });
  if (e.turn) patches.push({ id: 'gr.ded.ap1.block', draft: `At ${e.turn.label}${e.turn.where ? ` (${e.turn.where})` : ''}: a ${e.turn.kind} on ${e.turn.msr ? 'his MSR' : 'the main Rd'}, ${km(e.turn.behindM)} km behind ${e.objective}; it blocks his wdr and rft.`, state: 'judge', basis: [avIn, turnRule] });
  const second = order.find((a) => a !== firstFlank && a.onto !== 'frontal') ?? order.find((a) => a !== firstFlank);
  if (second) patches.push({ id: 'gr.ded.ap2', draft: `From the ${ONTO_WORD[second.onto ?? ''] ?? second.label}: changes the dir of attk${second.fupWhere ? `; FUP ${second.fupWhere}` : ''}.`, state: 'judge', basis: [avIn] });
  confirm.push({ text: `The dir of attk rests on the ground read${e.startAssumed ? ' from a start taken opposite the threat' : ''}: walk the FUP and the assault ground, and confirm his posns on the obj.`, paras: ['gr.ded.apch', 'gr.ded.ap1'] });
  return { patches, confirm };
}

// ── the attack: a checked attack plan ────────────────────────────────────────────────────────────────────────────

/** An attack as Check my plan reads it (PlanCheck.checkAttack): its axes with their objs, FUPs, SLs and BOFs. */
export interface AprcAttkPlanIn {
  title: string;
  /** The recipe it was built from, if built ('bn-attk-left-flank' ...). */
  recipe: string | null;
  /** Each axis: its labels as drawn, and where its obj, FUP and BOF are in words ("0.6 km SW of X"). */
  axes: Array<{ label: string; phase: number; obj: string | null; objWhere: string | null; fup: string | null; fupWhere: string | null; sl: string | null; bof: string | null; bofWhere: string | null; rows: Array<{ name: string; st: string; reason: string }> }>;
  rows: Array<{ name: string; st: string; reason: string }>;
  confirm: string[];
  assumptions: string[];
}

export function writeAttkPlan(c: AprcAttkPlanIn): AprcWritten {
  const patches: AprcPatch[] = [];
  if (!c.axes.length) return { patches, confirm: [] };
  const planIn = input(`The attk on the map, as checked (${c.title})`);
  const form = c.recipe ? (/left-flank/.test(c.recipe) ? 'from the Lt flank' : /right-flank/.test(c.recipe) ? 'from the Rt flank' : /frontal/.test(c.recipe) ? 'frontally' : null) : null;
  const phases = [...new Set(c.axes.map((a) => a.phase))].sort((a, b) => a - b);
  const byPhase = (n: number) => c.axes.filter((a) => a.phase === n);
  /** "FUP 2 0.6 km SW of X": its label when it has one of its own, then where it is. */
  const named = (kind: string, label: string | null, at: string | null): string =>
    [label && new RegExp(`^${kind}(\\b|\\d)`, 'i').test(label) ? label : [kind, label ?? ''].filter(Boolean).join(' '), at ?? ''].filter(Boolean).join(' ');
  type Axis = AprcAttkPlanIn['axes'][number];
  const fupOf = (a: Axis): string => named('FUP', a.fup, a.fupWhere);
  const bofOf = (a: Axis): string => named('BOF', a.bof, a.bofWhere);
  const axisText = (a: Axis): string =>
    `${a.label} onto ${a.obj ?? 'an obj not drawn'}${a.objWhere ? ` (${a.objWhere})` : ''}${a.fup ? `, ${fupOf(a)}` : ''}${a.sl ? `, ${named('SL', a.sl, null)}` : ''}${a.bof ? `, ${bofOf(a)}` : ''}`;
  const outline = `Attk${form ? ` ${form}` : ''} in ${plural(phases.length, 'phase')}: ${phases.map((n) => `Phase ${n}: ${byPhase(n).map(axisText).join('; ')}`).join('. ')}.`;
  patches.push({ id: 'crs.a', draft: `${c.title}. ${outline}`, state: 'map', basis: [planIn] });
  patches.push({ id: 'plan.exec.outline', draft: outline, state: 'map', basis: [planIn] });
  const objs = (n: number) => [...new Set(byPhase(n).map((a) => a.obj).filter((x): x is string => !!x))];
  if (objs(1).length) patches.push({ id: 'gr.ded.ap1.ph1', draft: `Capturing ${list(objs(1))}.`, state: 'map', basis: [planIn] });
  if (objs(2).length) patches.push({ id: 'gr.ded.ap1.ph2', draft: `Capturing ${list(objs(2))}.`, state: 'map', basis: [planIn] });
  const a1 = byPhase(phases[0])[0];
  if (a1?.fup) patches.push({ id: 'gr.ded.ap1.fup', draft: `${fupOf(a1)} (as drawn).`, state: 'map', basis: [planIn] });
  if (a1?.bof) {
    patches.push({ id: 'gr.ded.ap1.bof', draft: `${bofOf(a1)} (as drawn).`, state: 'map', basis: [planIn] });
    patches.push({ id: 'gr.ded.c.bof', draft: `${bofOf(a1)}, as drawn: it engages the obj irrespective of the AP.`, state: 'map', basis: [planIn] });
  }
  const locs = [a1?.fup ? fupOf(a1) : '', a1?.bof ? bofOf(a1) : '', a1?.sl ? named('SL', a1.sl, null) : ''].filter(Boolean);
  if (locs.length) patches.push({ id: 'plan.exec.coord.loc', draft: `${locs.join('; ')}.`, state: 'map', basis: [planIn] });
  // the tasks the plan sets (the figures are the planner's)
  const rows = taskRowsAttk(objs(1), objs(2), a1?.bof ? bofOf(a1).replace(/^BOF /, '') : null);
  for (const id of ['own.tasks', 'almt']) patches.push({ id, draft: '', state: 'map', table: { head: TASK_HEAD_ATTK, rows, widths: [0.07, 0.33, 0.12, 0.12, 0.12, 0.12, 0.12] }, basis: [planIn, calc('Tasks and objs by phase as drawn; the tps for each are the planner\'s')] });
  // advs and disadvs: the check's rows
  const all = [...c.rows, ...c.axes.flatMap((a) => a.rows.map((r) => ({ ...r, name: `${a.label}: ${r.name}` })))];
  const adv = all.filter((r) => r.st === 'pass'), dis = all.filter((r) => r.st === 'fail' || r.st === 'warn');
  const checkCalc = calc('From Check my plan: a row that passes is an adv, a row that fails or warns a disadv, each with its reason');
  const say = (rs: typeof all): string => `${rs.map((r) => `${r.name}: ${r.reason}`.replace(/\.$/, '')).join('. ')}.`;
  if (adv.length) patches.push({ id: 'crs.an.adv', draft: say(adv), state: 'judge', basis: [planIn, checkCalc] });
  if (dis.length) patches.push({ id: 'crs.an.dis', draft: say(dis), state: 'judge', basis: [planIn, checkCalc] });
  return { patches, confirm: [...c.confirm, ...c.assumptions.map((a) => `Assumed: ${a}`)].map((text) => ({ text, paras: ['crs.a'] })) };
}

// ── symbols on the map ───────────────────────────────────────────────────────────────────────────────────────────

export interface AprcSymbolIn {
  id: string;
  /** Symbols.json key: symbol set + entity. */
  key: string;
  name: string;
  side: 'own' | 'enemy' | 'other';
  /** 2525D echelon code ('15' Coy ...), or null. */
  ech: string | null;
  label: string;
  /** Where it is, in words ("gen area X", "1.2 km N of X"). */
  where: string | null;
  planned?: boolean;
}

const ECH: Record<string, string> = { '11': 'Team', '12': 'Sqd', '13': 'Sec', '14': 'Pl', '15': 'Coy', '16': 'Bn', '17': 'Regt', '18': 'Bde', '21': 'Div', '22': 'Corps', '23': 'Army' };
const ECH_RANK = ['23', '22', '21', '18', '17', '16', '15', '14', '13', '12', '11'];
const isUnit = (s: AprcSymbolIn): boolean => s.key.slice(0, 2) === '10' || (s.ech !== null && s.key.slice(0, 2) !== '25');
const isObstacle = (s: AprcSymbolIn): boolean => s.key.slice(0, 2) === '25' && /mine|obstacle|ditch|wire|abatis|crater|road ?block|demolition|booby|tank trap|inundat/i.test(s.name);

/** "2 x Infantry Bde, 1 x Armour Regt", largest echelon first. */
export function forceLine(units: AprcSymbolIn[]): string {
  const m = new Map<string, { n: number; ech: string | null; name: string }>();
  for (const u of units) {
    const k = `${u.ech ?? ''}|${u.name}`;
    const e = m.get(k) ?? { n: 0, ech: u.ech, name: u.name };
    e.n++;
    m.set(k, e);
  }
  const rank = (e: string | null) => (e === null ? 99 : ECH_RANK.indexOf(e) < 0 ? 98 : ECH_RANK.indexOf(e));
  return [...m.values()].sort((a, b) => rank(a.ech) - rank(b.ech) || a.name.localeCompare(b.name)).map((e) => `${e.n} x ${e.name}${e.ech && ECH[e.ech] ? ` ${ECH[e.ech]}` : ''}`).join(', ');
}

const where = (units: AprcSymbolIn[], max = 6): string =>
  units.slice(0, max).map((u) => `${u.label || u.name}${u.ech && ECH[u.ech] ? ` (${ECH[u.ech]})` : ''}${u.where ? ` ${u.where}` : ''}`).join('; ') + (units.length > max ? `; and ${units.length - max} more` : '');

export function writeSymbols(symbols: AprcSymbolIn[]): AprcWritten & { drawnObs: string[]; enForce: string | null; ownWhere: string | null } {
  const patches: AprcPatch[] = [];
  const en = symbols.filter((s) => s.side === 'enemy' && isUnit(s));
  const own = symbols.filter((s) => s.side === 'own' && isUnit(s));
  const mapIn = input('Symbols on the map, as drawn');
  if (en.length) {
    patches.push({ id: 'rev.en', draft: `Marked on the map: ${forceLine(en)}.`, state: 'map', basis: [mapIn], prompts: ['Add his likely aim and timings'] });
    patches.push({ id: 'en.comp', draft: `${forceLine(en)}. ${where(en)}.`, state: 'map', basis: [mapIn] });
    // the attack: his disposns as marked, under his option against AP-1
    patches.push({ id: 'en.opt1.disp', draft: `Marked on the map: ${forceLine(en)}. ${where(en)}.`, state: 'map', basis: [mapIn] });
  }
  if (own.length) {
    patches.push({ id: 'rev.own', draft: `Marked on the map: ${forceLine(own)}.`, state: 'map', basis: [mapIn], prompts: ['Add the higher formation and its task'] });
    patches.push({ id: 'own.comp', draft: `${forceLine(own.filter((u) => !u.planned))}.`.replace(/^\.$/, ''), state: 'map', basis: [mapIn] });
    patches.push({ id: 'own.disp', draft: `${where(own, 10)}.`, state: 'map', basis: [mapIn] });
  }
  if (en.length || own.length) {
    const arms = [...new Set([...en, ...own].map((u) => u.name))].sort();
    const table: AprcTable = {
      head: ['Ser', 'Arms', 'En', 'Own', 'Ratio'],
      rows: arms.slice(0, 12).map((a, i) => [`${String.fromCharCode(97 + i)}.`, a, forceLine(en.filter((u) => u.name === a)).replace(new RegExp(` x ${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), ' x') || '0', forceLine(own.filter((u) => u.name === a)).replace(new RegExp(` x ${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), ' x') || '0', '']),
    };
    patches.push({ id: 'own.str', draft: '', state: 'map', table, basis: [mapIn, calc('Counted as marked, by echelon. The ratio is left to the planner: it needs each unit at its real strength')] });
  }
  const drawnObs = symbols.filter(isObstacle).map((s) => `${s.label || s.name}${s.where ? ` ${s.where}` : ''}`);
  return { patches, confirm: en.length ? [] : [{ text: 'No en symbols on the map: his strength and start points are not known to the reading.', paras: ['rev.en', 'en.comp', 'own.str'] }], drawnObs, enForce: en.length ? forceLine(en) : null, ownWhere: own.length ? where(own, 10) : null };
}

// ── a checked plan ───────────────────────────────────────────────────────────────────────────────────────────────

/** The parts of a plan check (PlanCheck.CheckReport) the appreciation uses. */
export interface AprcCheckIn {
  title: string;
  posns: Array<{ label: string; kind: string; ech?: string | null; planned?: boolean }>;
  rows: Array<{ name: string; st: string; reason: string }>;
  triggers?: Array<{ trigger: string; who: string; from: string; to: string; min: number; enemyMin: number; st: string; reason: string }>;
  confirm?: string[];
  assumptions?: string[];
}

const KIND_WORD: Array<[string, string]> = [['fwd', 'Fwd'], ['depth', 'Depth'], ['res', 'Res'], ['cpen', 'C pen posns'], ['sup', 'Sup posns'], ['alt', 'Alternate posns']];

export function writePlan(c: AprcCheckIn): AprcWritten {
  const patches: AprcPatch[] = [];
  const planIn = input(`The plan on the map, as checked (${c.title})`);
  const groups = KIND_WORD.map(([k, wd]) => [wd, c.posns.filter((p) => p.kind === k).map((p) => p.label).filter(Boolean)] as const).filter(([, l]) => l.length);
  if (groups.length) {
    const text = `${groups.map(([wd, l]) => `${wd}: ${list(l)}`).join('. ')}.`;
    patches.push({ id: 'own.disp', draft: text, state: 'map', basis: [planIn] });
    patches.push({ id: 'plan.exec.outline', draft: text, state: 'map', basis: [planIn] });
    patches.push({ id: 'crs.a', draft: `${c.title}. ${text}`, state: 'map', basis: [planIn] });
  }
  const adv = c.rows.filter((r) => r.st === 'pass');
  const dis = c.rows.filter((r) => r.st === 'fail' || r.st === 'warn');
  const checkCalc = calc('From Check my plan: a row that passes is an adv, a row that fails or warns a disadv, each with its reason');
  if (adv.length) patches.push({ id: 'crs.an.adv', draft: `${adv.map((r) => `${r.name}: ${r.reason}`).join('. ').replace(/\.\./g, '.')}.`.replace(/\.\.$/, '.'), state: 'judge', basis: [planIn, checkCalc] });
  if (dis.length) patches.push({ id: 'crs.an.dis', draft: `${dis.map((r) => `${r.name}: ${r.reason}`).join('. ').replace(/\.\./g, '.')}.`.replace(/\.\.$/, '.'), state: 'judge', basis: [planIn, checkCalc] });
  const tr = c.triggers ?? [];
  if (tr.length) {
    patches.push({
      id: 'crs.react',
      draft: '',
      state: 'judge',
      table: {
        head: ['Ser', 'En Reactions', 'Own Ctr Actions'],
        rows: tr.slice(0, 26).map((t, i) => [`${String.fromCharCode(97 + i)}.`, `${t.trigger}: his lead element there in ${Math.round(t.enemyMin)} min.`, `${t.who} from ${t.from} to ${t.to}: ${Math.round(t.min)} min. ${t.st === 'pass' ? 'In time.' : t.reason}`]),
        widths: [0.08, 0.42, 0.5],
      },
      basis: [planIn, calc('The what-if: his time along the approach at the IPB rates against each own move on foot or mounted')],
    });
  }
  return { patches, confirm: [...(c.confirm ?? []), ...(c.assumptions ?? []).map((a) => `Assumed: ${a}`)].map((text) => ({ text, paras: ['crs.a'] })) };
}

// ── the enemy's options (the IPB reading) ────────────────────────────────────────────────────────────────────────

/** One avenue of the IPB reading toward the position, with the places it passes and its times from H. */
export interface AprcAvenueIn {
  id: string;
  rank: number;
  viable: boolean;
  main: boolean;
  lengthM: number;
  goPct: number;
  minWidthM: number;
  waterLines: number;
  /** Named places it passes, in order, nearest within 800 m. */
  through: string[];
  /** "Lt flanking", "frontal", "turning": how it comes onto the objective, when it does. */
  onto: string | null;
  /** Hours from H: reaching the avenue's start, and its end (earliest by day on GO, latest by night). */
  startH: [number, number];
  endH: [number, number];
  /** Where it crosses each line of def, front first: the line, its role and his hours there. */
  lines?: Array<{ id: string; role: string; h: [number, number] }>;
}

export interface AprcEnemyIn {
  /** The en force as marked ("2 x Infantry Bde, 1 x Armour Regt"), or null when none is marked. */
  force: string | null;
  mover: string;
  rates: { go: [number, number]; slow: [number, number] };
  fromThreat: boolean;
  aaFor: string;
  mcWidthM: number;
  /** Where the avenues end: the objective in words ("Qila Mor", "the MITG"). */
  objective: string;
  avenues: AprcAvenueIn[];
  tais: Array<{ id: string; aa: string; why: string; earliestH: number; latestH: number }>;
  dps: Array<{ id: string; kind: 'interdict' | 'catk'; aa: string; tai: string | null; decision: string; earliestH: number; beforeH: boolean }>;
  template: { label: string; src: string; confirmed: boolean; phases: Array<{ phase: string; time: string }> } | null;
  /** H as a clock time on D Day ("HH:MM"), for clock times beside H+; null or empty: H+ only. */
  hHour?: string | null;
}

export const hplus = (h: number): string => {
  const m = Math.round(Math.abs(h) * 60);
  return `H${h < 0 ? '-' : '+'}${Math.floor(m / 60)}${m % 60 ? `:${String(m % 60).padStart(2, '0')}` : ''}`;
};

/** Differences smaller than these are not a difference: the readings are not that exact (a method setting). */
export const WEIGH_MIN = { hours: 0.25, goPct: 5 };

/** Advs and disadvs of each avenue against the others (facts compared; the weighing stays the planner's). */
function weigh(a: AprcAvenueIn, all: AprcAvenueIn[], mcWidthM: number): { adv: string[]; dis: string[] } {
  const adv: string[] = [], dis: string[] = [];
  const many = all.length > 1;
  const min = (f: (x: AprcAvenueIn) => number) => Math.min(...all.map(f));
  const max = (f: (x: AprcAvenueIn) => number) => Math.max(...all.map(f));
  const tSpread = many && max((x) => x.endH[0]) - min((x) => x.endH[0]) >= WEIGH_MIN.hours;
  const gSpread = many && max((x) => x.goPct) - min((x) => x.goPct) >= WEIGH_MIN.goPct;
  if (tSpread && a.endH[0] === min((x) => x.endH[0])) adv.push(`earliest onto the objective (${hplus(a.endH[0])})`);
  if (tSpread && a.endH[0] === max((x) => x.endH[0])) dis.push(`latest onto the objective (${hplus(a.endH[0])})`);
  if (gSpread && a.goPct === max((x) => x.goPct)) adv.push(`best going (GO on ${pct(a.goPct)})`);
  if (gSpread && a.goPct === min((x) => x.goPct)) dis.push(`worst going (GO on ${pct(a.goPct)})`);
  if (a.minWidthM >= mcWidthM) adv.push(`room all along (no narrower than ${km(a.minWidthM)} km)`);
  else dis.push(`narrows to ${km(a.minWidthM)} km, less than the ${km(mcWidthM)} km corridor`);
  if (a.waterLines === 0) adv.push('no water line to cross');
  else dis.push(`${plural(a.waterLines, 'water line')} to cross`);
  if (a.onto === 'turning') adv.push('turns the position and reaches the MSR behind it');
  return { adv, dis };
}

export function writeEnemy(e: AprcEnemyIn): AprcWritten {
  const patches: AprcPatch[] = [];
  const confirm: AprcConfirm[] = [];
  const av = [...e.avenues].filter((a) => a.viable).sort((a, b) => a.rank - b.rank);
  if (!av.length) return { patches, confirm };
  const rateRule = rule(`Unopposed rates (IPB book p 18): ${e.mover} ${e.rates.go[0]} km/h by day, ${e.rates.go[1]} by night on GO; ${e.rates.slow[0]} / ${e.rates.slow[1]} on SLOW-GO`);
  const how = calc(`His time along each avenue: each stretch at the rate for its going; earliest = by day, unassessed ground taken as GO; latest = by night, unassessed as SLOW-GO; from ${e.fromThreat ? 'the Threat marker' : 'the edge of the area read'} at H`);
  const avIn = data(`The IPB reading: avenues for ${e.aaFor}, corridors ${km(e.mcWidthM)} km wide, coded GO / SLOW-GO / NO-GO by the book's criteria`);
  const cmp = calc('The avenues compared on time, going, width and water lines');
  const hMin = parseHHour(e.hHour);
  const hIn = hMin !== null ? [input(`H: ${e.hHour} on D Day`)] : [];
  const who = e.force ?? 'The en (strength not marked)';
  /** His phases by the lines of def he meets: before the FDLs the prelim ph, the FDLs the break-in, then the depth, then the objective. */
  const phasesText = (a: AprcAvenueIn): string => {
    const ls = [...(a.lines ?? [])].sort((x, y) => x.h[0] - y.h[0]);
    if (!ls.length) return '';
    const fdlH = ls.find((l) => l.role === 'FDLs')?.h[0] ?? null;
    const name = (l: { role: string; h: [number, number] }): string =>
      l.role === 'FDLs' ? 'Ph 1 (break-in)' : fdlH !== null && l.h[0] > fdlH ? 'Ph 2' : fdlH === null && l.role === 'Depth' ? 'Ph 2' : 'Prelim ph';
    const parts = ls.filter((l) => l.role !== 'Str Pt').map((l) => `${name(l)}, Line ${l.id}${l.role ? ` (${l.role})` : ''} at ${whenText(l.h, hMin)}`);
    parts.push(`Ph 3, onto ${e.objective} at ${whenText(a.endH, hMin)}`);
    return ` Unopposed, his phases would run: ${parts.join('; ')}. Each fight adds to these times.`;
  };
  const optText = (a: AprcAvenueIn): string =>
    `${who} along ${a.id}${a.onto ? ` (${a.onto})` : ''}: ${km(a.lengthM)} km, GO on ${pct(a.goPct)}, narrowest ${km(a.minWidthM)} km${a.through.length ? `, through ${list(a.through.slice(0, 6))}` : ''}. ` +
    `His lead element reaches the avenue at ${whenText(a.startH, hMin)} and ${e.objective} at ${whenText(a.endH, hMin)}.${phasesText(a)}`;
  const linesCalc = av.some((a) => a.lines?.length) ? [calc('His time at each line of def: where the avenue crosses it, at the same rates')] : [];
  const tpl = e.template;
  // The template's phase names only: their timings are long and belong to the template, not the paragraph.
  const phaseNames = tpl ? [...new Set(tpl.phases.map((p) => p.phase.trim()).filter(Boolean))].slice(0, 6) : [];
  const tplLine = tpl && phaseNames.length ? ` Doctrinal template "${tpl.label}"${tpl.confirmed ? '' : ' (a reading still to confirm)'}: phases ${list(phaseNames)}.` : '';

  const a1 = av[0];
  const w1 = weigh(a1, av.slice(0, 2), e.mcWidthM);
  patches.push({ id: 'en.opt1.what', draft: `${optText(a1)}${tplLine}`, state: 'judge', basis: [avIn, rateRule, how, ...linesCalc, ...hIn, ...(tpl ? [data(`Template: ${tpl.src}`)] : [])] });
  if (w1.adv.length) patches.push({ id: 'en.opt1.adv', draft: `${cap1(w1.adv.join('; '))}.`, state: 'judge', basis: [cmp] });
  if (w1.dis.length) patches.push({ id: 'en.opt1.dis', draft: `${cap1(w1.dis.join('; '))}.`, state: 'judge', basis: [cmp] });
  // Options 1 and 2 are the two best-ranked avenues, compared with each other.
  const opts = av.slice(0, 2);
  if (av[1]) {
    const w2 = weigh(av[1], opts, e.mcWidthM);
    patches.push({ id: 'en.opt2', draft: `${optText(av[1])}${w2.adv.length ? ` Advs: ${w2.adv.join('; ')}.` : ''}${w2.dis.length ? ` Disadvs: ${w2.dis.join('; ')}.` : ''}`, state: 'judge', basis: [avIn, rateRule, how, ...linesCalc, ...hIn, cmp] });
    const fastest = [...opts].sort((a, b) => a.endH[0] - b.endH[0])[0];
    if (Math.abs(opts[0].endH[0] - opts[1].endH[0]) >= WEIGH_MIN.hours) patches.push({ id: 'en.danger', draft: `Along ${fastest.id}: he is onto ${e.objective} earliest, at ${whenText(fastest.endH[0], hMin)}.`, state: 'judge', basis: [how, calc('Most dangerous taken as the earliest onto the objective; a proposal')] });
  }

  // His reactions against own counter actions: the TAIs and the decisions before them.
  const rows: string[][] = [];
  for (const t of [...e.tais].sort((a, b) => a.earliestH - b.earliestH)) {
    const dp = e.dps.find((d) => d.tai === t.id);
    rows.push([
      '',
      `His lead element at ${t.id} on ${t.aa} (${t.why}): ${whenText([t.earliestH, t.latestH], hMin)}.`,
      dp ? `${dp.id}: ${dp.decision.replace(/[.?]\s*$/, '')}${dp.beforeH ? ' (before H)' : ` by ${whenText(dp.earliestH, hMin)}`}.` : 'Engage him there with the fire planned on it.',
    ]);
  }
  for (const d of e.dps.filter((x) => x.kind === 'catk')) rows.push(['', `He is onto the depth localities on ${d.aa}.`, `${d.id}: ${d.decision.replace(/[.?]\s*$/, '')} by ${whenText(d.earliestH, hMin)}.`]);
  rows.forEach((r, i) => (r[0] = `${String.fromCharCode(97 + (i % 26))}.`));
  if (rows.length)
    patches.push({
      id: 'crs.react',
      draft: '',
      state: 'judge',
      table: { head: ['Ser', 'En Reactions', 'Own Ctr Actions'], rows: rows.slice(0, 26), widths: [0.08, 0.46, 0.46] },
      basis: [avIn, how, rule('A decision is taken while he is at least 2 hrs from the TAI (IPB book p 30)')],
    });
  confirm.push({ text: `His times are the book's unopposed rates on the ground read, ${e.fromThreat ? 'from the Threat marker' : 'from the edge of the area read (no Threat marker)'}: set H and check them against his doctrine.`, paras: ['en.opts', 'crs.react'] });
  return { patches, confirm };
}

// ── tasks for DP 1 (the lines of def) ────────────────────────────────────────────────────────────────────────────

/**
 * The tasks DP 1 gives: a Coy (3 Pls) to each BUA astride an apch on the FDLs and in depth, a Pl for the Str Pt and one
 * for the screen. A working assumption, laid out for the planner to change.
 */
export function writeTasks(r: AorReading): AprcWritten & { pls: number | null } {
  const patches: AprcPatch[] = [];
  const fdl = r.lines.find((l) => l.role === 'FDLs');
  const depth = r.lines.find((l) => l.role === 'Depth');
  const screen = r.lines.find((l) => l.role === 'Screen');
  if (!fdl) return { patches, confirm: [], pls: null };
  const named = !!r.mitg.name && r.mitg.name !== 'MITG';
  const rows: string[][] = [];
  let pls = 0, n = 0;
  const lab = () => `(${++n})`;
  const locs = (l: AorDefLine, what: string): void => {
    const b = [...new Set(l.buas.filter((x): x is string => !!x))];
    if (!b.length) {
      rows.push([lab(), `${what}: Line ${l.id}`, '3 x pl', '', '']);
      pls += 3;
      return;
    }
    const first = lab();
    b.forEach((x, i) => {
      rows.push([i === 0 ? first : '', `${what}: ${x}`, '3 x pl', '', '']);
      pls += 3;
    });
  };
  locs(fdl, 'FDLs');
  if (depth) locs(depth, 'Depth');
  rows.push([lab(), `Str Pt: ${named ? r.mitg.name : 'the MITG'}`, '1 x pl', '', '']);
  pls++;
  if (screen) {
    rows.push([lab(), `Screen: ahead of Line ${fdl.id}`, '1 x pl', '', '']);
    pls++;
  }
  rows.push([lab(), 'Total', `${pls} x pl`, '', '']);
  const basis = [calc('A Coy (3 Pls) to each BUA astride an apch on the FDLs and in depth, a Pl each for the Str Pt and the screen: a working assumption to change, not a book figure'), data('BUAs astride the apchs on each line: the AOR reading')];
  patches.push({ id: 'own.tasks.dp1', draft: '', state: 'judge', table: { head: ['Ser', 'Locs', 'Inf', 'A tk', 'Engrs'], rows, widths: [0.1, 0.44, 0.16, 0.15, 0.15] }, basis });
  patches.push({ id: 'own.ded.basic', draft: `DP 1 needs ${pls} x pl. Set this against the pls held and say how the difference is met.`, state: 'judge', basis, prompts: ['Almt of tps to tasks'] });
  return { patches, confirm: [], pls };
}

// ── clock times ──────────────────────────────────────────────────────────────────────────────────────────────────

/** "HH:MM" or "HHMM" (24 h) to minutes after midnight on D Day; null when it is neither. */
export function parseHHour(s: string | null | undefined): number | null {
  const m = /^\s*([01]?\d|2[0-3]):?([0-5]\d)\s*$/.exec(String(s ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** A time H + `h` hours as a clock time on its day: "0740 hrs D Day", "0110 hrs D+1". */
export function clockAt(hMin: number, h: number): string {
  const t = Math.round(hMin + h * 60);
  const day = Math.floor(t / 1440);
  const m = ((t % 1440) + 1440) % 1440;
  const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`;
  return `${hhmm} hrs ${day === 0 ? 'D Day' : `D${day > 0 ? '+' : ''}${day}`}`;
}

/** "H+1:40" or, with H set, "H+1:40 (0740 hrs D Day)"; a span "H+1:40 to H+7:04 (0740 hrs D Day to 1304 hrs D Day)". */
export function whenText(t: [number, number] | number, hMin: number | null): string {
  const [a, b] = Array.isArray(t) ? t : [t, t];
  const one = Math.abs(b - a) < 0.05;
  const rel = one ? hplus(a) : `${hplus(a)} to ${hplus(b)}`;
  if (hMin === null) return rel;
  return `${rel} (${one ? clockAt(hMin, a) : `${clockAt(hMin, a)} to ${clockAt(hMin, b)}`})`;
}

// ── relative strength (ORBAT) ────────────────────────────────────────────────────────────────────────────────────

/** One unit of a side: its ORBAT figures, and how many of it. */
export interface AprcForceUnit {
  name: string;
  count: number;
  /** Manoeuvre Coys / Sqns (ORBAT). */
  coys: number;
  /** All ranks; null when the ORBAT does not print it. */
  strength: number | null;
  atgm: number;
  mortars: number;
  plsPerCoy: number | null;
  src: string;
}

export interface AprcStrengthIn {
  en: AprcForceUnit[];
  /** Why the en is assumed (no en symbol marked), else null. */
  enAssumed: string | null;
  own: AprcForceUnit[];
  ownAssumed: string | null;
  /** Pls DP 1 needs (the tasks table), or null. */
  need: number | null;
}

const ratio = (en: number, own: number): string => (own > 0 ? `${(en / own).toFixed(1)} : 1` : en > 0 ? `${en} : 0` : '–');
const sumOf = (us: AprcForceUnit[], f: (u: AprcForceUnit) => number | null): number | null => {
  let s = 0;
  for (const u of us) {
    const v = f(u);
    if (v === null) return null;
    s += v * u.count;
  }
  return s;
};
const unitsText = (us: AprcForceUnit[]): string => us.map((u) => `${u.count} x ${u.name}`).join(', ');
const n1 = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/**
 * Own Str as Related to that of the En, and how the Pls held meet DP 1's tasks. The attack (`o.attack`) gives the ratio
 * own to en (an attacker wants more than 3 : 1) and the composition with the disposns marked (`o.disposns`).
 */
export function writeStrength(s: AprcStrengthIn, o: { attack?: boolean; disposns?: string | null } = {}): AprcWritten {
  const patches: AprcPatch[] = [];
  if (!s.en.length || !s.own.length) return { patches, confirm: [] };
  const coysEn = sumOf(s.en, (u) => u.coys) ?? 0, coysOwn = sumOf(s.own, (u) => u.coys) ?? 0;
  const stEn = sumOf(s.en, (u) => u.strength), stOwn = sumOf(s.own, (u) => u.strength);
  const atEn = sumOf(s.en, (u) => u.atgm) ?? 0, atOwn = sumOf(s.own, (u) => u.atgm) ?? 0;
  const moEn = sumOf(s.en, (u) => u.mortars) ?? 0, moOwn = sumOf(s.own, (u) => u.mortars) ?? 0;
  if (o.attack) {
    const r2 = (own: number, en: number): string => (en > 0 ? `${(own / en).toFixed(1)} : 1` : own > 0 ? `${own} : 0` : '–');
    const rows = [
      ['a.', 'Manoeuvre Coys / Sqns', n1(coysEn), n1(coysOwn), r2(coysOwn, coysEn)],
      ['b.', 'All ranks', stEn === null ? '?' : stEn.toLocaleString('en-GB'), stOwn === null ? '?' : stOwn.toLocaleString('en-GB'), stEn !== null && stOwn !== null ? r2(stOwn, stEn) : '?'],
      ['c.', 'ATGM launchers', String(atEn), String(atOwn), r2(atOwn, atEn)],
      ['d.', 'Mortars', String(moEn), String(moOwn), r2(moOwn, moEn)],
    ];
    const srcs = [...new Set([...s.en, ...s.own].map((u) => u.src))];
    const basis: AprcBasis[] = [data(`ORBAT: ${srcs.join('; ')}`), calc('Each side summed over its units; ratio = own to en'), rule('An attacker wants more than 3 : 1, applied sequentially (MW p 80)')];
    if (s.enAssumed) basis.push(input(`En assumed: ${s.enAssumed}`));
    if (s.ownAssumed) basis.push(input(`Own assumed: ${s.ownAssumed}`));
    const ratio = coysEn > 0 ? coysOwn / coysEn : null;
    patches.push({
      id: 'own.str',
      draft: `Own: ${unitsText(s.own)}${s.ownAssumed ? ' (assumed)' : ''}. En: ${unitsText(s.en)}${s.enAssumed ? ' (assumed)' : ''}.${ratio !== null ? ` Manoeuvre Coys ${ratio.toFixed(1)} : 1 own to en: ${ratio > 3 ? 'more than the 3 : 1 an attacker wants' : 'short of the 3 : 1 an attacker wants; phase the attk or ask for more tps'}.` : ''}`,
      state: s.enAssumed || s.ownAssumed ? 'judge' : 'map',
      table: { head: ['Ser', 'Arms', 'En', 'Own', 'Ratio'], rows, widths: [0.08, 0.36, 0.2, 0.2, 0.16] },
      basis,
    });
    const ownComp = s.own.map((u) => `${u.count} x ${u.name}: ${n1(u.coys)} manoeuvre Coys${u.plsPerCoy ? ` of ${u.plsPerCoy} Pls` : ''}${u.strength ? `, ${u.strength.toLocaleString('en-GB')} all ranks` : ''}${u.atgm ? `, ${u.atgm} ATGM launchers` : ''}${u.mortars ? `, ${u.mortars} mortars` : ''}`).join('; ');
    patches.push({ id: 'own.comp', draft: `${ownComp}.${o.disposns ? ` Disposns: ${o.disposns}.` : ''}`, state: s.ownAssumed ? 'judge' : 'map', basis: [data(`ORBAT: ${[...new Set(s.own.map((u) => u.src))].join('; ')}`), ...(o.disposns ? [input('Symbols on the map, as drawn')] : []), ...(s.ownAssumed ? [input(`Own assumed: ${s.ownAssumed}`)] : [])] });
    return { patches, confirm: s.enAssumed ? [{ text: `En strength is assumed (${s.enAssumed}): mark his posns on the map for the real figures.`, paras: ['own.str'] }] : [] };
  }
  const rows = [
    ['a.', 'Manoeuvre Coys / Sqns', n1(coysEn), n1(coysOwn), ratio(coysEn, coysOwn)],
    ['b.', 'All ranks', stEn === null ? '?' : stEn.toLocaleString('en-GB'), stOwn === null ? '?' : stOwn.toLocaleString('en-GB'), stEn !== null && stOwn !== null ? ratio(stEn, stOwn) : '?'],
    ['c.', 'ATGM launchers', String(atEn), String(atOwn), ratio(atEn, atOwn)],
    ['d.', 'Mortars', String(moEn), String(moOwn), ratio(moEn, moOwn)],
  ];
  const srcs = [...new Set([...s.en, ...s.own].map((u) => u.src))];
  const basis: AprcBasis[] = [data(`ORBAT: ${srcs.join('; ')}`), calc('Each side summed over its units; ratio = en to own')];
  if (s.enAssumed) basis.push(input(`En assumed: ${s.enAssumed}`));
  if (s.ownAssumed) basis.push(input(`Own assumed: ${s.ownAssumed}`));
  patches.push({
    id: 'own.str',
    draft: `En: ${unitsText(s.en)}${s.enAssumed ? ' (assumed)' : ''}. Own: ${unitsText(s.own)}${s.ownAssumed ? ' (assumed)' : ''}.`,
    state: s.enAssumed || s.ownAssumed ? 'judge' : 'map',
    table: { head: ['Ser', 'Arms', 'En', 'Own', 'Ratio'], rows, widths: [0.08, 0.36, 0.2, 0.2, 0.16] },
    basis,
  });
  const ownComp = s.own.map((u) => `${u.count} x ${u.name}: ${n1(u.coys)} manoeuvre Coys${u.plsPerCoy ? ` of ${u.plsPerCoy} Pls` : ''}${u.strength ? `, ${u.strength.toLocaleString('en-GB')} all ranks` : ''}${u.atgm ? `, ${u.atgm} ATGM launchers` : ''}${u.mortars ? `, ${u.mortars} mortars` : ''}`).join('; ');
  patches.push({ id: 'own.comp', draft: `${ownComp}.`, state: s.ownAssumed ? 'judge' : 'map', basis: [data(`ORBAT: ${[...new Set(s.own.map((u) => u.src))].join('; ')}`), ...(s.ownAssumed ? [input(`Own assumed: ${s.ownAssumed}`)] : [])] });
  const held = sumOf(s.own, (u) => (u.plsPerCoy === null ? null : u.coys * u.plsPerCoy));
  if (s.need !== null && held !== null) {
    const pairs = Math.floor(atOwn / 2);
    const diff = held - s.need;
    patches.push({
      id: 'own.ded.basic',
      draft: `DP 1 needs ${s.need} x pl; ${unitsText(s.own)} holds ${Math.round(held)} x pl: ${diff < 0 ? `short by ${-Math.round(diff)} x pl. Say how the shortfall is met (regrouping, a locality held by less, more tps from higher HQ)` : diff > 0 ? `${Math.round(diff)} x pl to spare for the res or the screen` : 'exactly met, with nothing in res'}. ${pairs} ATGM pairs held for the A tk tasks.`,
      state: 'judge',
      basis: [data(`ORBAT: ${[...new Set(s.own.map((u) => u.src))].join('; ')}`), calc('Pls held = manoeuvre Coys x Pls a Coy; ATGM pairs = launchers / 2'), calc('Pls needed: the DP 1 tasks table')],
    });
  }
  return { patches, confirm: s.enAssumed ? [{ text: `En strength is assumed (${s.enAssumed}): mark his units on the map for the real figures.`, paras: ['own.str'] }] : [] };
}

// ── time required ────────────────────────────────────────────────────────────────────────────────────────────────

export interface AprcTimeIn {
  /** The move in: from where (words), straight-line km, the speed taken and its source. Null: no move found. */
  move: { from: string; km: number; kmh: number; src: string } | null;
  /** Posns prepared in [min, max] hours, and the source. */
  prep: { h: [number, number]; src: string } | null;
  /** The protective minefield along the FDLs. */
  mines: { frontM: number; engr: string; handH: number | null; mechH: number | null; perPl: number; src: string } | null;
}

/** Time Req: the rows the data gives, the others ruled for the planner. */
export function writeTimeReq(t: AprcTimeIn): AprcWritten {
  const patches: AprcPatch[] = [];
  if (!t.move && !t.prep && !t.mines) return { patches, confirm: [] };
  const rows: string[][] = [];
  const basis: AprcBasis[] = [];
  let low = 0;
  if (t.move) {
    const h = t.move.km / t.move.kmh;
    low += h;
    rows.push(['a.', 'Mov / occupation of def', `${h.toFixed(1)} +`, `Mov from ${t.move.from}: ${t.move.km.toFixed(1)} km in a straight line at ${t.move.kmh} km/h by night; the road is longer. Occupation: yours`]);
    basis.push(rule(`March speed: ${t.move.src}`), calc('Straight line from the unit symbol to the MITG: a lower bound'));
  } else rows.push(['a.', 'Mov / occupation of def', '', 'The unit is in the AOR already, or not marked']);
  if (t.prep) {
    low += t.prep.h[0];
    rows.push(['b.', 'Improvement of def posns', `${t.prep.h[0]}-${t.prep.h[1]}`, 'A Coy prepares its posn in this time']);
    basis.push(rule(t.prep.src));
  } else rows.push(['b.', 'Improvement of def posns', '', '']);
  rows.push(['c.', 'Clearance of F of F / imp of OHP', '', '']);
  if (t.mines) {
    const best = [t.mines.handH, t.mines.mechH].filter((x): x is number => x !== null).sort((a, b) => a - b)[0] ?? null;
    if (best !== null) low += best;
    rows.push([
      'd.',
      'Protective M fd laying',
      best === null ? '' : String(best),
      `${km(t.mines.frontM)} km of front by ${t.mines.engr}: by hand ${t.mines.handH ?? '–'} h${t.mines.mechH !== null ? `, with MMLs ${t.mines.mechH} h` : ''} (${t.mines.perPl} mixed clusters a Pl in 24 h)`,
    ]);
    basis.push(rule(`Mine laying: ${t.mines.src}`), data('Front: the FDLs line of the AOR reading'));
  } else rows.push(['d.', 'Protective M fd laying', '', '']);
  rows.push(['e.', 'Wire obs / denial plan', '', ''], ['f.', 'Cam and clt', '', ''], ['g.', 'Coord / unforeseen', '', '']);
  rows.push(['', 'Total time', low ? `${Math.round(low)} +` : '', 'At least, from the rows filled; work in parallel shortens it']);
  patches.push({ id: 'ts.req', draft: '', state: 'judge', table: { head: ['S/No', 'Activity', 'Time (hrs)', 'From'], rows, widths: [0.08, 0.32, 0.14, 0.46] }, basis });
  return { patches, confirm: t.move ? [{ text: 'The move in is a straight line: take the road distance and the column length from the Move Planner.', paras: ['ts.req'] }] : [] };
}

// ── grouping and tasks from a plan ───────────────────────────────────────────────────────────────────────────────

export interface AprcCoyIn {
  label: string;
  /** fwd, depth, res (PlanCheck's posn kinds). */
  kind: string;
  /** "from incl Kot Jaimal to incl Nurpur", "over Kot Jaimal", or null. */
  span: string | null;
  /** Other units inside its posn (ATGM, OPs, attached Pls). */
  units: string[];
  /** Moves the what-if gives it: where to, minutes, in time or not. */
  moves: Array<{ to: string; min: number; inTime: boolean }>;
  /** C attk objs: the fwd posns it is behind, for depth and res. */
  catk: string[];
}

const KIND_ORDER: Record<string, number> = { fwd: 0, depth: 1, res: 2 };

/** Exec, Grouping and Tasks: a sub-paragraph per Coy of the plan, as drawn. */
export function writeCoyTasks(coys: AprcCoyIn[]): AprcWritten {
  const patches: AprcPatch[] = [];
  const list2 = coys.filter((c) => c.kind in KIND_ORDER).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label));
  if (!list2.length) return { patches, confirm: [] };
  const planIn = input('The plan on the map, as checked (Check my plan)');
  const kids = list2.map((c) => {
    const id = `plan.exec.tasks.${slug(c.label)}`;
    const tasks: string[] = [];
    if (c.kind === 'res') tasks.push(`Be in res ${c.span ?? 'as shown on the trace'} by ${AprcRuleText}.`);
    else tasks.push(`Take up def posn ${c.span ?? 'as shown on the trace'} by ${AprcRuleText}.`);
    if ((c.kind === 'depth' || c.kind === 'res') && c.catk.length) tasks.push(`Be prep to launch C attk on ${list(c.catk, 'or')} on orders.`);
    for (const m of c.moves) tasks.push(`Be prep to occupy ${m.to} on orders (${Math.round(m.min)} min: ${m.inTime ? 'in time' : 'not in time on the what-if'}).`);
    return para(id, c.label, {
      draft: '',
      state: 'map',
      children: [
        para(`${id}.grp`, 'Grouping', c.units.length ? { draft: `In loc: ${list(c.units)}.`, state: 'map', basis: [planIn] } : { prompts: ['Under comd, in sp, in loc'] }),
        para(`${id}.tasks`, 'Tasks', {
          draft: '',
          state: 'map',
          children: tasks.map((t, i) => para(`${id}.t${i + 1}`, null, { draft: t, state: i === 0 ? 'map' : 'judge', basis: i === 0 ? [planIn, data('Ends of the posn: the nearest named places, the 1:50k map')] : [planIn, calc('Depth and res: C attk onto the fwd posns; moves from the what-if, timed against his lead element')] })),
        }),
      ],
    });
  });
  patches.push({ id: 'plan.exec.tasks', draft: '', state: 'map', children: kids, basis: [planIn] });
  return { patches, confirm: [] };
}
const AprcRuleText = '________';
