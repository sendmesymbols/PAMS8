/**
 * GroundGuideDhar.ts — PURE. Is a point a dhar: open, flat, firm ground surrounded by dominating sand dunes? In the
 * desert and semi-desert the killing grounds are normally selected round the dhars (SZ Battle (C&SC) p 13 para 25 c);
 * dhars are firm inter-dune flats, ready-made landing strips (DW p 66). Read from the bundle's ground class (the firm
 * desert flat class, IpbDoctrine `air.lz.firmFlat`) and the 30 m elevation:
 *
 *   - the core (`coreM` round the point): at least `share` of it the flat classes;
 *   - the ring: along each of eight bearings out to `ringM`, the ground rises `riseM` or more above the core's mean
 *     height on at least `dirs` of them (the dunes that dominate it).
 *
 * The thresholds are IpbDoctrine `killingAreas.dhar` (E: the book prints none). Used by the Fire engine's killing area
 * candidates (GroundGuideIpbFire) and the Intelligent Deployment's killing ground in the desert (PlanFit).
 */
export interface DharTest {
  /** The firm desert flat classes. */
  cls: number[];
  coreM: number;
  share: number;
  ringM: number;
  riseM: number;
  dirs: number;
}

export interface DharReading {
  dhar: boolean;
  /** Share of the core in the flat classes (0-1); null when nothing in it was read. */
  flat: number | null;
  /** Bearings (of 8) on which the dunes rise `riseM` above the core. */
  rising: number;
}

/** The default thresholds when IpbDoctrine is not to hand (the same figures). */
export const DHAR_DEFAULT: DharTest = { cls: [12], coreM: 300, share: 0.5, ringM: 1500, riseM: 10, dirs: 3 };

/** Reads the dhar test from IpbDoctrine `killingAreas.dhar` (falls back on DHAR_DEFAULT field by field). */
export function dharTestFrom(doc: any): DharTest {
  const d = doc?.killingAreas?.dhar ?? {};
  const n = (v: unknown, fb: number) => (typeof v === 'number' && isFinite(v) ? v : fb);
  return {
    cls: Array.isArray(d.classes) && d.classes.length ? d.classes.map(Number) : DHAR_DEFAULT.cls,
    coreM: n(d.coreM, DHAR_DEFAULT.coreM),
    share: n(d.share, DHAR_DEFAULT.share),
    ringM: n(d.ringM, DHAR_DEFAULT.ringM),
    riseM: n(d.riseM, DHAR_DEFAULT.riseM),
    dirs: n(d.dirs, DHAR_DEFAULT.dirs),
  };
}

/**
 * `at(dxM, dyM)`: the class and elevation at that many metres east / north of the point (null class / NaN height when
 * not read). `stepM`: the sampling step (the grid's resolution or coarser).
 */
export function dharAt(at: (dxM: number, dyM: number) => { cls: number | null; elev: number }, t: DharTest, stepM = 60): DharReading {
  const flatSet = new Set(t.cls);
  let n = 0, flat = 0, eSum = 0, eN = 0;
  for (let dy = -t.coreM; dy <= t.coreM; dy += stepM)
    for (let dx = -t.coreM; dx <= t.coreM; dx += stepM) {
      if (dx * dx + dy * dy > t.coreM * t.coreM) continue;
      const s = at(dx, dy);
      if (s.cls !== null && s.cls !== 255) {
        n++;
        if (flatSet.has(s.cls)) flat++;
      }
      if (Number.isFinite(s.elev)) ((eSum += s.elev), eN++);
    }
  if (!n || !eN) return { dhar: false, flat: n ? flat / n : null, rising: 0 };
  const e0 = eSum / eN;
  let rising = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    for (let r = t.coreM + stepM; r <= t.ringM; r += stepM) {
      const e = at(Math.sin(a) * r, Math.cos(a) * r).elev;
      if (Number.isFinite(e) && e - e0 >= t.riseM) { rising++; break; }
    }
  }
  const share = flat / n;
  return { dhar: share >= t.share && rising >= t.dirs, flat: share, rising };
}
