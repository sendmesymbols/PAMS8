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
import { DP_HEADS, para, slug, type AprcBasis, type AprcConfirm, type AprcFrame, type AprcPara, type AprcPatch, type AprcTable } from './AprcModel';

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
  /** True when the threat is a place the user marked. */
  threatMarked: boolean;
  readAt: string;
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

export function writeSymbols(symbols: AprcSymbolIn[]): AprcWritten & { drawnObs: string[]; enForce: string | null } {
  const patches: AprcPatch[] = [];
  const en = symbols.filter((s) => s.side === 'enemy' && isUnit(s));
  const own = symbols.filter((s) => s.side === 'own' && isUnit(s));
  const mapIn = input('Symbols on the map, as drawn');
  if (en.length) {
    patches.push({ id: 'rev.en', draft: `Marked on the map: ${forceLine(en)}.`, state: 'map', basis: [mapIn], prompts: ['Add his likely aim and timings'] });
    patches.push({ id: 'en.comp', draft: `${forceLine(en)}. ${where(en)}.`, state: 'map', basis: [mapIn] });
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
  return { patches, confirm: en.length ? [] : [{ text: 'No en symbols on the map: his strength and start points are not known to the reading.', paras: ['rev.en', 'en.comp', 'own.str'] }], drawnObs, enForce: en.length ? forceLine(en) : null };
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
}

export const hplus = (h: number): string => {
  const m = Math.round(Math.abs(h) * 60);
  return `H${h < 0 ? '-' : '+'}${Math.floor(m / 60)}${m % 60 ? `:${String(m % 60).padStart(2, '0')}` : ''}`;
};
const span = (t: [number, number]): string => (Math.abs(t[1] - t[0]) < 0.05 ? hplus(t[0]) : `${hplus(t[0])} to ${hplus(t[1])}`);

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
  const who = e.force ?? 'The en (strength not marked)';
  const optText = (a: AprcAvenueIn): string =>
    `${who} along ${a.id}${a.onto ? ` (${a.onto})` : ''}: ${km(a.lengthM)} km, GO on ${pct(a.goPct)}, narrowest ${km(a.minWidthM)} km${a.through.length ? `, through ${list(a.through.slice(0, 6))}` : ''}. ` +
    `His lead element reaches the avenue at ${span(a.startH)} and ${e.objective} at ${span(a.endH)}.`;
  const tpl = e.template;
  // The template's phase names only: their timings are long and belong to the template, not the paragraph.
  const phaseNames = tpl ? [...new Set(tpl.phases.map((p) => p.phase.trim()).filter(Boolean))].slice(0, 6) : [];
  const tplLine = tpl && phaseNames.length ? ` Doctrinal template "${tpl.label}"${tpl.confirmed ? '' : ' (a reading still to confirm)'}: phases ${list(phaseNames)}.` : '';

  const a1 = av[0];
  const w1 = weigh(a1, av.slice(0, 2), e.mcWidthM);
  patches.push({ id: 'en.opt1.what', draft: `${optText(a1)}${tplLine}`, state: 'judge', basis: [avIn, rateRule, how, ...(tpl ? [data(`Template: ${tpl.src}`)] : [])] });
  if (w1.adv.length) patches.push({ id: 'en.opt1.adv', draft: `${cap1(w1.adv.join('; '))}.`, state: 'judge', basis: [cmp] });
  if (w1.dis.length) patches.push({ id: 'en.opt1.dis', draft: `${cap1(w1.dis.join('; '))}.`, state: 'judge', basis: [cmp] });
  // Options 1 and 2 are the two best-ranked avenues, compared with each other.
  const opts = av.slice(0, 2);
  if (av[1]) {
    const w2 = weigh(av[1], opts, e.mcWidthM);
    patches.push({ id: 'en.opt2', draft: `${optText(av[1])}${w2.adv.length ? ` Advs: ${w2.adv.join('; ')}.` : ''}${w2.dis.length ? ` Disadvs: ${w2.dis.join('; ')}.` : ''}`, state: 'judge', basis: [avIn, rateRule, how, cmp] });
    const fastest = [...opts].sort((a, b) => a.endH[0] - b.endH[0])[0];
    if (Math.abs(opts[0].endH[0] - opts[1].endH[0]) >= WEIGH_MIN.hours) patches.push({ id: 'en.danger', draft: `Along ${fastest.id}: he is onto ${e.objective} earliest, at ${hplus(fastest.endH[0])}.`, state: 'judge', basis: [how, calc('Most dangerous taken as the earliest onto the objective; a proposal')] });
  }

  // His reactions against own counter actions: the TAIs and the decisions before them.
  const rows: string[][] = [];
  for (const t of [...e.tais].sort((a, b) => a.earliestH - b.earliestH)) {
    const dp = e.dps.find((d) => d.tai === t.id);
    rows.push([
      '',
      `His lead element at ${t.id} on ${t.aa} (${t.why}): ${span([t.earliestH, t.latestH])}.`,
      dp ? `${dp.id}: ${dp.decision.replace(/[.?]\s*$/, '')}${dp.beforeH ? ' (before H)' : ` by ${hplus(dp.earliestH)}`}.` : 'Engage him there with the fire planned on it.',
    ]);
  }
  for (const d of e.dps.filter((x) => x.kind === 'catk')) rows.push(['', `He is onto the depth localities on ${d.aa}.`, `${d.id}: ${d.decision} by ${hplus(d.earliestH)}.`]);
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
export function writeTasks(r: AorReading): AprcWritten {
  const patches: AprcPatch[] = [];
  const fdl = r.lines.find((l) => l.role === 'FDLs');
  const depth = r.lines.find((l) => l.role === 'Depth');
  const screen = r.lines.find((l) => l.role === 'Screen');
  if (!fdl) return { patches, confirm: [] };
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
  return { patches, confirm: [] };
}
