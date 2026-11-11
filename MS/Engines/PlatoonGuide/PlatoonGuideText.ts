/**
 * PlatoonGuideText.ts
 *
 * Words for the Platoon Guide: the brief the panel shows and Copy as Text gives, the patrol route card, and the small
 * formatters both share (distances, bearings, the MGRS grid). Military short forms in labels (Gr, Rd, Tr, Obs, Obsn,
 * BUA, Posn, Pl, Coy ...); sentences in full. No DOM, no ArcGIS.
 */

import type { PatrolCard, PlReading, PlSpot } from './PlatoonGuideRead';

export interface PlLight {
  /** Now: day, twilight, moonlight or starlight. */
  now: string;
  /** Tonight: the moonlit share and how much of the moon is lit. */
  tonight: string;
}
export interface PlVisibility {
  fogPct: number | null;
  hazePct: number | null;
  meanViewKm: number | null;
}

export interface PlatoonBrief {
  /** What the card is for ("Pl", "Sec" ...) and where it came from ("cursor", "selected symbol" ...). */
  what: string;
  reading: PlReading | null;
  patrol: PatrolCard | null;
  grid: string;
  sheet: string | null;
  light: PlLight | null;
  vis: PlVisibility | null;
  dataLine: string;
  threat: boolean;
  pending: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const ECHELON_WORD: Record<string, string> = { team: 'Team', section: 'Sec', platoon: 'Pl', company: 'Coy', default: 'Pl' };
export const EYE_WORD: Record<string, string> = { prone: 'prone', kneeling: 'kneeling', standing: 'standing', rooftop: 'on a roof' };
export const GOING_WORD: Record<string, string> = { go: 'GO', slow: 'SLOW-GO', nogo: 'NO-GO', unknown: 'not known' };

export function num(n: number): string {
  return Math.round(n).toLocaleString('en-GB');
}
export function dist(m: number): string {
  if (!Number.isFinite(m)) return '?';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
export function brg(deg: number): string {
  return `${String(Math.round(((deg % 360) + 360) % 360) % 360).padStart(3, '0')}°`;
}
/** "Tube well 220 m NE" (distance 0: "here"). */
export function spotWords(s: PlSpot | null | undefined, opts: { name?: boolean; why?: boolean } = {}): string {
  if (!s) return 'none recorded';
  const nm = opts.name !== false && s.name && s.name !== s.label ? ` ${s.name}` : '';
  const where = s.distM < 15 ? 'here' : `${dist(s.distM)} ${s.dir}`;
  const why = opts.why && s.why ? ` (${s.why})` : '';
  return `${s.label}${nm} ${where}${why}`;
}

// ── MGRS ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
const COLS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROWS = 'ABCDEFGHJKLMNPQRSTUV';

/** WGS84 MGRS, 10 m (precision 4) by default: "43S CT 1234 5678". Latitudes 80S-84N only. */
export function mgrsOf(lng: number, lat: number, precision = 4): string {
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lat < -80 || lat > 84) return '—';
  let zone = Math.floor((lng + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && lng >= 3 && lng < 12) zone = 32;
  const band = BANDS[Math.min(19, Math.floor((lat + 80) / 8))];
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180;
  const lam0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const lam = (lng * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lam - lam0);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const E = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let Nn = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 + ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (lat < 0) Nn += 10000000;
  const col = COLS[(zone - 1) % 3][Math.floor(E / 100000) - 1] ?? '?';
  const row = ROWS[(Math.floor(Nn / 100000) + (zone % 2 === 0 ? 5 : 0)) % 20];
  const div = 10 ** (5 - precision);
  const e = String(Math.floor((E % 100000) / div)).padStart(precision, '0');
  const n = String(Math.floor((Nn % 100000) / div)).padStart(precision, '0');
  return `${zone}${band} ${col}${row} ${e} ${n}`;
}

// ── brief ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function list(items: string[], none = 'none recorded'): string {
  return items.length ? items.join('; ') : none;
}

export function headLine(b: PlatoonBrief): string {
  const r = b.reading;
  const parts = [`PL GUIDE · ${b.what}`, b.grid];
  if (b.sheet) parts.push(`Sheet ${b.sheet}`);
  if (r) parts.push(`${ECHELON_WORD[r.echelon] ?? 'Pl'} bubble ${dist(r.radiusM)}`, MONTHS[(r.month - 1 + 12) % 12]);
  return parts.join(' · ');
}

/** The Ground card as lines (Copy as Text). */
export function readingLines(b: PlatoonBrief): string[] {
  const r = b.reading;
  if (!r) return [];
  const H = r.here;
  const out: string[] = [];
  out.push('1 HERE');
  out.push(`  Gr: ${H.clsLabel}. Foot ${GOING_WORD[H.going.foot]}, Veh ${GOING_WORD[H.going.veh]}${H.going.afterRain ? `. ${H.going.afterRain}` : ''}`);
  const lv = (n: number | null) => (n === null ? 'not known' : ['None', 'Poor', 'Fair', 'Good'][n] ?? String(n));
  out.push(`  Cover here: ${lv(H.cover.cover)}, concealment ${lv(H.cover.concealment)}`);
  if (H.betterCover) out.push(`  Better cover: ${spotWords(H.betterCover)}`);
  if (H.betterConcealment) out.push(`  Better concealment: ${spotWords(H.betterConcealment)}`);
  const w = H.water;
  out.push(`  Water: ${list([w.nearest && spotWords(w.nearest, { why: true }), w.perennial && spotWords(w.perennial, { why: true }), w.line && spotWords(w.line)].filter(Boolean) as string[])}`);
  if (w.brackish) out.push(`  Brackish noted on the map ${dist(w.brackish.distM)} ${w.brackish.dir}: test before drinking`);
  const open = H.waysOut.dirs.filter((d) => d.foot === 'go' || d.foot === 'slow').map((d) => (d.foot === 'slow' ? `${d.dir} (slow)` : d.dir));
  const shut = H.waysOut.dirs.filter((d) => d.foot === 'nogo').map((d) => d.dir);
  const vOpen = H.waysOut.dirs.filter((d) => d.veh === 'go').map((d) => d.dir);
  out.push(`  Way out on foot: ${open.join(' ') || 'none'}${shut.length ? `; blocked ${shut.join(' ')}` : ''}. Veh: ${vOpen.join(' ') || 'none'}`);
  out.push(`  Nearest Rd / Tr: ${H.waysOut.road ? `${H.waysOut.road.name ?? H.waysOut.road.label} ${dist(H.waysOut.road.distM)} ${H.waysOut.road.dir}` : 'none within 5 km'}`);
  const hl = H.hls;
  const wires = hl.wires.map((x) => `${x.label} ${dist(x.distM)} ${x.dir}`);
  out.push(`  Landing site: ${hl.ground ? (hl.ground.distM < 15 ? 'clear Gr here' : `clear Gr ${dist(hl.ground.distM)} ${hl.ground.dir}`) : 'no clear Gr within 2 km'}${wires.length ? `; wires near it: ${wires.join(', ')}` : ''}; recorded: ${spotWords(hl.recorded)}`);
  const md = H.medical;
  out.push(`  Medical: ${spotWords(md.hospital)}${md.driveMin !== null ? ` (~${md.driveMin} min drive, est)` : ''}; ${spotWords(md.bhu)}; ${spotWords(md.dispensary)}`);
  const wh = H.where;
  const admin = [wh.district, wh.tehsil].filter(Boolean).join(' / ');
  out.push(`  Where: ${b.grid}${b.sheet ? `, sheet ${b.sheet}` : ''}${wh.km ? `; ${wh.km.label}${wh.km.name ? ` ${wh.km.name}` : ''} ${dist(wh.km.distM)} ${wh.km.dir}` : ''}${wh.place ? `; ${wh.place.name ?? wh.place.label} ${dist(wh.place.distM)} ${wh.place.dir}` : ''}${admin ? `; ${admin}` : ''}`);

  const S = r.see;
  if (S) {
    out.push(`2 WHAT I SEE (${EYE_WORD[r.eye] ?? r.eye}, eye ${S.eyeM} m)`);
    out.push(`  Within ${dist(S.radiusM)}: seen ${S.pct.seen}%, screened ${S.pct.screened}%, dead ${S.pct.dead}%. Within 300 m: seen ${S.near.seen}%, screened ${S.near.screened}%, dead ${S.near.dead}%`);
    out.push(`  Nearest dead Gr: ${S.deadNear ? `${dist(S.deadNear.distM)} ${S.deadNear.dir}: a man there is hidden from you` : 'none within 300 m'}`);
    if (S.approachDirs.length) out.push(`  Covered approaches to you from: ${S.approachDirs.join(' ')}`);
    out.push(`  Overlooked from: ${list(S.overlook.map((o) => `${dist(o.distM)} ${o.dir} (${o.why})`), 'no higher Gr in view within 800 m')}`);
    if (S.rooftops) out.push(`  Rooftops: ${dist(S.rooftops.distM)} ${S.rooftops.dir}: ${S.rooftops.why}`);
    if (S.skyline) out.push('  You are on a crest: you show on the skyline; move below it');
    out.push(`  Range card: ${list(S.refs.map((x) => `${brg(x.bearingDeg)} ${dist(x.distM)} ${x.name ?? x.label}`), 'no landmark in view')}`);
    out.push(`  Resection: ${S.resection.length === 3 ? S.resection.map((x) => `${brg(x.bearingDeg)} ${x.name ?? x.label} ${dist(x.distM)}`).join('; ') : 'fewer than three fixed landmarks in view'}`);
  }
  if (b.light || b.vis) {
    const v = b.vis;
    const vis = v ? `; ${MONTHS[(r.month - 1 + 12) % 12]}: fog ${v.fogPct ?? '?'}% of days, haze ${v.hazePct ?? '?'}%, mean view ${v.meanViewKm !== null ? `${v.meanViewKm.toFixed(0)} km` : '?'}` : '';
    out.push(`  Light: ${b.light ? `${b.light.now}; ${b.light.tonight}` : 'not known'}${vis}`);
  }

  const D = r.danger;
  if (D) {
    out.push(`3 DANGER ROUND ME (Rds and Trs scanned: ${D.roadKm.toFixed(1)} km)`);
    if (!D.spots.length) out.push('  No likely mine / IED or ambush site found on the Rds in the bubble');
    for (const s of D.spots) out.push(`  ${s.label} ${dist(s.distM)} ${s.dir} — ${s.why ?? ''} (${s.score})`);
    if (D.approaches.length) out.push(`  Covered Gr towards you: ${D.approaches.map((a) => `${a.label} ${dist(a.distM)} ${a.dir}`).join('; ')}`);
    if (D.hazards.length) out.push(`  Hazards: ${D.hazards.map((h) => `${h.label} ${dist(h.distM)} ${h.dir}`).join('; ')}`);
    if (D.border) out.push(`  Border: ${D.border.kind} ${D.border.km.toFixed(1)} km${D.border.km <= 5 ? ': under observation, mines possible' : ''}`);
    for (const n of D.natural) out.push(`  ${n}`);
  }

  const P = r.people;
  out.push(`${D ? '4' : '2'} PEOPLE (WorldPop 2026 estimate, not a census)`);
  const rings = P.rings.map((x) => `${num(x.people)} within ${x.km} km`);
  out.push(`  ${P.perKm2 !== null ? `~${num(P.perKm2)} /km² here; ~${num(P.within500 ?? 0)} within 500 m` : 'People here not known'}${rings.length ? `; ${rings.join('; ')}` : ''}`);
  if (P.ages) out.push(`  Within 2 km: males 15-49 ${num(P.ages.males15_49)}, under 15 ${num(P.ages.under15)}, over 65 ${num(P.ages.over65)}`);
  out.push(`  Nearest BUA: ${P.bua ? `${P.bua.name} ${dist(P.bua.distM)} ${P.bua.dir}${P.bua.why ? ` (${P.bua.why})` : ''}` : 'none recorded within 10 km'}`);
  if (P.bld) out.push(`  Bldgs here: ${P.bld.density}, ${P.bld.size}${P.bld.tall ? ', tall' : ''}`);
  if (P.huts) out.push(`  Huts: ~${P.huts.perKm2} permanent /km²${P.huts.temporary ? ', temporary huts nearby (nomads)' : ''}`);
  out.push(`  Sensitive sites within ${dist(r.radiusM)}: ${list(P.sensitive.counts.map((c) => `${c.label} ${c.n}`))}${P.sensitive.nearest[0] ? `; nearest ${spotWords(P.sensitive.nearest[0])}` : ''}`);
  if (P.crowd.length) out.push(`  Crowd points: ${P.crowd.map((c) => spotWords(c)).join('; ')}`);

  const HP = r.help;
  out.push(`${D ? '5' : '3'} HELP`);
  out.push(`  Nearest: ${list(HP.friends.slice(0, 4).map((f) => spotWords(f)))}`);
  if (HP.relay) out.push(`  Relay / OP Gr: ${dist(HP.relay.distM)} ${HP.relay.dir} (${HP.relay.why})`);
  if (HP.radioShadow) out.push('  Low Gr ringed by higher Gr: radio shadow likely; send from the high Gr');
  if (HP.supply.length) out.push(`  Supply: ${HP.supply.map((x) => spotWords(x)).join('; ')}`);

  const ST = r.stop;
  if (ST) {
    out.push('6 WHERE TO STOP');
    out.push(`  Patrol base / harbour: ${ST.harbour ? `${dist(ST.harbour.distM)} ${ST.harbour.dir}` : 'none found'} — ${ST.harbourWhy.join('; ')}`);
    out.push(`  OP: ${ST.op ? `${dist(ST.op.distM)} ${ST.op.dir} — ${ST.opWhy}` : ST.opWhy}`);
  }
  return out;
}

export function patrolLines(p: PatrolCard): string[] {
  const out: string[] = [];
  out.push(`PATROL ROUTE CARD · ${dist(p.lengthM)} · ${p.legs.length} legs · day ${p.minDay} min / night ${p.minNight} min`);
  for (const l of p.legs) {
    const end = l.endFeature ? ` → ends at ${l.endFeature.name ?? l.endFeature.label}${l.endFeature.distM > 20 ? ` (${dist(l.endFeature.distM)} ${l.endFeature.dir} of the turn)` : ''}` : ' → no landmark at the turn';
    out.push(`  Leg ${l.i}: ${brg(l.bearingDeg)} ${dist(l.distM)}, ${num(l.paces)} paces, ${l.minDay} / ${l.minNight} min${l.climbM >= 10 ? `, climb ${l.climbM} m` : ''}${end}`);
  }
  if (p.bounds.length) out.push(`  Bounds at ${p.bounds.map((x) => dist(x.chainM)).join(', ')}`);
  if (p.fmp) out.push(`  Final meeting point at ${dist(p.fmp.chainM)} (${dist(p.lengthM - p.fmp.chainM)} short of the end)`);
  const range = (s: { fromM: number; toM: number }) => (Math.abs(s.toM - s.fromM) < 30 ? `at ${dist(s.fromM)}` : `${dist(s.fromM)}-${dist(s.toM)}`);
  if (p.threatKnown) out.push(`  Hidden from the threat: ${list(p.dead.map(range), 'no stretch')}`);
  out.push(`  Exposed: ${list(p.exposed.map((s) => `${range(s)} (${s.why})`), 'no stretch')}`);
  if (p.skyline.length) out.push(`  Skyline: ${p.skyline.map(range).join('; ')}`);
  if (p.obstacles.length) out.push(`  Obs crossed: ${p.obstacles.map((o) => `${o.label} at ${dist(o.chainM)}`).join('; ')}`);
  if (p.villages.length) out.push(`  Villages passed: ${p.villages.map((v) => `${v.name ?? 'village'} at ${dist(v.chainM)}`).join('; ')}: avoid at night`);
  for (const d of p.dangers.slice(0, 8)) out.push(`  ${d.label} ${range(d)} — ${d.why}`);
  for (const c of p.checks) out.push(`  Check: ${c}`);
  return out;
}

export function briefLines(b: PlatoonBrief): string[] {
  const out = [headLine(b)];
  if (b.reading) out.push(...readingLines(b));
  if (b.patrol) out.push(...patrolLines(b.patrol));
  const r = b.reading;
  if (r?.checks.length) {
    out.push('CHECK ON THE GROUND');
    for (const c of r.checks) out.push(`  ${c}`);
  }
  if (r?.gaps.length) {
    out.push('DATA GAPS');
    for (const g of r.gaps) out.push(`  ${g}`);
  }
  if (!b.threat && r?.see) out.push('No threat place set: drag the Ground Guide threat marker for dead Gr and exposure toward the enemy');
  if (b.dataLine) out.push(`Data: ${b.dataLine}. Plan + recce list, not a replacement for recce.`);
  return out;
}
