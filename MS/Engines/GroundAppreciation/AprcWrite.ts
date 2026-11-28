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
import { APCH_HEADS_ATTK, BACKWARD_EVENTS, DP_HEADS, ITG_HEADS_ATTK, MA, TASK_HEAD_ATTK, para, slug, taskRowsAttk, uniqueId, type AprcBasis, type AprcConfirm, type AprcFrame, type AprcPara, type AprcPatch, type AprcTable } from './AprcModel';
import { GUN_DEPL, GUN_DEPL_TEXT } from './AprcBooks';

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

/** The zone the times are in, in words: "UTC+5, PKT" for Pakistan Standard Time, else the offset alone. */
export const zoneWord = (h: number): string => `UTC${h >= 0 ? '+' : ''}${h}${h === 5 ? ', PKT' : ''}`;

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
  /** Read at this many points along the apch (`seenPct` their mean), with the spread and where it was least. */
  points?: number;
  minSeenPct?: number;
  maxSeenPct?: number;
  worstNear?: string | null;
}

/** "about 41 % (28-55 % at 3 points; least near X)": the share seen, with its spread when read at more than one point. */
const seenWords = (ob: AprcObsn): string =>
  `about ${pct(ob.seenPct)}${(ob.points ?? 1) > 1 && ob.minSeenPct !== undefined && ob.maxSeenPct !== undefined ? ` (${Math.round(ob.minSeenPct)}-${pct(ob.maxSeenPct)} at ${ob.points} points${ob.worstNear ? `; least near ${ob.worstNear}` : ''})` : ''}`;
const obsnCalc = (ob: AprcObsn | null): AprcBasis =>
  calc((ob?.points ?? 1) > 1 ? `Read at ${ob!.points} points along the home side of the apch: the share seen is their mean, the clear distance their median; a chance` : 'Read at one point on the apch; the share seen is a chance');

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
  wx?: { marginal: string[]; unfavourable: string[]; mtn?: { elevM: number | null; notes: string[] } | null } | null;
  light?: AprcLight | null;
  /** Obstacle symbols drawn on the map, in words ("Minefield 1.2 km N of X"). */
  drawnObs?: string[];
  /** True when the threat is a place the user marked (the attack: the own start is known). */
  threatMarked: boolean;
  /** The threat marker in words ("the Threat marker, 6.2 km N of Qila Mor"), when the host gives one. */
  threatWords?: string | null;
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

/**
 * Lines of def from the front: by their depth behind the front (the line through the MITG, which has none, last), then
 * by letter; as many as the AOR reading gives.
 */
export function frontFirst(ls: AorDefLine[]): AorDefLine[] {
  return [...ls].sort((a, b) => (a.depthM ?? Infinity) - (b.depthM ?? Infinity) || String(a.id).localeCompare(String(b.id)));
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
  const confirm: AprcConfirm[] = w.confirm.map((text) => ({ text: text.replace(/\bNCGDB\b/g, '1:50k map'), paras: ['gr.apchs'] }));
  const goingData = data(`Going: the terrain classes at 30 m (land cover with the 1:50k map's canals, rivers, BUAs) read for ${mover}, ${season}`);
  const featData = data('Rds, canals, rivers, bridges and places: the 1:50k map');
  const frameIn = input(`AOR: ${AOR_WORD[f.used] ?? f.used}${f.note ? ` (${f.note})` : ''}; MITG ${mitg}; threat ${g.threatWords ?? (g.threatMarked ? 'marked on the map' : 'assumed forward of the AOR')}`);

  // 5. Gen Description
  {
    const rel = r.reliefM ?? null;
    const s: string[] = [`${r.country}${rel !== null ? `: the ground within 5 km of ${mitg} rises ${rel} m` : ''}.`];
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
    const countryCalc = calc(
      'Country from the AOR\'s classes: mountains where slope classes pass 15 % and the ground within 5 km rises 400 m or more (IpbTemplates mountainTest, E); on lower ground the slopes are dune faces (DW pp 2-3) or broken ground and the other classes decide; desert over 30 %; else riverine, built-up, canal plains or plains' +
        (rel !== null ? '; the rise from the 30 m elevation' : '; no elevation read, the classes alone'),
    );
    patches.push({ id: 'gr.gen', draft: s.join(' '), state: 'gr', basis: [goingData, featData, data('People: the population grid (an estimate, not a census)'), countryCalc, frameIn] });
  }

  // 6. Apchs
  {
    const kids: AprcPara[] = bySide.map((a) => {
      const rows = aorSheetRows(r, a);
      const ob = g.obsn?.[a.side] ?? null;
      const obText = ob
        ? `Gr obsn: ${seenWords(ob)} of the ground within ${km(ob.radiusM)} km is in view from ${(ob.points ?? 1) > 1 ? 'points along it' : `a point on it${ob.near ? ` near ${ob.near}` : ''}`}; clear to ${Math.round(ob.clearMedianM / 10) * 10} m before the first dead or screened ground (median of all dirs); ${COUNTRY_WORD[ob.country] ?? ob.country}.${ob.overlook ? ` Overlooked from ground ${Math.round(ob.overlook.riseM)} m higher, ${km(ob.overlook.distM)} km ${ob.overlook.compass}.` : ''} A chance, not a fact.`
        : null;
      const id = `gr.apch.${a.side.toLowerCase()}`;
      return para(id, `${a.side} Apch`, {
        draft: '',
        state: 'gr',
        children: rows.map(([h, t]) => {
          const text = h === 'Obsn' ? obText : t === null ? null : cap1(t);
          const basis: AprcBasis[] =
            h === 'Capacity' ? [goingData, input(`Corridor taken for the threat: ${km(r.corridorM)} km`), calc('The narrowest ground between NO-GO areas along the apch; canals and streams are crossings, not narrowings')]
            : h === 'Obsn' ? [data('Sight: the 30 m elevation with building density, crops by month, trees and bunds (the Extended View)'), obsnCalc(ob)]
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
    const used = new Set<string>(['gr.itg.mitg', 'gr.itg.more']);
    for (const l of r.lines) {
      if (l.role !== 'FDLs' && l.role !== 'Depth') continue;
      for (const b of l.buas) {
        if (!b || seen.has(b)) continue;
        seen.add(b);
        kids.push(para(uniqueId(used, `gr.itg.${slug(b)}`), b, { draft: `Astride an apch on Line ${l.id}.`, state: 'judge', basis: [featData, calc('A BUA within 800 m of an apch where a line of def cuts it')] }));
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
    // on mountain ground: Mountain Warfare's weather notes for the month and the area's height (the Ground Guide's Annex A)
    if (g.wx?.mtn?.notes.length) s.push(`Mountains${g.wx.mtn.elevM != null ? ` (about ${g.wx.mtn.elevM} m)` : ''}: ${g.wx.mtn.notes.join(' ')}`);
    if (g.wx && (g.wx.marginal.length || g.wx.unfavourable.length)) s.push(`Against the IPB weather values: ${[g.wx.unfavourable.length ? `unfavourable for ${list(g.wx.unfavourable)}` : '', g.wx.marginal.length ? `marginal for ${list(g.wx.marginal)}` : ''].filter(Boolean).join('; ')}.`);
    const lt = g.light;
    if (lt) s.push(`On ${lt.date}: first lt ${lt.firstLight ?? 'none'}, last lt ${lt.lastLight ?? 'none'} hrs (${zoneWord(lt.utcOffsetH)}); moon ${lt.moonPct} % lit.`);
    s.push(`Going read ${season}.`);
    const basis: AprcBasis[] = [];
    if (wx) basis.push(data(`Climate: ${wx.source}${wx.dataDate ? ` (${wx.dataDate})` : ''}, the mean for the month, not a forecast`));
    if (v) basis.push(data('Visibility: the monthly station grid'));
    if (lt) basis.push(calc(`First and last light: the sun 6 degrees below the horizon, worked out from date and place; times in ${zoneWord(lt.utcOffsetH)} (groundAppreciation.utcOffsetH), not the computer's zone`));
    if (g.wx && (g.wx.marginal.length || g.wx.unfavourable.length)) basis.push(rule('Weather critical values: IPB book Annex A pp 19-20'));
    if (g.wx?.mtn?.notes.length) basis.push(rule('Mountain weather: Mountain Warfare (GSP-1973) pp 9-10, 69-71, 229-230, 288-289, 298, by the month and the height of the area'));
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
    const linesOrd = frontFirst(r.lines);
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
    // DP 2: the def stepped back, its FDLs on the depth line, the line DP 1 holds as the FDLs a screen in front of it
    const deeper = depth ? frontFirst(r.lines).filter((l) => l !== depth && l.role !== 'Str Pt' && l.depthM !== null && depth.depthM !== null && l.depthM > depth.depthM) : [];
    patches.push(
      depth
        ? {
            id: 'gr.ded.dp2',
            draft: `FDLs on Line ${depth.id} (${depth.name}, ${km(depth.frontM)} km between bdys${depth.obstacle ? `, along ${depth.obstacle}` : ''})${fdl ? `; Line ${fdl.id} (${fdl.name}) held by a screen in front` : ''}; ${deeper.length ? `depth on Line ${deeper[0].id} (${deeper[0].name})` : `the Str Pt ${mitg}`}. Weigh it against DP 1: more depth to the En first fight, less ground forward.`,
            state: 'judge',
            basis: [featData, calc('The second def possibility: the def stepped back to the depth line of the AOR reading, the FDLs line of DP 1 a screen; a proposal to compare with DP 1')],
          }
        : { id: 'gr.ded.dp2', draft: null, state: 'yours', basis: [], prompts: ['No depth line was read: write the second possibility'] },
    );
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
      threat: g.threatWords ?? (g.threatMarked ? 'marked on the map' : 'assumed forward of the AOR'),
      readAt: g.readAt,
    },
  };
}

// ── the withdrawal: its Gr deductions (OoW Vol III) ──────────────────────────────────────────────────────────────

/**
 * The withdrawal's Gr from the AOR reading taken round the new def posn (the MITG), facing the En: the routes back (the
 * MSR, the Rd through the posn, the laterals, the Rds along the apchs; OoW Vol III p 8 para 5a), the new posn's lines read
 * there (p 39 para 1), the lines forward of its FDLs as candidate intmed posns, those on an obs first (p 33 para 16), the
 * routes to keep open and to block (p 8 para 5a; p 56 para 5) and the brs on the En apchs (p 14 para 11). Writes the
 * withdrawal's own paragraphs only; `writeGround` drafts the shared ones (Gen Description, Apchs, Obs, Cover, Weather).
 */
export function writeGroundWdr(r: AorReading): AprcWritten {
  const patches: AprcPatch[] = [];
  const confirm: AprcConfirm[] = [];
  const named = !!r.mitg.name && r.mitg.name !== 'MITG';
  const mitg = named ? r.mitg.name : 'the MITG';
  const featData = data('Rds, canals, rivers, bridges and places: the 1:50k map');
  const frameIn = input('MITG: the new def posn (a VG symbol, else the selected symbol, else the map centre); the AOR faces the threat, its Gr forward of the posn the Gr the wdr crosses');

  // Routes back
  {
    const s: string[] = [];
    if (r.msr) s.push(`MSR: ${aorName(r.msr.name)}${r.msr.cls ? ` ${r.msr.cls}` : ''}, ${km(r.msr.distM)} km from ${mitg}.`);
    if (r.thruRoad) s.push(`Rd ${aorName(r.thruRoad.name)}${r.thruRoad.cls ? ` ${r.thruRoad.cls}` : ''} runs through ${mitg}.`);
    const along = SIDES.map((sd) => r.apchs.find((a) => a.side === sd)).filter((a): a is AorApproach => !!a && a.roadsAlong.length > 0);
    if (along.length) s.push(`Rds along the apchs: ${along.map((a) => `${a.side} (${a.roadsAlong.map((x) => aorName(x.name)).join(', ')})`).join('; ')}.`);
    const lats = r.laterals.filter((l) => l.n > 0);
    s.push(lats.length ? `Laterals: ${lats.map((l) => `the ${l.a} and ${l.b} apchs joined by ${plural(l.n, 'metalled Rd')}`).join('; ')}.` : 'No metalled lateral joins the apchs in the AOR.');
    patches.push({ id: 'gr.routes', draft: s.join(' '), state: 'gr', basis: [featData, calc('Metalled Rds along each apch and joining two apchs inside the AOR; the MSR nearest the MITG'), frameIn] });
  }

  // the new posn read at the MITG
  const fdl = r.lines.find((l) => l.role === 'FDLs') ?? null;
  const depth = r.lines.find((l) => l.role === 'Depth') ?? null;
  if (fdl)
    patches.push({
      id: 'gr.ded.newposn',
      draft: `Read at ${mitg}: FDLs on Line ${fdl.id} (${fdl.name}, ${km(fdl.frontM)} km between bdys${fdl.obstacle ? `, along ${fdl.obstacle}` : ''})${depth ? `, depth on Line ${depth.id} (${depth.name})` : ''}. Weigh it against the posn the higher comd lays down.`,
      state: 'judge',
      basis: [featData, calc('The AOR reading\'s lines of def round the MITG, their roles from the front'), rule('The new posn normally laid down by the higher comd; its selection, org and layout as in OoW Vol I (OoW Vol III p 39 para 1)'), frameIn],
    });

  // intmed posns: the lines forward of the new FDLs, those on an obs first
  {
    const fwd = frontFirst(r.lines).filter((l) => l.role !== 'Str Pt' && l !== fdl && l !== depth && (!fdl || fdl.depthM === null || (l.depthM !== null && l.depthM < fdl.depthM)));
    if (fwd.length) {
      const ahead = (l: AorDefLine): string => (fdl && fdl.depthM !== null && l.depthM !== null ? `, ${km(fdl.depthM - l.depthM)} km ahead of Line ${fdl.id}` : '');
      const onObs = fwd.filter((l) => l.obstacle);
      const gaps: string[] = [];
      const chain = fdl ? [...fwd, fdl] : fwd;
      for (let i = 0; i + 1 < chain.length; i++) if (chain[i].depthM !== null && chain[i + 1].depthM !== null) gaps.push(`${chain[i].id} to ${chain[i + 1].id} ${km(chain[i + 1].depthM! - chain[i].depthM!)} km`);
      patches.push({
        id: 'gr.ded.intmed',
        draft: `Lines across the En apchs forward of the new posn, from the front: ${fwd.map((l) => `Line ${l.id} (${l.name}${l.obstacle ? `, along ${l.obstacle}` : ', no obs'}${ahead(l)})`).join('; ')}. As intmed posns or the covering tps' delay lines, ${onObs.length ? `those on an obs first: ${list(onObs.map((l) => `Line ${l.id}`))}` : 'none rests on an obs: weigh the high Gr'}.${gaps.length ? ` Apart: ${gaps.join(', ')}; far enough that the En must redeploy before the next (no figure printed: judge on the Gr).` : ''}`,
        state: 'judge',
        basis: [featData, calc('The AOR reading\'s lines of def (cuts across the apchs scored on the BUAs astride them, a water line or ridge along the cut, a lateral Rd behind) forward of the FDLs line'), rule('Intmed posns: naturally strong, held with the min of tps; rivers, canals, unfordable streams, marshes and other obs in front; so far apart that the En must redeploy (OoW Vol III p 33 para 16)')],
      });
    }
  }

  // routes to keep open and to block
  {
    const bySide = SIDES.map((sd) => r.apchs.find((a) => a.side === sd)).filter((a): a is AorApproach => !!a);
    const open = bySide.filter((a) => a.roadsAlong.length).map((a) => a.side);
    const block = bySide.filter((a) => !a.roadsAlong.length).map((a) => a.side);
    const water = new Map<string, string>();
    for (const a of bySide) for (const o of a.obstacles) if (!water.has(o.name)) water.set(o.name, o.type);
    if (bySide.length)
      patches.push({
        id: 'gr.ded.routes',
        draft: `${open.length ? `Keep open for the wdr until the rear parties are through: the ${list(open)} ${open.length > 1 ? 'apchs' : 'apch'} (a Rd along it); reserve dmls on the brs they cross. ` : ''}${block.length ? `Block early: the ${list(block)} ${block.length > 1 ? 'apchs' : 'apch'} (no Rd: cross-country, the En outflanking ways). ` : ''}${water.size ? `A primary dml belt continuous across the front on the water line nearest the new posn: ${list([...water].map(([n, t]) => `${n} (${t})`))}.` : 'No water line across the apchs for a dml belt: M fds and ditches in its place.'}`,
        state: 'judge',
        basis: [featData, calc('An apch with a Rd along it is the wdr\'s route, kept open; one without is blocked first: a working assumption, yours to judge'), rule('Which routes to block and which to keep open (OoW Vol III p 8 para 5a); reserve dmls kept open to tfc till fired (p 55 para 3); primary dml belts continuous across the front as part of the new def posn, gaps filled with mines or ditches (p 56 para 5a)')],
      });
  }

  // brs on the En apchs
  {
    const s: string[] = [r.dml.length ? `Brs over water on the En apchs: ${r.dml.map((d) => `over ${d.water} on the ${d.side} apch, ${Math.round(d.bridgeM)} m off its crossing`).join('; ')}.` : 'No br over water on the En apchs in the AOR.'];
    if (r.bridges.inAor) s.push(`${cap1(plural(r.bridges.inAor, 'br'))} in the AOR, ${r.bridges.classed} with a load class recorded.`);
    patches.push({ id: 'sp.dml', draft: s.join(' '), state: 'gr', basis: [featData, calc('The br nearest each apch\'s water crossing, within 1 km')] });
    confirm.push({ text: 'Dml sites: selected with Engr advice, the min essential; reserve dmls with gds and firing parties (OoW Vol III pp 55-56).', paras: ['sp.dml'] });
  }
  return { patches, confirm };
}

// ── the attack: Gr and Weather ───────────────────────────────────────────────────────────────────────────────────

/** The reading's sides are the en's (as he faces the attack): the attacker's Lt is his Rt. */
const MIRROR: Record<AorSide, AorSide> = { Lt: 'Rt', Cen: 'Cen', Rt: 'Lt' };
const mirrorText = (s: string | null | undefined): string | null => (s === null || s === undefined ? null : s.replace(/\b(Lt|Rt)\b/g, (m) => (m === 'Lt' ? 'Rt' : 'Lt')));
const OBS_WORD = (ob: AprcObsn, toward: string): string =>
  `${seenWords(ob)} of the ground within ${km(ob.radiusM)} km is in view${toward}; clear to ${Math.round(ob.clearMedianM / 10) * 10} m before the first dead or screened ground (median of all dirs); ${COUNTRY_WORD[ob.country] ?? ob.country}.`;

/** Capacity of an apch for the attacker: the book's Bde figure, the IPB corridor widths below it. */
/**
 * The capacity of an apch by the IPB book's mobility corridor widths (a pamphlet: it drives, user 24 Nov 2026); the two
 * Aprc guides' figures shown beside it (a Bde ~4 km, Mechs of Aprc (Attk) p 2; Bn 2.3 km, Bde 3.2 km, Div 6 km,
 * Understanding Aprc p 18).
 */
function capacityAttk(a: AorApproach): { text: string; basis: AprcBasis[] } {
  const w = a.minWidthM;
  const wide = w >= 20000 ? 'No NO-GO area narrows it' : `No narrower than ${km(w)} km between NO-GO areas`;
  const who = w >= 6000 ? 'a Div size force' : w >= 3000 ? 'a Bde size force' : w >= 1500 ? 'a Bn size force' : w >= 500 ? 'a Coy size force' : null;
  return {
    text: `${wide}: ${who ? `room for ${who}` : 'less than the 500 m a Coy moves on'}${a.obstacles.length ? `; water crossed at ${plural(a.obstacles.length, 'point')}` : ''}.`,
    basis: [
      rule('Mobility corridor widths: a Coy 500 m, a Bn 1.5 km, a Bde 3 km, a Div 6 km (IPB book p 7)'),
      rule('Beside it, the Aprc guides: a Bde size force takes approx 4 km (Mechs of Aprc (Attk) p 2); the room a flanking FUP wants, Bn 2.3 km, Bde 3.2 km, Div 6 km (Understanding Aprc p 18)'),
      calc('The narrowest ground between NO-GO areas along the apch; canals and streams are crossings, not narrowings'),
    ],
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
        if (h === 'Obsn and F of F') return ob ? `Gr obsn: ${OBS_WORD(ob, (ob.points ?? 1) > 1 ? ' from points along it' : ` from a point on it${ob.near ? ` near ${ob.near}` : ''}`)}${ob.overlook ? ` Overlooked from ground ${Math.round(ob.overlook.riseM)} m higher, ${km(ob.overlook.distM)} km ${ob.overlook.compass}.` : ''} A chance, not a fact.` : null;
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
            : h === 'Obsn and F of F' ? [data('Sight: the 30 m elevation with building density, crops by month, trees and bunds (the Extended View)'), obsnCalc(ob)]
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
    const used = new Set<string>(['gr.itg.mitg', 'gr.itg.more']);
    for (const role of ['FDLs', 'Depth'] as const) {
      const l = r.lines.find((x) => x.role === role);
      if (!l) continue;
      l.buas.forEach((b, i) => {
        if (!b || seen.has(b)) return;
        seen.add(b);
        const side = l.buas.length === 3 ? sideOf(SIDES[i]) : null;
        others.push({ name: b, line: l, side });
        kids.push(para(uniqueId(used, `gr.itg.${slug(b)}`), b, { draft: `Astride the ${side ? `${side} ` : ''}apch on Line ${l.id}, the En likely ${role === 'FDLs' ? 'FDLs' : 'depth'} facing the attk.`, state: 'judge', basis: [featData, calc('A BUA within 800 m of an apch where a line across the apchs cuts it; the lines are the ones a defender of the MITG would hold')] }));
      });
    }
    if (r.map.itg.length) kids.push(para('gr.itg.more', null, { draft: `${cap1(plural(r.map.itg.length, 'more candidate'))} in the area from the data (high ground, crossings, junctions): shown on the trace.`, state: 'judge', basis: [data('ITG candidates: the bundle features flagged as important ground')] }));
    patches.push({ id: 'gr.itg', draft: '', state: 'gr', children: kids });
    confirm.push({ text: `The En localities and the ITGs are read from the ground: confirm them against the En disposns (recce, int) before the APs are settled.`, paras: ['gr.itg', 'gr.ded.obj'] });
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
      basis: [featData, calc('The MITG first, then the En localities on the line nearest the attk, then in depth; a proposal'), frameIn],
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
    const front = frontFirst(r.lines.filter((l) => l.role === 'FDLs' || l.role === 'Depth'));
    if (front.length) patches.push({
      id: 'gr.ded.c.phases',
      draft: `${front.map((l, i) => `Phase ${i + 1}: the En's ${l.role === 'FDLs' ? 'FDLs' : 'depth'} on Line ${l.id} (${[...new Set(l.buas.filter((x): x is string => !!x))].join(', ') || l.name})`).join('; ')}; then ${mitg}. Lines ${front.map((l) => l.id).join(' and ')} lie ${front.map((l) => (l.depthM !== null ? `${km(l.depthM)} km` : '?')).join(' and ')} past ${border ? `the ${border}` : 'the front of the area read'}.`,
      state: 'judge',
      basis: [featData, calc('The lines across the apchs that a defender of the MITG would hold: each a phase if held; a proposal, the En disposns decide')],
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
  /** The AOR's country ('Mountains', 'Desert' ...): the FUP and the dir of attk by the ground's own book. */
  country?: string | null;
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

/**
 * The apchs onto the obj in pri (turning and flanking before frontal, the user's rule) and the one AP-1 takes: the turning
 * apch when it ranks first, else the flank the Lt / Rt weighing favours. Null when no apch comes onto the obj.
 */
export function attkFirst(e: AprcAttkIn): { order: AprcAttkAvenue[]; first: AprcAttkAvenue; weigh: { text: string; lt: number; rt: number } | null } | null {
  const onto = e.avenues.filter((a) => a.onto);
  if (!onto.length) return null;
  const order = [...onto].sort((a, b) => (a.onto === 'frontal' ? 1 : 0) - (b.onto === 'frontal' ? 1 : 0) || a.rank - b.rank);
  const lt = onto.find((a) => a.onto === 'left'), rt = onto.find((a) => a.onto === 'right');
  const w = lt && rt ? lrWeigh(lt, rt) : null;
  const best = order[0];
  const first = best.onto === 'turn' || best.onto === 'frontal' ? best : w && w.lt !== w.rt ? (w.lt > w.rt ? lt! : rt!) : best;
  return { order, first, weigh: w };
}

/** Pri of Apchs / Dir of Attk, the Best Dir of Attk on the MITG, AP-1 and AP-2, the FUP and the blocking posn. */
export function writeAttkDir(e: AprcAttkIn): AprcWritten {
  const patches: AprcPatch[] = [];
  const confirm: AprcConfirm[] = [];
  const onto = e.avenues.filter((a) => a.onto);
  if (!onto.length) return { patches, confirm };
  // the user's rule (22 Nov 2026 memory: frontal attk dangerous): the turning and flanking apchs first, frontal last
  const order = attkFirst(e)!.order;
  const avIn = data(`The IPB reading: apchs for ${e.aaFor} onto ${e.objective} from ${e.start}${e.startAssumed ? ' (taken)' : ''}, corridors ${km(e.mcWidthM)} km wide, coded GO / SLOW-GO / NO-GO by the book's criteria (${e.mover})`);
  const mtn = e.country === 'Mountains', des = e.country === 'Desert';
  const flankRule = rule(
    `Flanking before frontal: a frontal attk has a small chance (user's rule); "being flanking in nature" (Mechs of Aprc (Attk) pp 3-4)` +
      (mtn ? '; in mountains frontal attks against well prep, dominating posns have little chance, attk along the gradient, ridges and spurs; the objs the hill features on either flk of the main axis and in his rear that dominate his defs (MW pp 78-79)' : '') +
      (des ? '; in desert the attk seeks his flks and LOC, its dir chosen by the tk going (DW pp 34, 38); envelopment the most common mnvr there (OoW Vol II p 68)' : ''),
  );
  const turnRule = rule('A turning apch round the obj onto a choke on the En MSR blocks the En wdr and rft (OoW Vol II s6; IBB S35 p 140); Aim limitation b (Mechs of Aprc (Attk) p 1)');
  const fupRule = rule(
    mtn
      ? `FUP ${km(e.fupM)} km short of the obj: in mountains no classic FUP: the tps do not form up in extended lines, they cross a designated place at H (MW p 85); with NVDs the forming up is done outside the eff range of MGs and behind cover (MW p 228); in the plains 1000-1200 m, less in broken gr (IBB pp 201, 203)`
      : `FUP ${km(e.fupM)} km short of the obj: 1000-1200 m, out of the En NVD and SA reach (IBB p 201)`,
  );
  const one = (a: AprcAttkAvenue): string =>
    `${ONTO_WORD[a.onto ?? ''] ?? a.label}: ${km(a.lengthM)} km, GO on ${pct(a.goPct)}, narrowest ${km(a.minWidthM)} km, ${a.waterLines ? plural(a.waterLines, 'water line') : 'no water line'}${a.assaultM !== null ? `; the assault ${km(a.assaultM)} km from the FUP${a.assaultNogoPct ? ` (${pct(a.assaultNogoPct)} NO-GO)` : ''}` : ''}`;
  const lt = onto.find((a) => a.onto === 'left'), rt = onto.find((a) => a.onto === 'right');
  const w = lt && rt ? lrWeigh(lt, rt) : null;
  const turnText = e.turn ? ` The turning apch blocks ${e.turn.msr ? 'the En MSR' : 'the main Rd behind the En'} at ${e.turn.label} (${e.turn.kind}), ${km(e.turn.behindM)} km behind ${e.objective}.` : '';
  patches.push({
    id: 'gr.ded.apch',
    draft: `Dir of attk in pri: ${order.map((a, i) => `(${i + 1}) ${one(a)}`).join('; ')}.${w ? ` Lt against Rt: ${w.text}${w.lt !== w.rt ? ` Better on ${Math.max(w.lt, w.rt)} of ${w.lt + w.rt} heads: the ${w.lt > w.rt ? 'Lt' : 'Rt'}.` : ''}` : ''}${turnText}`,
    state: 'judge',
    basis: [avIn, flankRule, ...(e.turn ? [turnRule] : []), calc(`Lt against Rt: a head counts only past its smallest real difference (length ${LT_RT_MIN.lengthPct} %, GO ${LT_RT_MIN.goPct} %, NO-GO on the assault ${LT_RT_MIN.nogoPct} %; a method setting); the weighing is the planner's`)],
  });
  // the flank the weighing favours, when the turning apch is not the first
  const firstFlank = attkFirst(e)!.first;
  patches.push({ id: 'gr.itg.mitg.dir', draft: `${cap1(ONTO_WORD[firstFlank.onto ?? ''] ?? firstFlank.label)}${firstFlank.onto === 'turn' ? '' : ` onto ${e.objective}`}.`, state: 'judge', basis: [avIn, flankRule] });
  patches.push({ id: 'gr.ded.ap1', draft: `To attk ${firstFlank.onto === 'turn' ? 'by the turning apch' : `from the ${ONTO_WORD[firstFlank.onto ?? ''] ?? firstFlank.label}`} onto ${e.objective}${e.turn && firstFlank.onto !== 'turn' ? `, with a blocking posn on the En's ${e.turn.msr ? 'MSR' : 'Rd'} behind it` : ''}.`, state: 'judge', basis: [avIn, flankRule] });
  if (firstFlank.fupWhere) patches.push({ id: 'gr.ded.ap1.fup', draft: `${firstFlank.fupWhere}, ${km(e.fupM)} km short of ${e.objective} on the ${ONTO_WORD[firstFlank.onto ?? ''] ?? firstFlank.label} apch.`, state: 'judge', basis: [avIn, fupRule] });
  if (e.turn) patches.push({ id: 'gr.ded.ap1.block', draft: `At ${e.turn.label}${e.turn.where ? ` (${e.turn.where})` : ''}: a ${e.turn.kind} on ${e.turn.msr ? 'the En MSR' : 'the main Rd'}, ${km(e.turn.behindM)} km behind ${e.objective}; it blocks the En wdr and rft.`, state: 'judge', basis: [avIn, turnRule] });
  const second = order.find((a) => a !== firstFlank && a.onto !== 'frontal') ?? order.find((a) => a !== firstFlank);
  if (second) patches.push({ id: 'gr.ded.ap2', draft: `From the ${ONTO_WORD[second.onto ?? ''] ?? second.label}: changes the dir of attk${second.fupWhere ? `; FUP ${second.fupWhere}` : ''}.`, state: 'judge', basis: [avIn] });
  confirm.push({ text: `The dir of attk rests on the ground read${e.startAssumed ? ' from a start taken opposite the threat' : ''}: walk the FUP and the assault ground, and confirm the En posns on the obj.`, paras: ['gr.ded.apch', 'gr.ded.ap1'] });
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
  /** A HQ (2525D HQ / TF / dummy amplifier 2 or 6; a dummy HQ is not one). */
  hq?: boolean;
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

export function writeSymbols(symbols: AprcSymbolIn[], o: { attack?: boolean } = {}): AprcWritten & { drawnObs: string[]; enForce: string | null; ownWhere: string | null } {
  const patches: AprcPatch[] = [];
  // HQ as marked: Comd and Sig (the attack: Loc of HQ)
  const hqs = symbols.filter((s) => s.side === 'own' && s.hq);
  if (hqs.length)
    patches.push({
      id: o.attack ? 'plan.comd.hq' : 'plan.comd',
      draft: `${o.attack ? '' : 'HQ as marked: '}${hqs.slice(0, 6).map((u) => `${u.label || u.name}${u.ech && ECH[u.ech] ? ` (${ECH[u.ech]} HQ)` : ' (HQ)'}${u.where ? ` ${u.where}` : ''}`).join('; ')}.`,
      state: 'map',
      basis: [input('HQ symbols on the map, as drawn')],
      ...(o.attack ? {} : { prompts: ['Sigs: comms, wrls silence, code words'] }),
    });
  const en = symbols.filter((s) => s.side === 'enemy' && isUnit(s));
  const own = symbols.filter((s) => s.side === 'own' && isUnit(s));
  const mapIn = input('Symbols on the map, as drawn');
  if (en.length) {
    patches.push({ id: 'rev.en', draft: `Marked on the map: ${forceLine(en)}.`, state: 'map', basis: [mapIn], prompts: ['Add the En likely aim and timings'] });
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
  return { patches, confirm: en.length ? [] : [{ text: 'No en symbols on the map: the En strength and start points are not known to the reading.', paras: ['rev.en', 'en.comp', 'own.str'] }], drawnObs, enForce: en.length ? forceLine(en) : null, ownWhere: own.length ? where(own, 10) : null };
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
        rows: tr.slice(0, 26).map((t, i) => [`${String.fromCharCode(97 + i)}.`, `${t.trigger}: the En's lead element there in ${Math.round(t.enemyMin)} min.`, `${t.who} from ${t.from} to ${t.to}: ${Math.round(t.min)} min. ${t.st === 'pass' ? 'In time.' : t.reason}`]),
        widths: [0.08, 0.42, 0.5],
      },
      basis: [planIn, calc('The what-if: the En\'s time along the approach at the IPB rates against each own move on foot or mounted')],
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
  const how = calc(`The En's time along each avenue: each stretch at the rate for its going; earliest = by day, unassessed ground taken as GO; latest = by night, unassessed as SLOW-GO; from ${e.fromThreat ? 'the Threat marker' : 'the edge of the area read'} at H`);
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
    return ` Unopposed, the En phases would run: ${parts.join('; ')}. Each fight adds to these times.`;
  };
  const optText = (a: AprcAvenueIn): string =>
    `${who} along ${a.id}${a.onto ? ` (${a.onto})` : ''}: ${km(a.lengthM)} km, GO on ${pct(a.goPct)}, narrowest ${km(a.minWidthM)} km${a.through.length ? `, through ${list(a.through.slice(0, 6))}` : ''}. ` +
    `The En's lead element reaches the avenue at ${whenText(a.startH, hMin)} and ${e.objective} at ${whenText(a.endH, hMin)}.${phasesText(a)}`;
  const linesCalc = av.some((a) => a.lines?.length) ? [calc('The En\'s time at each line of def: where the avenue crosses it, at the same rates')] : [];
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
    if (Math.abs(opts[0].endH[0] - opts[1].endH[0]) >= WEIGH_MIN.hours) patches.push({ id: 'en.danger', draft: `Along ${fastest.id}: the En is onto ${e.objective} earliest, at ${whenText(fastest.endH[0], hMin)}.`, state: 'judge', basis: [how, calc('Most dangerous taken as the earliest onto the objective; a proposal')] });
  }

  // Most probable: the IPB reading's main avenue (the best going of those viable); his intent decides
  const main = av.find((a) => a.main) ?? null;
  if (main)
    patches.push({
      id: 'en.probable',
      draft: `Along ${main.id}${main.onto ? ` (${main.onto})` : ''}: the main avenue of the IPB reading, most GO of those viable (${pct(main.goPct)}${main.through.length ? `, through ${list(main.through.slice(0, 3))}` : ''}); the En is onto ${e.objective} at ${whenText(main.endH, hMin)}.`,
      state: 'judge',
      basis: [avIn, calc("Most probable taken as the IPB reading's main avenue, most GO of those viable; the En aim and doctrine decide: a proposal, no book figure")],
    });

  // His reactions against own counter actions: the TAIs and the decisions before them.
  const rows: string[][] = [];
  for (const t of [...e.tais].sort((a, b) => a.earliestH - b.earliestH)) {
    const dp = e.dps.find((d) => d.tai === t.id);
    rows.push([
      '',
      `The En's lead element at ${t.id} on ${t.aa} (${t.why}): ${whenText([t.earliestH, t.latestH], hMin)}.`,
      dp ? `${dp.id}: ${dp.decision.replace(/[.?]\s*$/, '')}${dp.beforeH ? ' (before H)' : ` by ${whenText(dp.earliestH, hMin)}`}.` : 'Engage the En there with the fire planned on it.',
    ]);
  }
  for (const d of e.dps.filter((x) => x.kind === 'catk')) rows.push(['', `The En is onto the depth localities on ${d.aa}.`, `${d.id}: ${d.decision.replace(/[.?]\s*$/, '')} by ${whenText(d.earliestH, hMin)}.`]);
  rows.forEach((r, i) => (r[0] = `${String.fromCharCode(97 + (i % 26))}.`));
  if (rows.length)
    patches.push({
      id: 'crs.react',
      draft: '',
      state: 'judge',
      table: { head: ['Ser', 'En Reactions', 'Own Ctr Actions'], rows: rows.slice(0, 26), widths: [0.08, 0.46, 0.46] },
      basis: [avIn, how, rule('A decision is taken while the En is at least 2 hrs from the TAI (IPB book p 30)')],
    });
  confirm.push({ text: `The En's times are the book's unopposed rates on the ground read, ${e.fromThreat ? 'from the Threat marker' : 'from the edge of the area read (no Threat marker)'}: set H and check them against the En doctrine.`, paras: ['en.opts', 'crs.react'] });
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
  // the guide's almt table (Understanding Aprc Sec II sheets 5-6): Inf in Pls, then Armr, LAT, HAT, Engrs, Remarks
  const row = (ser: string, task: string, inf: string, remarks = ''): void => void rows.push([ser, task, inf, '', '', '', '', remarks]);
  const locs = (l: AorDefLine, what: string): void => {
    const b = [...new Set(l.buas.filter((x): x is string => !!x))];
    if (!b.length) {
      row(lab(), `${what}: Line ${l.id}`, '3 x pl');
      pls += 3;
      return;
    }
    const first = lab();
    b.forEach((x, i) => {
      row(i === 0 ? first : '', `${what}: ${x}`, '3 x pl');
      pls += 3;
    });
  };
  locs(fdl, 'FDLs');
  if (depth) locs(depth, 'Depth');
  row(lab(), `Str Pt: ${named ? r.mitg.name : 'the MITG'}`, '1 x pl');
  pls++;
  if (screen) {
    row(lab(), `Screen: ahead of Line ${fdl.id}`, '1 x pl');
    pls++;
  }
  row(lab(), 'Flk protection', '');
  row(lab(), 'Res', '', 'Armr, engrs, 2/3 of the depth Coy; never LAT / HAT');
  row(lab(), 'Obs laying', '', 'Engrs; the Aslt Pnr Pl');
  row('', 'Total', `${pls} x pl`);
  const basis = [
    calc('A Coy (3 Pls) to each BUA astride an apch on the FDLs and in depth, a Pl each for the Str Pt and the screen: a working assumption to change, not a book figure'),
    data('BUAs astride the apchs on each line: the AOR reading'),
    rule('The almt table as the guide lays it out: Inf (Pls), Armr (Tps), LAT, HAT (Pls), Engrs (Secs), Remarks; the res of armr, engrs and 2/3 of the depth Coy (Understanding Aprc Sec II sheets 5-6, p 6)'),
  ];
  patches.push({ id: 'own.tasks.dp1', draft: '', state: 'judge', table: { head: ['Ser', 'Task / Loc', 'Inf (Pl)', 'Armr (Tp)', 'LAT (Pl)', 'HAT (Pl)', 'Engrs (Sec)', 'Remarks'], rows, widths: [0.07, 0.29, 0.1, 0.1, 0.09, 0.09, 0.1, 0.16] }, basis });
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
  /** The ORBAT unit id (the cas estimate reads its strength by rank). */
  id?: string;
  /** Mounted in APCs (the ORBAT's): a mech unit's attk has a dismounting area. */
  mounted?: boolean;
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

/**
 * The attacker's 3 : 1, cited by the ground: the usual 3 : 1 superiority (IBB p 248); in mountains comparatively more than
 * the conventional 3 : 1, coming into play in sequence (MW p 80, a mountain rule that prints no figure: doctrine review R67 / R68).
 */
export const ratioRule = (mountains = false): AprcBasis =>
  mountains
    ? rule('In mountains an attacker is allotted comparatively more than the conventional 3 : 1; the higher ratio comes into play in sequence, most tps held in res at first (MW p 80; no figure printed)')
    : rule('An attacker keeps the usual 3 : 1 superiority (IBB p 248)');

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
export function writeStrength(s: AprcStrengthIn, o: { attack?: boolean; disposns?: string | null; mountains?: boolean } = {}): AprcWritten {
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
    const basis: AprcBasis[] = [data(`ORBAT: ${srcs.join('; ')}`), calc('Each side summed over its units; ratio = own to en'), ratioRule(o.mountains)];
    if (s.enAssumed) basis.push(input(`En assumed: ${s.enAssumed}`));
    if (s.ownAssumed) basis.push(input(`Own assumed: ${s.ownAssumed}`));
    const ratio = coysEn > 0 ? coysOwn / coysEn : null;
    patches.push({
      id: 'own.str',
      draft: `Own: ${unitsText(s.own)}${s.ownAssumed ? ' (assumed)' : ''}. En: ${unitsText(s.en)}${s.enAssumed ? ' (assumed)' : ''}.${ratio !== null ? ` Manoeuvre Coys ${ratio.toFixed(1)} : 1 own to en: ${ratio > 3 ? `more than the 3 : 1 an attacker wants${o.mountains ? '; in mountains comparatively more is wanted, in sequence' : ''}` : 'short of the 3 : 1 an attacker wants'}.` : ''}`,
      state: s.enAssumed || s.ownAssumed ? 'judge' : 'map',
      table: { head: ['Ser', 'Arms', 'En', 'Own', 'Ratio'], rows, widths: [0.08, 0.36, 0.2, 0.2, 0.16] },
      basis,
    });
    // the advice is the planner's to take: a proposal of its own, not part of the figures
    if (ratio !== null && ratio <= 3)
      patches.push({ id: 'own.ded.addl', draft: `Manoeuvre Coys ${ratio.toFixed(1)} : 1 own to en, short of 3 : 1: phase the attk so each phase has 3 : 1 where it strikes, or ask for more tps.`, state: 'judge', basis: [ratioRule(o.mountains), calc('Manoeuvre Coys summed over each side (ORBAT)')] });
    const ownComp = s.own.map((u) => `${u.count} x ${u.name}: ${n1(u.coys)} manoeuvre Coys${u.plsPerCoy ? ` of ${u.plsPerCoy} Pls` : ''}${u.strength ? `, ${u.strength.toLocaleString('en-GB')} all ranks` : ''}${u.atgm ? `, ${u.atgm} ATGM launchers` : ''}${u.mortars ? `, ${u.mortars} mortars` : ''}`).join('; ');
    patches.push({ id: 'own.comp', draft: `${ownComp}.${o.disposns ? ` Disposns: ${o.disposns}.` : ''}`, state: s.ownAssumed ? 'judge' : 'map', basis: [data(`ORBAT: ${[...new Set(s.own.map((u) => u.src))].join('; ')}`), ...(o.disposns ? [input('Symbols on the map, as drawn')] : []), ...(s.ownAssumed ? [input(`Own assumed: ${s.ownAssumed}`)] : [])] });
    return { patches, confirm: s.enAssumed ? [{ text: `En strength is assumed (${s.enAssumed}): mark the En posns on the map for the real figures.`, paras: ['own.str'] }] : [] };
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
  return { patches, confirm: s.enAssumed ? [{ text: `En strength is assumed (${s.enAssumed}): mark the En units on the map for the real figures.`, paras: ['own.str'] }] : [] };
}

// ── time required ────────────────────────────────────────────────────────────────────────────────────────────────

export interface AprcTimeIn {
  /** The move in: from where (words), straight-line km, the speed taken and its source. Null: no move found. */
  move: { from: string; km: number; kmh: number; src: string } | null;
  /** Posns prepared in [min, max] hours, and the source (and what the figure covers, for the From column). */
  prep: { h: [number, number]; src: string; note?: string } | null;
  /** The protective minefield along the FDLs. */
  mines: { frontM: number; engr: string; handH: number | null; mechH: number | null; perPl: number; src: string } | null;
  /** The DS guns to deploy: a fd Bty (a Bn) or a fd Regt (a Bde); absent or null: no row (a Coy). */
  guns?: 'Bty' | 'Regt' | null;
  /** The country the AOR reads as ('Desert', 'Mountains' ...): the books' notes on the prep of posns. */
  ground?: string | null;
}

/** The prep of posns on a terrain's own ground: the desert's trenches by frames (R80), the mountains' digging (R88). */
const PREP_GROUND: Record<string, { note: string; rule: string }> = {
  Desert: {
    note: 'In desert: revetted trenches by frames, 6 h for a wpn crew with the frames to hand, 4-6 h more to make them; fwd and rev slope posns double the def stores',
    rule: 'Desert trenches by frames: "It would take 6 hours for the crew of a weapon to construct the trench", 4-6 additional hours if the frames are not made earlier; a Coy\'s revetment in one 2.5 ton veh, a Bn\'s in five (DW Annex B p 97); posns on both fwd and rev slopes double the def stores (DW p 95 note b)',
  },
  Mountains: {
    note: 'In mountains: the difficulty of digging means more time (no figure printed); maint in cold weather five times the normal',
    rule: 'Mountains: "The difficulty of digging means that more time is needed for the preparation and organization of positions" (MW p 147, no figure printed); maint during cold weather "a multiple of five times the normal" (MW p 262)',
  },
};

/**
 * The rest of the Time Req list, at the hours of the guide's specimen (Understanding Aprc Sec II sheet 7): no pamphlet
 * prints them, so they are the guide's (user, 24 Nov 2026), each said to be a specimen. Done in parallel with the prep.
 */
export const TIME_REQ_SPECIMEN: Array<[string, number]> = [
  ['Prep of C pen posn', 12], ['Prep of screens', 12], ['C attk and C pen rehearsals', 8], ['OHP', 12], ['Cam and clt', 12],
  ['Clearance of F of F', 12], ['Laying of wire obs', 6], ['Coord', 12], ['Participation in Bde rehearsals', 12],
];
/** Battle procedure at all lvls before the move (the guide's specimen, Understanding Aprc Sec II sheet 7). */
export const BATTLE_PROC_H = 12;

/**
 * The protective M fd's hours: the shorter of by hand and with MMLs; in desert the hand time, as MMLs fail in loose sand
 * and lay only on the dhars (DW p 65). `sand`: the MML time was set aside for it.
 */
export function minesHours(m: AprcTimeIn['mines'] | null | undefined, ground: string | null | undefined): { h: number | null; sand: boolean } {
  if (!m) return { h: null, sand: false };
  const sand = ground === 'Desert' && m.handH !== null && m.mechH !== null && m.mechH < m.handH;
  return { h: sand ? m.handH : [m.handH, m.mechH].filter((x): x is number => x !== null).sort((a, b) => a - b)[0] ?? null, sand };
}

/**
 * Time Req: the rows the data gives (the move in, the prep of the main def, the protective M fd) and the guide's specimen
 * rows for the rest. Two totals: one row after the other, as the guide's specimen adds them (Sec II sheet 7), and the
 * critical path (battle procedure, the move, the prep of the main def or the M fd, whichever is longer), the floor.
 */
export function writeTimeReq(t: AprcTimeIn): AprcWritten & { reqH: number | null } {
  const patches: AprcPatch[] = [];
  if (!t.move && !t.prep && !t.mines) return { patches, confirm: [], reqH: null };
  const rows: string[][] = [];
  const basis: AprcBasis[] = [];
  const spec = 'the guide\'s specimen (Understanding Aprc Sec II sheet 7), not a book rule';
  let all = BATTLE_PROC_H, low = BATTLE_PROC_H;
  let n = 0;
  const ser = (): string => `${String.fromCharCode(97 + n++)}.`;
  rows.push([ser(), 'Battle procedure at all lvls', String(BATTLE_PROC_H), `Wng O, recce, orders: ${spec}`]);
  if (t.move) {
    const h = t.move.km / t.move.kmh;
    low += h;
    all += h;
    rows.push([ser(), 'Mov / occupation of def', `${h.toFixed(1)} +`, `Mov from ${t.move.from}: ${t.move.km.toFixed(1)} km in a straight line at ${t.move.kmh} km/h by night; the road is longer. Occupation: yours`]);
    basis.push(rule(`March speed: ${t.move.src}`), calc('Straight line from the unit symbol to the MITG: a lower bound'));
  } else rows.push([ser(), 'Mov / occupation of def', '', 'The unit is in the AOR already, or not marked']);
  if (t.guns) {
    // the DS guns by ni, excluding travel (IBB p 122); done while the posns are prepared, not on the critical path
    const g = GUN_DEPL.fd[t.guns];
    const [nr0, nr1] = GUN_DEPL.niNoRecceH[t.guns];
    all += g.ni / 60;
    const gunGround = t.ground === 'Mountains' ? '. In mountains towed guns go singly or by sections near the hairpin bends, the firing unit by sections at two or three places' : t.ground === 'Desert' ? '. In desert towed guns are hard to move in loose sand, SP guns ideal' : '';
    rows.push([ser(), `Depl of the DS fd ${t.guns}`, (g.ni / 60).toFixed(1), `By ni ${g.ni} min (${g.day} by day), excluding travel; registration ${GUN_DEPL.regEachMin} min each plus ${GUN_DEPL.regPlusMin}; without daylight recce a ${t.guns} ${nr0 === nr1 ? nr0 : `${nr0}-${nr1}`} h${gunGround}`]);
    basis.push(rule(`Guns: ${GUN_DEPL_TEXT}`));
    if (t.ground === 'Mountains') basis.push(rule('In mountains towed wpns deploy only in small areas near hairpin bends, a single wpn or a section (MW p 240); the firing unit by sections at two or three places (MW p 244)'));
    if (t.ground === 'Desert') basis.push(rule('In desert, in areas of loose sand towed guns are difficult to move; SP guns ideal (DW p 60)'));
  }
  const { h: minesH, sand: sandMines } = minesHours(t.mines, t.ground);
  const pg = t.ground ? PREP_GROUND[t.ground] ?? null : null;
  if (t.prep) {
    all += t.prep.h[0];
    rows.push([ser(), 'Prep of main def (altn / sec)', t.prep.h[0] === t.prep.h[1] ? `${t.prep.h[0]} +` : `${t.prep.h[0]}-${t.prep.h[1]}`, `${t.prep.note ?? 'A Coy prepares its posn in this time'}${pg ? `. ${pg.note}` : ''}`]);
    basis.push(rule(t.prep.src));
  } else rows.push([ser(), 'Prep of main def (altn / sec)', '', pg?.note ?? '']);
  if (pg) basis.push(rule(pg.rule));
  low += Math.max(t.prep?.h[0] ?? 0, minesH ?? 0);
  for (const [what, h] of TIME_REQ_SPECIMEN.slice(0, 3)) {
    all += h;
    rows.push([ser(), what, String(h), spec]);
  }
  if (t.mines) {
    if (minesH !== null) all += minesH;
    rows.push([
      ser(),
      'Protective M fd laying',
      minesH === null ? '' : String(minesH),
      `${km(t.mines.frontM)} km of front by ${t.mines.engr}: by hand ${t.mines.handH ?? '–'} h${t.mines.mechH !== null ? `, with MMLs ${t.mines.mechH} h` : ''} (${t.mines.perPl} mixed clusters a Pl in 24 h)${sandMines ? '; in desert the MMLs only on the dhars, by hand on the soft sand: the hand time taken' : ''}`,
    ]);
    basis.push(rule(`Mine laying: ${t.mines.src}`), data('Front: the FDLs line of the AOR reading'));
    if (sandMines) basis.push(rule('In desert mechanical mine laying is not successful in loose sand: MMLs on the dhars, manual laying on the soft sand (DW p 65)'));
  } else rows.push([ser(), 'Protective M fd laying', '', '']);
  for (const [what, h] of TIME_REQ_SPECIMEN.slice(3)) {
    all += h;
    rows.push([ser(), what, String(h), spec]);
  }
  rows.push(['', 'Total, one row after the other', `${Math.round(all)} +`, 'As the guide\'s specimen adds them']);
  rows.push(['', 'Total time (critical path)', `${Math.round(low)} +`, 'Battle procedure, the move, then the prep of the main def or the M fd, whichever is longer; the rest done in parallel']);
  basis.push(rule(`Specimen hours: ${spec.replace(/^the guide's specimen /, '')}`), calc('Critical path = battle procedure + the move + the longer of the prep of the main def and the M fd; a method'));
  patches.push({ id: 'ts.req', draft: '', state: 'judge', table: { head: ['S/No', 'Activity', 'Time (hrs)', 'From'], rows, widths: [0.08, 0.32, 0.14, 0.46] }, basis });
  return { patches, confirm: t.move ? [{ text: 'The move in is a straight line: take the road distance and the column length from the Move Planner.', paras: ['ts.req'] }] : [], reqH: low || null };
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
  const used = new Set<string>();
  const kids = list2.map((c) => {
    const id = uniqueId(used, `plan.exec.tasks.${slug(c.label) || 'posn'}`);
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
          children: tasks.map((t, i) => para(`${id}.t${i + 1}`, null, { draft: t, state: i === 0 ? 'map' : 'judge', basis: i === 0 ? [planIn, data('Ends of the posn: the nearest named places, the 1:50k map')] : [planIn, calc('Depth and res: C attk onto the fwd posns; moves from the what-if, timed against the En\'s lead element')] })),
        }),
      ],
    });
  });
  patches.push({ id: 'plan.exec.tasks', draft: '', state: 'map', children: kids, basis: [planIn] });
  return { patches, confirm: [] };
}
const AprcRuleText = '________';

// ── fire on the avenues (the Extended View's IPB fire reading) ───────────────────────────────────────────────────

export interface AprcFireIn {
  /** Whose posns fire: own (the defence) or the en's. */
  posnSide: 'own' | 'enemy';
  posns: number;
  /** Some posns had no range in the catalogue (small arms' 300 m taken). */
  assumedRange: boolean;
  lines: Array<{ id: string; coveredPct: number; screenedPct: number; deadPct: number; outPct: number; seenPct: number; gaps: Array<{ fromM: number; toM: number; kind: 'd' | 's' | 'o' }> }>;
  killing: Array<{ on: string; kind: 'narrows' | 'stretch' | 'dhar'; widthM: number | null; lengthM: number; alongM: number; where: string | null; dhar?: boolean }>;
}

const GAP_WORD: Record<string, string> = { d: 'dead', s: 'screened', o: 'out of range' };

/**
 * DP 1's Killing Areas, DF, Surv and Obs Plans from the fire of own posns on the en's avenues: the killing area
 * candidates, the gaps dir fire does not reach, what the posns see. All proposals: the comd designates.
 */
export function writeFire(f: AprcFireIn): AprcWritten {
  const patches: AprcPatch[] = [];
  if (f.posnSide !== 'own' || !f.lines.length) return { patches, confirm: [] };
  const fireData = data(`Fire: ${plural(f.posns, 'own posn')} on the map over the en's avenues, sight from the 30 m elevation with buildings, crops and trees (the Extended View's IPB fire reading)${f.assumedRange ? '; posns with no range in the catalogue taken at 300 m' : ''}`);
  const k = f.killing.slice(0, 4);
  if (k.length)
    patches.push({
      id: 'gr.ded.dp1.killing',
      draft: `${cap1(list(k.map((x) => `${x.kind === 'narrows' ? `the narrows${x.widthM ? ` (${km(x.widthM)} km wide)` : ''}` : x.kind === 'dhar' ? 'a dhar under fire' : `a ${km(x.lengthM)} km stretch under fire`}${x.dhar && x.kind !== 'dhar' ? ' at a dhar' : ''} on ${x.on}, ${km(x.alongM)} km along${x.where ? ` (${x.where})` : ''}`)))}.`,
      state: 'judge',
      basis: [fireData, rule("Killing area candidates: an avenue's narrows under fire, and covered stretches of 1 km or more (OoW Vol I pp 42-45); the comd designates the killing areas"), ...(k.some((x) => x.dhar) ? [rule('In desert / semi-desert the KGs are normally selected round the dhars: open flat ground surrounded by dominating sand dunes (SZ Battle (C&SC) p 13 para 25 c); read from the firm flat class and the 30 m elevation (dunes rising 10 m within 1.5 km on 3 of 8 sides, E)')] : [])],
    });
  const gaps = f.lines.flatMap((l) => l.gaps.map((g) => ({ ...g, on: l.id }))).filter((g) => g.toM - g.fromM >= 300);
  const dead = gaps.filter((g) => g.kind !== 'o').sort((a, b) => b.toM - b.fromM - (a.toM - a.fromM)).slice(0, 6);
  const gapText = (g: (typeof gaps)[number]) => `${g.on} ${km(g.fromM)}-${km(g.toM)} km along (${GAP_WORD[g.kind]})`;
  if (dead.length) patches.push({ id: 'gr.ded.dp1.df', draft: `DF tgts on the ground own dir fire cannot reach: ${dead.map(gapText).join('; ')}.`, state: 'judge', basis: [fireData, calc('Gaps: 300 m or more of an avenue not under dir fire from own posns; indirect fire on the dead and screened ones is a proposal, no book figure')] });
  patches.push({
    id: 'gr.ded.dp1.surv',
    draft: `Seen from own posns: ${f.lines.map((l) => `${l.id} ${pct(l.seenPct)} of its length`).join(', ')}.${f.lines.some((l) => l.seenPct < 70) ? ' The stretches not seen want an OP or a ptl.' : ''}`,
    state: 'judge',
    basis: [fireData, calc('Seen: a stretch in view of any posn within its obsn reach; the OPs on what is not seen are a proposal')],
  });
  if (k.length) patches.push({ id: 'gr.ded.dp1.obs', draft: `Obs to hold the En where own fire covers it: ${list(k.map((x) => `on ${x.on} ${km(x.alongM)} km along`))}. An obs no fire covers only delays the En.`, state: 'judge', basis: [fireData, calc('Obs sited on the killing area candidates above, where own dir fire covers them; a proposal')] });
  const out = gaps.filter((g) => g.kind === 'o');
  return { patches, confirm: out.length ? [{ text: `Out of reach of own dir fire: ${out.slice(0, 4).map(gapText).join('; ')}: check the posns' ranges on the ground.`, paras: ['gr.ded.dp1.df'] }] : [] };
}

// ── his heliborne force (the Extended View's IPB air reading) ────────────────────────────────────────────────────

export interface AprcAirIn {
  lzs: Array<{ id: string; rank: number; where: string | null; why: string; existing: string | null }>;
  dzs: Array<{ id: string; rank: number; where: string | null; why: string }>;
  routes: Array<{ id: string; to: string; lengthM: number; seenPct: number }>;
  band: string;
}

/** En Sit common deductions: his likely LZs and DZs and low-level air avenues, a proposal. */
export function writeAir(a: AprcAirIn): AprcWritten {
  const patches: AprcPatch[] = [];
  const lz = [...a.lzs].sort((x, y) => x.rank - y.rank).slice(0, 3);
  const dz = [...a.dzs].sort((x, y) => x.rank - y.rank).slice(0, 2);
  if (!lz.length && !dz.length) return { patches, confirm: [] };
  const z = (x: { id: string; where: string | null; existing?: string | null }) => `${x.id}${x.where ? ` ${x.where}` : ''}${x.existing ? ` (${x.existing})` : ''}`;
  const rt = [...a.routes].slice(0, 2);
  patches.push({
    id: 'en.ded.common',
    draft: `Heliborne: the En's likeliest ${lz.length ? `LZs ${list(lz.map(z))}` : ''}${lz.length && dz.length ? '; ' : ''}${dz.length ? `DZs ${list(dz.map(z))}` : ''}.${rt.length ? ` Low-level air avenues (${a.band}): ${rt.map((r) => `${r.id} to ${r.to}, ${km(r.lengthM)} km, ${pct(r.seenPct)} of it seen from own posns`).join('; ')}.` : ''} Cover them with OPs and AD.`,
    state: 'judge',
    basis: [data("Air: the Extended View's IPB air reading (slope, room, approach, existing helipads, sight from own posns)"), rule('LZ / DZ and air avenue factors: IPB book pp 5-6; landing point sizes FM 3-21.38 (US figures, to confirm with Army Aviation)')],
  });
  return { patches, confirm: [{ text: 'The En LZs and DZs are read from the ground: walk the likeliest and site the OPs over them.', paras: ['en.ded.common'] }] };
}

// ── time data (the defence) and the backward calc (the attack) ───────────────────────────────────────────────────

export interface AprcTimeDataIn {
  /** H as a clock time on D Day, or null. */
  hHour: string | null;
  /** The Time Req total (at least), hours, or null. */
  reqH: number | null;
  /** His earliest at the FDLs, hours from H (unopposed), or null. */
  fdlH: number | null;
}

/** Time Data: D Day, by when the def is occupied and ready, from H and the Time Req. */
export function writeTimeData(t: AprcTimeDataIn): AprcWritten {
  const patches: AprcPatch[] = [];
  const hMin = parseHHour(t.hHour);
  const hIn = input(`H: ${t.hHour || 'not set'} on D Day (the sheet's H, else the Ground Guide's IPB H)`);
  if (hMin !== null) patches.push({ id: 'ts.data.d-day', draft: `H at ${clockAt(hMin, 0).replace(' D Day', '')} on D Day.`, state: 'map', basis: [hIn] });
  if (t.reqH !== null && t.reqH > 0)
    patches.push({ id: 'ts.data.time-by-which-def-to-be-occupied', draft: `Not later than ${whenText(-t.reqH, hMin)}: the Time Req, at least ${Math.round(t.reqH)} h, back from H. Work done in parallel gives more time.`, state: 'judge', basis: [hIn, calc('H less the Time Req total (a floor: the rows it could fill); a proposal')] });
  if (hMin !== null || t.fdlH !== null)
    patches.push({ id: 'ts.data.time-by-which-def-to-be-ready', draft: `By ${hMin === null ? 'H' : `H (${clockAt(hMin, 0)})`}: the En sets out at H${t.fdlH !== null ? ` and can be at the FDLs from ${whenText(t.fdlH, hMin)}, unopposed` : ''}.`, state: 'judge', basis: [hIn, ...(t.fdlH !== null ? [calc("The En's earliest at the FDLs: the en options, at the IPB book's unopposed rates (p 18)")] : []), calc('Ready by H: a proposal')] });
  return { patches, confirm: [] };
}

/** The attack's H-hour sum in minutes from H (a plan's; PlanAttack.hSumRow), any part may be missing. */
export interface AprcHSumIn {
  leaveBeforeMin: number | null;
  objMin: number | null;
  h2Min: number | null;
  obj2Min: number | null;
}

/** "H", "H+42 min", "H-1 h 30" (PlanAttack.hRelText) to minutes from H; null when it is none of these. */
export function parseHRel(s: string): number | null {
  const t = s.trim();
  if (t === 'H') return 0;
  let m = /^H\+(\d+) min$/.exec(t);
  if (m) return Number(m[1]);
  m = /^H-(\d+) h (\d+)$/.exec(t);
  if (m) return -(Number(m[1]) * 60 + Number(m[2]));
  return null;
}

/** The H-hour sum read from its check row's words ("leave the Assy Area H-1 h 30 ...; on the Obj H+42 min ..."). */
export function hSumFromText(reason: string): AprcHSumIn | null {
  const at = (re: RegExp): number | null => {
    const m = re.exec(reason);
    return m ? parseHRel(m[1]) : null;
  };
  const leave = at(/leave the Assy Area (H(?:[-+][^;(,]*)?)/);
  const h: AprcHSumIn = {
    leaveBeforeMin: leave === null ? null : -leave,
    objMin: at(/on (?:the Obj|Obj 1) (H(?:[-+][^;(,]*)?)/),
    h2Min: at(/H2 (H(?:[-+][^;(,]*)?)/),
    obj2Min: at(/on Obj 2 (H(?:[-+][^;(,]*)?)/),
  };
  return Object.values(h).some((v) => v !== null) ? h : null;
}

/** Time Calc of the attack: H on its row; with the plan's H-hour sum the march, the assault and Phase 2 too. */
export function writeTimeCalcAttk(hHour: string | null, h: AprcHSumIn | null): AprcWritten {
  const hMin = parseHHour(hHour);
  if (hMin === null && !h) return { patches: [], confirm: [] };
  const rows = BACKWARD_EVENTS.map((e, i) => [String(i + 1), e, '', '']);
  const row = (event: string): string[] => rows.find((r) => r[1] === event)!;
  const when = (min: number) => whenText(min / 60, hMin);
  row('H hr')[3] = hMin === null ? 'H' : `H (${clockAt(hMin, 0)})`;
  if (h && h.leaveBeforeMin !== null) {
    row('FAA to FUP')[2] = `${Math.round(h.leaveBeforeMin)} min`;
    row('FAA to FUP')[3] = when(-h.leaveBeforeMin);
  }
  if (h && h.objMin !== null) {
    row('FUP to Obj Phase 1')[2] = `${Math.round(h.objMin)} min`;
    row('FUP to Obj Phase 1')[3] = when(h.objMin);
  }
  if (h && h.h2Min !== null) row('A hr (not later than)')[3] = when(h.h2Min);
  if (h && h.obj2Min !== null) {
    row('SL to Obj Phase 2')[2] = h.h2Min !== null ? `${Math.round(h.obj2Min - h.h2Min)} min` : '';
    row('SL to Obj Phase 2')[3] = when(h.obj2Min);
  }
  const basis: AprcBasis[] = [input(`H: ${hHour || 'not set'} on D Day`)];
  if (h) basis.push(calc("From the plan's H-hour sum: the march at day / night rates (IBB p 18), forming up, the assault at its pace, the fire lifting at each ring (IC s66 para 7 e (1) pp 304-305)"));
  return { patches: [{ id: 'ts.calc', draft: '', state: 'judge', table: { head: ['Ser', 'Events', 'Time Req', 'Running Time'], rows, widths: [0.08, 0.5, 0.2, 0.22] }, basis }], confirm: [] };
}

// ── adm (the Admin Area finder) ──────────────────────────────────────────────────────────────────────────────────

export interface AprcAdmIn {
  /** What was looked for ("BAA", "Unit Ech"). */
  kind: string;
  sites: Array<{ rank: number; where: string | null; tone: string; verdict: string }>;
}

const TONE_WORD: Record<string, string> = { ok: 'passes', warn: 'needs work', unknown: 'not read', bad: 'fails' };

/** Adm and Log: the Admin Area finder's best sites, a proposal to walk. */
export function writeAdm(a: AprcAdmIn): AprcWritten {
  const s = [...a.sites].sort((x, y) => x.rank - y.rank).slice(0, 3);
  if (!s.length) return { patches: [], confirm: [] };
  const cut = (t: string) => (t.length > 120 ? `${t.slice(0, 117).replace(/\s+\S*$/, '')}…` : t);
  return {
    patches: [{
      id: 'plan.adm',
      draft: `${a.kind}: ${s.map((x) => `site ${x.rank}${x.where ? ` ${x.where}` : ''} (${TONE_WORD[x.tone] ?? x.tone}${x.verdict ? `: ${cut(x.verdict).replace(/\.$/, '')}` : ''})`).join('; ')}.`,
      state: 'judge',
      basis: [data("The Admin Area finder's last result: each site's rows carry their rule with book and page (AdminDoctrine.json)"), calc('The best sites as the finder ranks them; a proposal')],
    }],
    confirm: [{ text: `${a.kind} site: walk it before it is chosen.`, paras: ['plan.adm'] }],
  };
}
