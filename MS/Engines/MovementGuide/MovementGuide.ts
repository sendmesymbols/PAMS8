/**
 * MovementGuide.ts
 *
 * The Movement Guide: eight cards for the safety of the move, read from the terrain bundle, not tied to any symbol
 * (user, 2026-11-11: "lets not attach it with a symbol ... create cards like the Ground Guide ... one should be able to
 * create Cordon and Picketing plans"):
 *
 *   Cordon    click a town (or draw the area): platoon sectors, rooftop and side-road posts, road blocks, people inside
 *   Picket    draw the route: route picketing on both sides or piqueting with the fewest posts, when each is up,
 *             check posts, what to clear first
 *   Convoy    the same route: packets, start / release times, bounds ending at safe halts, what each bound clears
 *   Mines     the same route: likely mine / IED sites, ranked
 *   Patrol    click start and objective: a route out and a different route back, the night march chart
 *   Ambush    draw the enemy's route: sites ranked, each with a line / L / V layout and a meeting point
 *   Rd Block  the same route: road block and tank ambush sites with flanking positions
 *   Infil     draw the line to watch: lanes through the ground the posts do not see, and the posts that close them
 *   Water     click a bank (or draw an axis, or a reach): the water obstacle as IBB Annex P types it, home bank against
 *             far bank, the tank / wheels / foot check, the crossings and what to recce (MovementGuideWater.ts)
 *
 * Each card works out its plan as soon as its input is drawn and again when a setting changes; "Create on map" turns
 * the plan into ordinary symbols (saved, edited and undone like any other); Copy as Text gives the card's brief.
 *
 * Off by default (`features.movementGuide`). Off means off: no bundle request, no layer, no window, no listener.
 * On without a bundle: one line in the Engine Log, and the cards say there is no terrain data.
 */

import EngineLogger from '../../Support/EngineLogger';
import DOCTRINE from '../../Data/MovementDoctrine.json';
import SPEEDS from '../../Data/MovementSpeeds.json';
import PL_DOCTRINE from '../../Data/PlatoonDoctrine.json';
import Point from '@arcgis/core/geometry/Point';
import { MovementGuideProbe } from './MovementGuideProbe';
import { MovementGuideMap, MG_BLUE, MG_CYAN, MG_GREEN, MG_ORANGE, MG_RED, MG_VIOLET, type MovMapLine, type MovMapMark, type MovMapProducts, type MovRGB } from './MovementGuideMap';
import { MovementGuideDraw, type DrawKind } from './MovementGuideDraw';
import { MovementGuideCards } from './MovementGuideCards';
import { MovementGuideCursor, type HoverInfo } from './MovementGuideCursor';
import { MovementGuideWaterCard, WATER_CARD_STYLES, type WaterCardStyle } from './MovementGuideWaterCard';
import { screenNorth } from '../GroundGuide/GroundGuideNorth';
import { band as vband } from './MovementGuideViz';
import { cardLines } from './MovementGuideText';
import {
  buaRingAround,
  casevacFor,
  checkPosts,
  circleRing,
  clearanceOrder,
  cordonPlan,
  lngLatToMerc,
  offsetPt,
  planPickets,
  RouteScanner,
  rulesFrom,
  type Casevac,
  type CheckPost,
  type CordonReading,
  type GoingSets,
  type MercXY,
  type PicketPlan,
  type RouteReading,
  type Rules,
  type Stretch,
} from './MovementGuideScan';
import {
  ambushSites,
  convoyPlan,
  cordonSectors,
  infiltrationLanes,
  likelyMineSites,
  picketTimings,
  planPatrol,
  roadBlockSites,
  type AmbushSite,
  type BlockSite,
  type ConvoyPlan,
  type CordonLayout,
  type InfilReading,
  type MineSite,
  type PatrolRoutes,
  type PicketTiming,
} from './MovementGuidePlans';
import { patrolCard, plRulesFrom, type PatrolCard, type PlFootSpeeds } from '../PlatoonGuide/PlatoonGuideRead';
import {
  quickWater,
  readAxis,
  readReach,
  readWater,
  typeDef,
  typeOfSymbolKey,
  waterRulesFrom,
  WATER_TYPE_IDS,
  type AxisReading,
  type ReachReading,
  type WaterOpts,
  type WaterReading,
  type WaterTypeId,
} from './MovementGuideWater';

const ENGINE = 'MovementGuide';
const MAX_RERUNS = 40;

export type CardId = 'cordon' | 'picket' | 'convoy' | 'mines' | 'patrol' | 'ambush' | 'block' | 'infil' | 'water';
export type CardInput = 'cordon' | 'route' | 'patrol' | 'infil' | 'water';

export interface CardDef {
  id: CardId;
  label: string;
  title: string;
  input: CardInput;
  /** The rule the card applies (doctrine file), shown under its title. */
  rule: string;
}
const D = DOCTRINE as any;
export const CARDS: CardDef[] = [
  { id: 'cordon', label: 'Cordon', title: 'Cordon Calculator', input: 'cordon', rule: D.cordon?.rule ?? '' },
  { id: 'picket', label: 'Picket', title: 'Route Picketing Plan', input: 'route', rule: D.picket?.rule ?? '' },
  { id: 'convoy', label: 'Convoy', title: 'Convoy Plan', input: 'route', rule: D.convoy?.rule ?? '' },
  { id: 'mines', label: 'Mines', title: 'Likely Mine Sites', input: 'route', rule: D.mine?.rule ?? '' },
  { id: 'patrol', label: 'Patrol', title: 'Patrol Route + Night March Chart', input: 'patrol', rule: D.patrol?.rule ?? '' },
  { id: 'ambush', label: 'Ambush', title: 'Ambush Site Scorer', input: 'route', rule: D.ambush?.rule ?? '' },
  { id: 'block', label: 'Rd Block', title: 'Road Block + Tank Ambush Siter', input: 'route', rule: D.block?.rule ?? '' },
  { id: 'infil', label: 'Infil', title: 'Infiltration Lanes + Anti-Infiltration Posts', input: 'infil', rule: D.infil?.rule ?? '' },
  { id: 'water', label: 'Water', title: 'Water Obstacle (IBB Annex P)', input: 'water', rule: D.water?.rule ?? '' },
];
const WATER_R = waterRulesFrom(DOCTRINE);
const WATER_STYLE_KEY = 'pams8.movementGuide.waterCardStyle';
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type ParamType = 'number' | 'select' | 'bool' | 'time';
export interface ParamSpec {
  key: string;
  label: string;
  type: ParamType;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: Array<{ value: string; label: string }>;
}
const MOVERS = [
  { value: 'wheeled', label: 'Wheeled' },
  { value: 'tracked', label: 'Tracked' },
];
export const PARAMS: Record<CardId, ParamSpec[]> = {
  cordon: [
    { key: 'mode', label: 'Ground', type: 'select', options: [{ value: 'auto', label: 'Auto' }, { value: 'urban', label: 'Built-up' }, { value: 'rural', label: 'Rural' }] },
    { key: 'menPer100m', label: 'Men / 100 m', type: 'number', min: 5, max: 40, step: 1 },
    { key: 'rooftopPer100m', label: '+ Rooftops / 100 m', type: 'number', min: 0, max: 20, step: 1 },
    { key: 'perSideRoad', label: '+ Per side Rd', type: 'number', min: 0, max: 10, step: 1 },
    { key: 'plMen', label: 'Pl strength', type: 'number', min: 10, max: 45, step: 1 },
    { key: 'standoffM', label: 'Off the houses', type: 'number', min: 0, max: 300, step: 10, unit: 'm' },
    { key: 'outerRingM', label: 'Outer ring out', type: 'number', min: 100, max: 3000, step: 50, unit: 'm' },
  ],
  picket: [
    { key: 'mode', label: 'Plan', type: 'select', options: [{ value: 'bothSides', label: 'Both sides (picketing)' }, { value: 'fewest', label: 'Fewest posts (piqueting)' }] },
    { key: 'rangeM', label: 'Picket covers', type: 'number', min: 200, max: 1500, step: 50, unit: 'm' },
    { key: 'minCoverM', label: 'Min Rd seen', type: 'number', min: 100, max: 1000, step: 50, unit: 'm' },
    { key: 'menPer', label: 'Men / picket', type: 'number', min: 8, max: 45, step: 1 },
    { key: 'roadKmh', label: 'Party moves', type: 'number', min: 1, max: 40, step: 1, unit: 'km/h' },
    { key: 'mover', label: 'Column', type: 'select', options: MOVERS },
  ],
  convoy: [
    { key: 'vehicles', label: 'Vehicles', type: 'number', min: 1, max: 500, step: 1 },
    { key: 'packetSize', label: 'Packet', type: 'number', min: 5, max: 10, step: 1, unit: 'veh' },
    { key: 'gapMin', label: 'Between packets', type: 'number', min: 1, max: 5, step: 1, unit: 'min' },
    { key: 'vehGapM', label: 'Vehicle gap', type: 'number', min: 25, max: 300, step: 25, unit: 'm' },
    { key: 'light', label: 'Move by', type: 'select', options: [{ value: 'day', label: 'Day' }, { value: 'night', label: 'Night' }] },
    { key: 'boundKm', label: 'Bound', type: 'number', min: 5, max: 20, step: 1, unit: 'km' },
    { key: 'start', label: 'SP time', type: 'time' },
    { key: 'mover', label: 'Column', type: 'select', options: MOVERS },
  ],
  mines: [{ key: 'minScore', label: 'Show from score', type: 'number', min: 20, max: 90, step: 5 }],
  patrol: [
    { key: 'avoidRoads', label: 'Avoid tracks / roads', type: 'bool' },
    { key: 'avoidVillages', label: 'Avoid villages', type: 'bool' },
    { key: 'avoidWoodEdges', label: 'Avoid wood edges', type: 'bool' },
    { key: 'avoidSkylines', label: 'Avoid skylines', type: 'bool' },
    { key: 'separateM', label: 'Back route apart', type: 'number', min: 0, max: 600, step: 50, unit: 'm' },
  ],
  ambush: [
    { key: 'kzM', label: 'Killing zone', type: 'number', min: 50, max: 400, step: 10, unit: 'm' },
    { key: 'meetingM', label: 'Meeting Pt back', type: 'number', min: 750, max: 900, step: 25, unit: 'm' },
    { key: 'mover', label: 'Target', type: 'select', options: MOVERS },
  ],
  block: [
    { key: 'approachM', label: 'Approach watched', type: 'number', min: 300, max: 2000, step: 100, unit: 'm' },
    { key: 'mover', label: 'Target', type: 'select', options: [{ value: 'tracked', label: 'Tanks' }, { value: 'wheeled', label: 'Wheeled' }] },
  ],
  infil: [
    { key: 'enemySide', label: 'Enemy side', type: 'select', options: [{ value: '-1', label: 'Left of the line' }, { value: '1', label: 'Right of the line' }] },
    { key: 'bandM', label: 'Depth each side', type: 'number', min: 500, max: 3000, step: 100, unit: 'm' },
    { key: 'rangeM', label: 'Post sees (night)', type: 'number', min: 300, max: 3000, step: 100, unit: 'm' },
    { key: 'lanes', label: 'Lanes', type: 'number', min: 1, max: 5, step: 1 },
    { key: 'maxPosts', label: 'Max new posts', type: 'number', min: 1, max: 30, step: 1 },
  ],
  water: [
    { key: 'purpose', label: 'We', type: 'select', options: [{ value: 'cross', label: 'Cross it (attack)' }, { value: 'hold', label: 'Hold it (defence)' }] },
    { key: 'month', label: 'Month', type: 'select', options: MONTH_NAMES.map((m, i) => ({ value: String(i + 1), label: m })) },
    {
      key: 'type',
      label: 'Type',
      type: 'select',
      options: [{ value: 'auto', label: 'Auto (from the data)' }, ...WATER_TYPE_IDS.map((t) => {
        const d = typeDef(WATER_R, t);
        return { value: t, label: `${d.annex ? `${d.annex}. ` : ''}${d.label}` };
      })],
    },
    { key: 'crossingsKm', label: 'Crossings within', type: 'number', min: 1, max: 20, step: 1, unit: 'km' },
  ],
};

export type CardResult =
  | { card: 'cordon'; reading: CordonReading; layout: CordonLayout; ages: { males15_49: number; under15: number; over65: number } | null }
  | { card: 'picket'; route: RouteReading; plan: PicketPlan; timings: PicketTiming[]; checkPosts: CheckPost[]; clear: Stretch[]; casevac: Array<{ where: string; c: Casevac }> }
  | { card: 'convoy'; route: RouteReading; plan: ConvoyPlan }
  | { card: 'mines'; route: RouteReading; sites: MineSite[] }
  | { card: 'patrol'; routes: PatrolRoutes; out: PatrolCard | null; back: PatrolCard | null }
  | { card: 'ambush'; route: RouteReading; sites: AmbushSite[]; chosen: number }
  | { card: 'block'; route: RouteReading; sites: BlockSite[]; chosen: number }
  | { card: 'infil'; reading: InfilReading }
  | {
      card: 'water';
      mode: 'point' | 'axis' | 'reach';
      /** The section shown in full: the point's, the axis obstacle chosen, or the reach's first. */
      reading: WaterReading | null;
      axis: AxisReading | null;
      reach: ReachReading | null;
      chosen: number;
    };

/** What the Water card was given. */
type WaterInput =
  | { mode: 'point'; p: MercXY; name: string }
  | { mode: 'axis'; pts: MercXY[]; name: string }
  | { mode: 'reach'; a: MercXY; b: MercXY; name: string }
  | { mode: 'symbol'; p: MercXY; pts: MercXY[]; type: WaterTypeId | null; name: string };

export interface MovementGuideOptions {
  bundleUrl: string;
  map: boolean;
  cacheTiles: number;
  useWorker: boolean;
  /** Where the threat is: the Ground Guide's threat marker (Extended View), or none. */
  threat: 'groundGuide' | 'none';
  /** The cursor card beside the mouse while the Mov Detail is open. */
  cursor: boolean;
  /** Keys: N opens / closes the Mov Detail, 1-8 switch its cards while it is open (again turns the page). */
  keys: boolean;
}
export const DEFAULT_MOVEMENT_GUIDE_OPTIONS: MovementGuideOptions = {
  bundleUrl: '/terrain-bundle',
  map: true,
  cacheTiles: 384,
  useWorker: true,
  threat: 'groundGuide',
  cursor: true,
  keys: true,
};

/** A plan item for "Create on map": what SymbolEngine.loadSymbolFromJSON takes. */
export interface PlanSymbol {
  sidc: string;
  amplifier: { SIDC: string; UNIQUE_DESIG?: string };
  drawEssentials: { SYM_GEO_TYPE: 'Point' | 'FPoint' | 'Line' | 'Area'; GEOM?: any; CTRL_PTS?: any[] };
}

/** SIDC from a Symbols.json key (symbol set + entity), friendly by default. */
export function sidcOf(key: string, o: { identity?: string; echelon?: string } = {}): string {
  return `100${o.identity ?? '3'}${key.slice(0, 2)}00${o.echelon ?? '00'}${key.slice(2)}0000`;
}
const mp = (p: MercXY) => ({ x: p[0], y: p[1], spatialReference: { wkid: 102100 } });
const pointSym = (key: string, at: MercXY, desig = '', o: { identity?: string; echelon?: string } = {}): PlanSymbol => {
  const sidc = sidcOf(key, o);
  return { sidc, amplifier: { SIDC: sidc, UNIQUE_DESIG: desig }, drawEssentials: { SYM_GEO_TYPE: key.startsWith('25') ? 'Point' : 'FPoint', GEOM: mp(at) } };
};
const lineSym = (key: string, pts: MercXY[], desig = '', o: { identity?: string } = {}): PlanSymbol => {
  const sidc = sidcOf(key, o);
  return { sidc, amplifier: { SIDC: sidc, UNIQUE_DESIG: desig }, drawEssentials: { SYM_GEO_TYPE: 'Line', CTRL_PTS: pts.map(mp) } };
};
/** Symbols.json keys the plans use. */
const K = {
  plPost: '20121470',
  inf: '10121100',
  antiTank: '10120400',
  blockRd: '40180210',
  cordonSearch: '40130304',
  checkPt: '25130300',
  startPt: '25131600',
  releasePt: '25131500',
  rallyPt: '25131400',
  obsnPost: '25160100',
  mine: '25280600',
  line: '00000001',
  lineDotted: '00000003',
  arrow: '00000006',
  arrowDotted: '00000007',
  infilLane: '25140800',
  obstacleLine: '25290100',
  bridge: '20110701',
};

function pointInRingLocal(p: MercXY, ring: MercXY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function minutesOf(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  return m ? Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]) : 6 * 60;
}

export default class MovementGuide {
  private _opts: MovementGuideOptions = { ...DEFAULT_MOVEMENT_GUIDE_OPTIONS };
  private _enabled = false;
  private _state: 'off' | 'loading' | 'ready' | 'unavailable' = 'off';
  private _error: string | null = null;
  private _rules: Rules = rulesFrom(DOCTRINE);
  private _plRules: Rules = plRulesFrom(PL_DOCTRINE);
  private _scanner = new RouteScanner(this._rules);
  private _probe: MovementGuideProbe | null = null;
  private _map = new MovementGuideMap(() => this._getView());
  private _draw = new MovementGuideDraw(() => this._getView());
  private _cards = new MovementGuideCards({
    close: () => this.showCards(false),
    card: (id) => this.setCard(id),
    input: (what) => this._input(what),
    param: (card, key, value) => this.setParam(card, key, value),
    action: (what, arg) => this._action(what, arg),
    goTo: (x, y) => this._goTo(x, y),
  });
  private _configToken = 0;
  private _threatSource: (() => [number, number] | null) | null = null;
  private _creator: ((items: PlanSymbol[]) => any[]) | null = null;
  private _selected: (() => any | null) | null = null;

  private _card: CardId = 'cordon';
  private _open = false;
  private _route: { pts: MercXY[]; name: string } | null = null;
  private _cordonIn: { ring?: MercXY[]; point?: MercXY; name: string } | null = null;
  private _patrolIn: { start?: MercXY; obj?: MercXY } = {};
  private _infilLine: MercXY[] | null = null;
  private _waterIn: WaterInput | null = null;
  private _waterFlip = false;
  private _params: Record<CardId, Record<string, any>> = this._defaults();
  private _res: Partial<Record<CardId, { result: CardResult; pending: boolean }>> = {};
  private _status: string | null = null;
  private _drawing: { what: string; live: RouteReading | null } | null = null;
  private _dataTimer: ReturnType<typeof setTimeout> | null = null;
  private _reruns = 0;
  private _cursor = new MovementGuideCursor();
  private _waterCard = new MovementGuideWaterCard();
  private _waterStyle: WaterCardStyle = (() => {
    try {
      const v = localStorage.getItem(WATER_STYLE_KEY) as WaterCardStyle | null;
      return v && WATER_CARD_STYLES.includes(v) ? v : 'section';
    } catch {
      return 'section';
    }
  })();
  private _waterTimer: ReturnType<typeof setTimeout> | null = null;
  private _waterFull: { w: WaterReading; p: MercXY } | null = null;
  private _hoverHandles: Array<{ remove(): void }> = [];
  private _hoverView: any = null;
  private _hoverRaf = 0;
  private _hoverAt: { p: MercXY; x: number; y: number } | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly _getView: () => any) {}

  // ── state ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  get options(): Readonly<MovementGuideOptions> {
    return this._opts;
  }
  get isEnabled(): boolean {
    return this._enabled;
  }
  get isActive(): boolean {
    return this._enabled && this._state === 'ready';
  }
  get status(): { state: 'off' | 'loading' | 'ready' | 'unavailable'; error: string | null } {
    return { state: this._state, error: this._error };
  }
  get card(): CardId {
    return this._card;
  }
  get isOpen(): boolean {
    return this._open;
  }
  /** The last result of a card (null until its input is given). */
  result(card: CardId = this._card): CardResult | null {
    return this._res[card]?.result ?? null;
  }
  params(card: CardId = this._card): Readonly<Record<string, any>> {
    return this._params[card];
  }

  setOptions(patch: Partial<MovementGuideOptions> | null | undefined): void {
    if (!patch || typeof patch !== 'object') return;
    const prev = this._opts;
    const next = { ...prev };
    if (typeof patch.bundleUrl === 'string') next.bundleUrl = patch.bundleUrl.trim().replace(/\/+$/, '');
    if (typeof patch.map === 'boolean') next.map = patch.map;
    if (typeof patch.cursor === 'boolean') next.cursor = patch.cursor;
    if (typeof patch.keys === 'boolean') next.keys = patch.keys;
    if (typeof patch.useWorker === 'boolean') next.useWorker = patch.useWorker;
    if (typeof patch.cacheTiles === 'number' && patch.cacheTiles >= 64) next.cacheTiles = Math.round(patch.cacheTiles);
    if (patch.threat === 'groundGuide' || patch.threat === 'none') next.threat = patch.threat;
    this._opts = next;
    if (!this._enabled) return;
    if (next.bundleUrl !== prev.bundleUrl || next.useWorker !== prev.useWorker) void this.configure();
    else if (next.map !== prev.map || next.threat !== prev.threat) this._rerunAll();
  }

  setThreatSource(fn: (() => [number, number] | null) | null): void {
    this._threatSource = fn;
  }
  /** Names for things from the catalogue (kept for hosts that set it). */
  setCatalogNames(_fn: ((key: string) => string | null | undefined) | null): void {}
  /** How "Create on map" turns plan items into symbols (SymbolEngine passes loadSymbolFromJSON). */
  setCreator(fn: ((items: PlanSymbol[]) => any[]) | null): void {
    this._creator = fn;
  }
  /** The one selected graphic, for "Use selected". */
  setSelectionSource(fn: (() => any | null) | null): void {
    this._selected = fn;
  }

  /** On: load the bundle and open the cards. */
  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._open = true;
    this._attachKeys();
    void this.configure();
  }

  /** Off: tear everything down (window, layers, drawing, tiles, worker, timers). Drawing symbols is untouched. */
  disable(): void {
    this._enabled = false;
    this._configToken++;
    this._draw.destroy();
    this._draw = new MovementGuideDraw(() => this._getView());
    if (this._dataTimer) clearTimeout(this._dataTimer);
    this._dataTimer = null;
    this._probe?.destroy();
    this._probe = null;
    this._scanner.clear();
    this._map.destroy();
    this._cards.destroy();
    this._detachHover();
    this._cursor.destroy();
    this._waterCard.destroy();
    if (this._waterTimer) clearTimeout(this._waterTimer);
    this._waterTimer = null;
    this._waterFull = null;
    this._detachKeys();
    this._open = false;
    this._res = {};
    this._state = 'off';
    this._error = null;
  }

  destroy(): void {
    this.disable();
  }

  async configure(): Promise<boolean> {
    if (!this._enabled) return false;
    const token = ++this._configToken;
    this._probe?.destroy();
    this._scanner.clear();
    const probe = new MovementGuideProbe(() => this._onData());
    this._probe = probe;
    this._state = 'loading';
    this._error = null;
    this._refresh();
    try {
      const ok = await probe.configure(this._opts.bundleUrl, { cacheTiles: this._opts.cacheTiles, useWorker: this._opts.useWorker });
      if (token !== this._configToken) return false;
      if (!ok) throw new Error('no bundle URL set');
      this._state = 'ready';
      EngineLogger.success(ENGINE, `Terrain bundle ready for the Movement Guide (${probe.dataLine()})`);
      this._rerunAll();
      return true;
    } catch (err) {
      if (token !== this._configToken) return false;
      probe.destroy();
      if (this._probe === probe) this._probe = null;
      this._state = 'unavailable';
      this._error = (err as Error)?.message ?? String(err);
      EngineLogger.error(ENGINE, `Terrain bundle unavailable (${this._opts.bundleUrl || 'no URL'}): ${this._error}. Movement Guide idle.`);
      this._res = {};
      this._map.clear();
      this._refresh();
      return false;
    }
  }

  retry(): Promise<boolean> {
    return this.configure();
  }

  // ── the window ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Show or hide the cards. */
  showCards(open = !this._open, card?: CardId): void {
    if (!this._enabled) return;
    if (card) this._card = card;
    this._open = open;
    if (!open) {
      this._draw.cancel(false);
      this._drawing = null;
      this._cards.hide();
      this._map.clear();
      this._detachHover();
      this._cursor.hide();
      this._waterCard.hide();
      return;
    }
    this._refresh();
  }

  setCard(card: CardId): void {
    if (!CARDS.some((c) => c.id === card)) return;
    this._draw.cancel(false);
    this._drawing = null;
    this._card = card;
    this._status = null;
    this._cursor.hide(); // what it said was for the card just left
    this._waterCard.hide();
    if (!this._res[card]) this._run(card);
    this._refresh();
  }

  setParam(card: CardId, key: string, value: unknown): void {
    const spec = PARAMS[card]?.find((p) => p.key === key);
    if (!spec) return;
    let v: any = value;
    if (spec.type === 'number') {
      v = Number(value);
      if (!Number.isFinite(v)) return;
      if (spec.min !== undefined) v = Math.max(spec.min, v);
      if (spec.max !== undefined) v = Math.min(spec.max, v);
    } else if (spec.type === 'bool') v = value === true || value === 'true' || value === 'on';
    else if (spec.type === 'select') {
      if (!spec.options?.some((o) => o.value === String(value))) return;
      v = String(value);
    } else v = String(value);
    this._params[card][key] = v;
    if (card === 'water') this._waterFull = null;
    this._run(card);
    this._refresh();
  }

  // ── inputs ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Give the cards a placed graphic: a line as the route (or the infiltration line), an area or a point as the cordon. */
  useGraphic(g: any, card?: CardId): boolean {
    if (!this.isActive || !g?.geometry) return false;
    const geom = g.geometry;
    const pts = (coords: number[][]) => coords.map((c) => this._toMerc(c, geom.spatialReference)).filter((p): p is MercXY => !!p);
    const target: CardId = card ?? (geom.type === 'polyline' ? 'picket' : 'cordon');
    if (target === 'water') {
      // A point: the bank it stands on. A line: an obstacle symbol (AT Ditch, DCB) is the obstacle; any other line is an axis.
      const sidc = String(g.attributes?.amplifier?.SIDC ?? g.attributes?.sidc ?? '');
      const key = sidc.length >= 16 ? sidc.slice(4, 6) + sidc.slice(10, 16) : '';
      if (geom.type === 'point') {
        const p = this._toMerc(geom, geom.spatialReference);
        if (!p) return false;
        this._waterIn = { mode: 'point', p, name: 'placed symbol' };
      } else if (geom.type === 'polyline' && geom.paths?.[0]) {
        const path = pts(geom.paths[0]);
        if (path.length < 2) return false;
        const ty = typeOfSymbolKey(key);
        const obstacle = ty || key === '25290100' || key === '25290204';
        this._waterIn = obstacle ? { mode: 'symbol', p: path[Math.floor(path.length / 2)], pts: path, type: ty, name: 'placed obstacle' } : { mode: 'axis', pts: path, name: 'placed line' };
      } else return false;
      this._waterFlip = false;
      delete this._res.water;
      this._open = true;
      this.setCard('water');
      this._run('water');
      this._refresh();
      return true;
    }
    if (geom.type === 'polyline' && geom.paths?.[0]) {
      const ctrl = g.attributes?.drawEssentials?.CTRL_PTS;
      const path: MercXY[] = Array.isArray(ctrl) && ctrl.length >= 2 ? ctrl.map((p: any) => this._toMerc(p, geom.spatialReference)).filter((p: MercXY | null): p is MercXY => !!p) : pts(geom.paths[0]);
      if (path.length < 2) return false;
      if (target === 'infil') this._infilLine = path;
      else this._setRoute(path, 'placed line');
    } else if (geom.type === 'polygon' && geom.rings?.[0]) {
      const ring = pts(geom.rings[0]);
      if (ring.length > 3) ring.pop();
      this._cordonIn = { ring, name: 'placed area' };
      this._res.cordon = undefined;
    } else if (geom.type === 'point') {
      const p = this._toMerc(geom, geom.spatialReference);
      if (!p) return false;
      this._cordonIn = { point: p, name: 'placed symbol' };
      this._res.cordon = undefined;
    } else return false;
    this._open = true;
    this.setCard(target);
    this._runInputs();
    return true;
  }

  /** Headless: set the route ([lng, lat] points) and work out every route card. */
  setRoute(lngLats: Array<[number, number]>): void {
    if (lngLats.length >= 2) this._setRoute(lngLats.map(([a, b]) => lngLatToMerc(a, b)), 'route');
    this._runInputs();
  }
  /** Headless: the cordon round the built-up area at a point, or round a [lng, lat] ring. */
  setCordon(target: [number, number] | Array<[number, number]>): void {
    const ring = Array.isArray(target[0]);
    this._cordonIn = ring
      ? { ring: (target as Array<[number, number]>).map(([a, b]) => lngLatToMerc(a, b)), name: 'area' }
      : { point: lngLatToMerc((target as [number, number])[0], (target as [number, number])[1]), name: 'town' };
    this._res.cordon = undefined;
    this._run('cordon');
    this._refresh();
  }
  setPatrol(start: [number, number], objective: [number, number]): void {
    this._patrolIn = { start: lngLatToMerc(start[0], start[1]), obj: lngLatToMerc(objective[0], objective[1]) };
    this._run('patrol');
    this._refresh();
  }
  setInfilLine(lngLats: Array<[number, number]>): void {
    this._infilLine = lngLats.map(([a, b]) => lngLatToMerc(a, b));
    this._run('infil');
    this._refresh();
  }
  /** Headless Water card: the obstacle nearest a [lng, lat] point, home on that point's side. */
  setWater(at: [number, number]): void {
    this._setWater({ mode: 'point', p: lngLatToMerc(at[0], at[1]), name: 'point' });
  }
  /** Headless Water card: every obstacle an axis crosses, home on its start's side. */
  setWaterAxis(lngLats: Array<[number, number]>): void {
    if (lngLats.length >= 2) this._setWater({ mode: 'axis', pts: lngLats.map(([a, b]) => lngLatToMerc(a, b)), name: 'axis' });
  }
  /** Headless Water card: stations along the obstacle between two points on it. */
  setWaterReach(a: [number, number], b: [number, number]): void {
    this._setWater({ mode: 'reach', a: lngLatToMerc(a[0], a[1]), b: lngLatToMerc(b[0], b[1]), name: 'reach' });
  }
  /** Swap the Water card's home and far bank. */
  swapHome(): void {
    this._waterFlip = !this._waterFlip;
    this._run('water');
    this._refresh();
  }
  private _setWater(w: WaterInput): void {
    this._waterIn = w;
    this._waterFlip = false;
    delete this._res.water;
    this._run('water');
    this._refresh();
  }

  /** Headless: run a card now, waiting (up to `timeoutMs`) for the terrain it needs. */
  async settle(card: CardId = this._card, timeoutMs = 10000): Promise<CardResult | null> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      this._run(card);
      const r = this._res[card];
      if (!r || !r.pending || Date.now() > until) {
        this._refresh();
        return r?.result ?? null;
      }
      await new Promise((res) => setTimeout(res, 300));
    }
  }

  /** True when a placed graphic can be handed to the cards (a line, an area or a point). */
  canAnalyse(graphic: any): boolean {
    const t = graphic?.geometry?.type;
    return this.isActive && (t === 'polyline' || t === 'polygon' || t === 'point');
  }

  /** The card's brief as text (Copy as Text). */
  reportText(card: CardId = this._card): string {
    const r = this._res[card];
    return r ? cardLines(card, r.result, this._ctx(card)).join('\n') : '';
  }

  /** "Create on map": the card's plan as ordinary symbols. Returns how many were made. */
  createOnMap(card: CardId = this._card, which?: number): number {
    const r = this._res[card]?.result;
    if (!r || !this._creator) return 0;
    const items = this._symbolsFor(r, which);
    if (!items.length) return 0;
    const made = this._creator(items);
    const n = made.filter(Boolean).length;
    this._status = `Created ${n} symbol${n === 1 ? '' : 's'} on the map: edit, save or undo them like any other.`;
    EngineLogger.success(ENGINE, `${CARDS.find((c) => c.id === card)?.title}: created ${n} symbols`);
    this._refresh();
    return n;
  }

  onViewChanged(): void {
    this._draw.destroy();
    this._draw = new MovementGuideDraw(() => this._getView());
    this._map.destroy();
    this._map = new MovementGuideMap(() => this._getView());
    this._cards.hide();
    this._drawing = null;
    if (this._open) this._refresh();
  }

  // ── running the cards ──────────────────────────────────────────────────────────────────────────────────────────────

  private _defaults(): Record<CardId, Record<string, any>> {
    const R = this._rules;
    const col = (SPEEDS as any).columns ?? {};
    return {
      cordon: { mode: 'auto', menPer100m: R.cordon.menPer100m, rooftopPer100m: R.cordon.rooftopPer100m, perSideRoad: R.cordon.perSideRoad, plMen: 30, standoffM: R.cordon.standoffM, outerRingM: R.cordon.outerRingM },
      picket: { mode: 'bothSides', rangeM: R.picket.rangeM, minCoverM: R.picket.minCoverM, menPer: R.picket.menPer, roadKmh: col.foot?.speed?.[1] ?? 3, mover: 'wheeled' },
      convoy: { vehicles: R.convoy.vehicles, packetSize: R.convoy.packetSize, gapMin: R.convoy.gapMin, vehGapM: R.convoy.vehGapM, light: 'day', boundKm: R.convoy.boundKm, start: '06:00', mover: 'wheeled' },
      mines: { minScore: R.mine.minScore },
      patrol: { avoidRoads: true, avoidVillages: true, avoidWoodEdges: true, avoidSkylines: true, separateM: R.patrol.separateM },
      ambush: { kzM: R.ambush.kzM, meetingM: R.ambush.meetingM, mover: 'wheeled' },
      block: { approachM: R.block.approachM, mover: 'tracked' },
      infil: { enemySide: '-1', bandM: R.infil.bandM, rangeM: R.infil.rangeM, lanes: R.infil.lanes, maxPosts: R.infil.maxPosts },
      water: { purpose: 'cross', month: String(new Date().getMonth() + 1), type: 'auto', crossingsKm: WATER_R.crossingsKm },
    };
  }

  /** The rules with this card's settings laid over them. */
  private _rulesFor(card: CardId): Rules {
    const R = this._rules;
    const p = this._params[card];
    switch (card) {
      case 'cordon':
        return { ...R, cordon: { ...R.cordon, menPer100m: p.menPer100m, rooftopPer100m: p.rooftopPer100m, perSideRoad: p.perSideRoad, standoffM: p.standoffM, outerRingM: p.outerRingM } };
      case 'picket':
        return { ...R, picket: { ...R.picket, rangeM: p.rangeM, minCoverM: p.minCoverM, menPer: p.menPer } };
      case 'ambush':
        return { ...R, ambush: { ...R.ambush, kzM: p.kzM, meetingM: p.meetingM } };
      case 'block':
        return { ...R, block: { ...R.block, approachM: p.approachM } };
      case 'infil':
        return { ...R, infil: { ...R.infil, bandM: p.bandM, rangeM: p.rangeM, lanes: p.lanes, maxPosts: p.maxPosts } };
      default:
        return R;
    }
  }

  private _threat(): MercXY | null {
    if (this._opts.threat !== 'groundGuide') return null;
    const ll = this._threatSource?.();
    return ll ? lngLatToMerc(ll[0], ll[1]) : null;
  }

  private _scanRoute(mover: string, sight = true): RouteReading | null {
    const probe = this._probe;
    if (!probe || !this._route) return null;
    const kinds = new Set<string>(this._rules.exposure.borderKinds);
    const borders = probe.borders.filter((b) => kinds.has(b.kind));
    const r = this._scanner.scan(this._route.pts, probe, { going: probe.going(mover), sight, threat: this._threat(), borders }, probe.tick);
    if (probe.bordersLoading) r.pending = true;
    return r;
  }

  private _foot(): PlFootSpeeds {
    const f = (SPEEDS as any).movers?.foot ?? {};
    return { ground: f.ground ?? { open: [4, 3] }, road: f.road?.track ?? [4, 3], toblerA: Array.isArray(f.slope?.a) ? f.slope.a[0] : 3.5, toblerB: typeof f.slope?.b === 'number' ? f.slope.b : 0.05 };
  }

  /** Work out one card from its input; leaves no result when the input is missing. */
  private _run(card: CardId): void {
    const probe = this._probe;
    if (!probe || !this.isActive) return;
    const R = this._rulesFor(card);
    const p = this._params[card];
    const foot = probe.going('dismounted');
    let result: CardResult | null = null;
    let pending = false;
    try {
      switch (card) {
        case 'cordon': {
          const inp = this._cordonIn;
          if (!inp) break;
          let ring = inp.ring ?? null;
          let derived: CordonReading['derived'] = 'drawn';
          if (!ring && inp.point) {
            probe.focus(inp.point[1]);
            const b = buaRingAround(inp.point, probe, R);
            pending = !!b?.pending;
            if (b && b.ring.length >= 3) {
              ring = b.ring;
              derived = 'bua';
            } else {
              ring = circleRing(inp.point, R.cordon.fallbackRadiusM);
              derived = 'circle';
            }
          }
          const reading = cordonPlan(ring!, derived, probe, R);
          if (p.mode !== 'auto') {
            // The user knows the ground: recount as built-up or rural.
            const urban = p.mode === 'urban';
            if (urban !== reading.urban) {
              const forced = cordonPlan(ring!, derived, probe, { ...R, cordon: { ...R.cordon, urbanShare: urban ? 0 : 2 } });
              Object.assign(reading, forced);
            }
          }
          pending = pending || reading.pending;
          const layout = cordonSectors(reading, R, p.plMen);
          const area = reading.areaKm2;
          const c0 = reading.ring.reduce((a, q) => [a[0] + q[0] / reading.ring.length, a[1] + q[1] / reading.ring.length], [0, 0]) as MercXY;
          const ages = reading.people !== null ? probe.agesFor(c0, Math.sqrt(area / Math.PI), reading.people) : null;
          result = { card, reading, layout, ages };
          break;
        }
        case 'picket': {
          const route = this._scanRoute(p.mover);
          if (!route) break;
          const plan = planPickets(route, probe, R, p.mode, foot);
          const footKmh = ((SPEEDS as any).columns?.foot?.speed?.[1] as number) ?? 3;
          const timings = picketTimings(plan.pickets, { roadKmh: p.roadKmh, footKmh });
          const clear = clearanceOrder(route);
          const st = route.stations;
          const ends: Array<{ where: string; at: MercXY }> = [
            { where: 'start', at: [st[0].x, st[0].y] },
            { where: 'end', at: [st[st.length - 1].x, st[st.length - 1].y] },
          ];
          const cv = casevacFor(ends.map((e) => e.at), probe, R);
          result = { card, route, plan, timings, checkPosts: checkPosts(route, R), clear, casevac: cv.map((c, i) => ({ where: ends[i].where, c })) };
          pending = route.pending || plan.pending;
          break;
        }
        case 'convoy': {
          const route = this._scanRoute(p.mover);
          if (!route) break;
          const col = (SPEEDS as any).columns?.wheeled ?? {};
          const speed = p.light === 'night' ? (col.speed?.[1] ?? R.convoy.speedNightKmh) : (col.speed?.[0] ?? R.convoy.speedDayKmh);
          const plan = convoyPlan(route, {
            vehicles: p.vehicles,
            packetSize: p.packetSize,
            gapMin: p.gapMin,
            vehGapM: p.vehGapM,
            speedKmh: speed,
            boundKm: p.boundKm,
            startMin: minutesOf(p.start),
            haltEveryMin: col.halt?.everyMin ?? R.convoy.haltEveryMin,
            haltMin: col.halt?.forMin ?? R.convoy.haltMin,
          });
          result = { card, route, plan };
          pending = route.pending;
          break;
        }
        case 'mines': {
          const route = this._scanRoute('wheeled');
          if (!route) break;
          result = { card, route, sites: likelyMineSites(route, p.minScore) };
          pending = route.pending;
          break;
        }
        case 'patrol': {
          const { start, obj } = this._patrolIn;
          if (!start || !obj) break;
          const threat = this._threat();
          const routes = planPatrol(probe, R, start, obj, { foot, avoidRoads: p.avoidRoads, avoidVillages: p.avoidVillages, avoidWoodEdges: p.avoidWoodEdges, avoidSkylines: p.avoidSkylines, threat, separateM: p.separateM });
          pending = routes.pending;
          const footScanner = this._scanner;
          const kinds = new Set<string>(this._rules.exposure.borderKinds);
          const borders = probe.borders.filter((b) => kinds.has(b.kind));
          const ctx = {
            foot,
            speeds: this._foot(),
            threat,
            classLabel: (c: number) => probe.classLabel(c),
            scanRoad: (path: MercXY[], sight: boolean, th?: MercXY | null) => footScanner.scan(path, probe, { going: foot, sight, threat: th ?? null, borders }, probe.tick),
          };
          const out = routes.out ? patrolCard(probe, this._plRules, routes.out, ctx) : null;
          const back = routes.back ? patrolCard(probe, this._plRules, routes.back, ctx) : null;
          pending = pending || !!out?.pending || !!back?.pending;
          result = { card, routes, out, back };
          break;
        }
        case 'ambush': {
          const route = this._scanRoute(p.mover);
          if (!route) break;
          const prev = this._res.ambush?.result as Extract<CardResult, { card: 'ambush' }> | undefined;
          result = { card, route, sites: ambushSites(route, probe, R, foot), chosen: prev?.chosen ?? 0 };
          pending = route.pending || !!probe.takePending();
          break;
        }
        case 'block': {
          const route = this._scanRoute(p.mover);
          if (!route) break;
          const prev = this._res.block?.result as Extract<CardResult, { card: 'block' }> | undefined;
          result = { card, route, sites: roadBlockSites(route, probe, R, foot), chosen: prev?.chosen ?? 0 };
          pending = route.pending || !!probe.takePending();
          break;
        }
        case 'infil': {
          if (!this._infilLine || this._infilLine.length < 2) break;
          const reading = infiltrationLanes(probe, R, this._infilLine, Number(p.enemySide) < 0 ? -1 : 1, foot);
          result = { card, reading };
          pending = reading.pending;
          break;
        }
        case 'water': {
          const w = this._waterIn;
          if (!w) break;
          const opts: WaterOpts = {
            purpose: p.purpose === 'hold' ? 'hold' : 'cross',
            month: Number(p.month) || new Date().getMonth() + 1,
            type: p.type as WaterTypeId | 'auto',
            threat: this._threat(),
            flipHome: this._waterFlip,
            crossingsKm: Number(p.crossingsKm) || WATER_R.crossingsKm,
          };
          const prev = this._res.water?.result as Extract<CardResult, { card: 'water' }> | undefined;
          if (w.mode === 'axis') {
            const axis = readAxis(probe, WATER_R, w.pts, opts);
            const chosen = Math.min(prev?.mode === 'axis' ? prev.chosen : 0, Math.max(0, axis.obstacles.length - 1));
            result = { card, mode: 'axis', reading: axis.obstacles[chosen]?.reading ?? null, axis, reach: null, chosen };
            pending = axis.pending;
          } else if (w.mode === 'reach') {
            const reach = readReach(probe, WATER_R, w.a, w.b, opts);
            const reading = readWater(probe, WATER_R, w.a, opts);
            result = { card, mode: 'reach', reading, axis: null, reach, chosen: 0 };
            pending = !!reach?.pending || !!reading?.pending;
          } else {
            const line = w.mode === 'symbol' ? { pts: w.pts, type: w.type, name: w.type ? typeDef(WATER_R, w.type).label : 'Obstacle line' } : null;
            const reading = readWater(probe, WATER_R, w.p, { ...opts, line });
            result = { card, mode: 'point', reading, axis: null, reach: null, chosen: 0 };
            pending = !!reading?.pending || !!probe.takePending();
          }
          break;
        }
      }
    } catch (err) {
      EngineLogger.error(ENGINE, `${card}: ${(err as Error)?.message ?? err}`);
      result = null;
    }
    if (result) this._res[card] = { result, pending };
    else delete this._res[card];
  }

  private _rerunAll(): void {
    for (const c of CARDS) if (this._res[c.id] || c.id === this._card) this._run(c.id);
    this._refresh();
  }

  /** Every card whose input is now given. */
  private _runInputs(): void {
    for (const c of CARDS) {
      if (c.input === 'route' && this._route && (c.id === this._card || this._res[c.id])) this._run(c.id);
    }
    this._run(this._card);
    this._refresh();
  }

  private _setRoute(pts: MercXY[], name: string): void {
    this._route = { pts, name };
    for (const c of CARDS) if (c.input === 'route') delete this._res[c.id];
  }

  /** Data arrived: work out again the cards that met data still loading (a few times at most). */
  private _onData(): void {
    if (this._dataTimer) return;
    if (!Object.values(this._res).some((r) => r?.pending)) return;
    if (++this._reruns > MAX_RERUNS * 4) return;
    this._dataTimer = setTimeout(() => {
      this._dataTimer = null;
      let any = false;
      for (const c of CARDS) {
        if (this._res[c.id]?.pending) {
          this._run(c.id);
          any = true;
        }
      }
      if (any) this._refresh();
      if (!Object.values(this._res).some((r) => r?.pending)) this._reruns = 0;
    }, 300);
  }

  // ── user actions from the window ───────────────────────────────────────────────────────────────────────────────────

  private _input(what: string): void {
    if (!this.isActive) return;
    const card = this._card;
    const start = (kind: DrawKind, prompt: string, done: (pts: MercXY[]) => void, live = false) => {
      this._drawing = { what, live: null };
      this._draw.start({
        kind,
        prompt,
        onStatus: (t) => {
          this._status = t;
          this._refresh();
        },
        onMove: live
          ? (pts) => {
              if (!this._probe || pts.length < 2) return;
              const r = this._scanner.scan(pts, this._probe, { going: this._probe.going('wheeled'), sight: false, stationM: this._rules.scan.liveStationM }, this._probe.tick);
              if (this._drawing) this._drawing.live = r;
              this._showMap();
            }
          : undefined,
        onDone: (pts) => {
          this._drawing = null;
          done(pts);
        },
        onCancel: () => {
          this._drawing = null;
          this._refresh();
        },
      });
      this._refresh();
    };
    switch (what) {
      case 'drawRoute':
        start('line', 'Draw the route: click along it, double-click or Enter to finish, Backspace to undo, Esc to stop', (pts) => {
          this._setRoute(pts, 'drawn route');
          this._runInputs();
        }, true);
        break;
      case 'drawArea':
        start('area', 'Draw the area to cordon: click round it, double-click or Enter to close', (ring) => {
          this._cordonIn = { ring, name: 'drawn area' };
          this._res.cordon = undefined;
          this._run('cordon');
          this._refresh();
        });
        break;
      case 'pickTown':
        start('point', 'Click the town or village to cordon', (pts) => {
          this._cordonIn = { point: pts[0], name: 'town' };
          this._res.cordon = undefined;
          this._run('cordon');
          this._refresh();
        });
        break;
      case 'patrolStart':
        start('point', 'Click the patrol\'s start point (the FUP / harbour / gate)', (pts) => {
          this._patrolIn.start = pts[0];
          if (!this._patrolIn.obj) this._input('patrolObj');
          else {
            this._run('patrol');
            this._refresh();
          }
        });
        break;
      case 'patrolObj':
        start('point', 'Click the patrol\'s objective', (pts) => {
          this._patrolIn.obj = pts[0];
          this._run('patrol');
          this._refresh();
        });
        break;
      case 'drawLine':
        start('line', 'Draw the line to watch (border, LoC or own line): click along it, double-click to finish', (pts) => {
          this._infilLine = pts;
          this._run('infil');
          this._refresh();
        });
        break;
      case 'waterPoint':
        start('point', 'Click on your own bank beside the water (the side you click is home)', (pts) => this._setWater({ mode: 'point', p: pts[0], name: 'clicked bank' }));
        break;
      case 'waterAxis':
        start('line', 'Draw the axis from your side across the water: click along it, double-click or Enter to finish', (pts) => this._setWater({ mode: 'axis', pts, name: 'drawn axis' }));
        break;
      case 'waterReach':
        start('line', 'Click two points along the obstacle (on your own bank), then double-click or Enter', (pts) => {
          if (pts.length >= 2) this._setWater({ mode: 'reach', a: pts[0], b: pts[pts.length - 1], name: 'reach' });
        });
        break;
      case 'useSelected': {
        const g = this._selected?.();
        if (!g || !this.useGraphic(g, card)) {
          this._status = card === 'water' ? 'Select one point (on a bank), one obstacle line (AT Ditch, DCB) or one axis line first.' : 'Select one line (a route) or one area / point (a cordon) first.';
          this._refresh();
        }
        break;
      }
      case 'stopDrawing':
        this._draw.cancel();
        break;
    }
  }

  private _action(what: string, arg?: unknown): void {
    const card = this._card;
    switch (what) {
      case 'create':
        if (!this._creator) {
          this._status = 'Creating symbols needs the symbol engine.';
          this._refresh();
        } else if (!this.createOnMap(card)) {
          this._status = 'Nothing to create yet: give the card its input first.';
          this._refresh();
        }
        break;
      case 'copy': {
        const txt = this.reportText(card);
        if (!txt) return;
        void navigator.clipboard?.writeText(txt).then(
          () => {
            this._status = 'Brief copied.';
            this._refresh();
          },
          () => {
            this._status = 'Copy failed (the browser refused the clipboard).';
            this._refresh();
          },
        );
        break;
      }
      case 'clear':
        this._clearCard(card);
        break;
      case 'choose': {
        const r = this._res[card]?.result as any;
        if (r && (r.card === 'ambush' || r.card === 'block')) {
          r.chosen = Math.max(0, Math.min(r.sites.length - 1, Number(arg) || 0));
          this._refresh();
        } else if (r?.card === 'water' && r.axis) {
          r.chosen = Math.max(0, Math.min(r.axis.obstacles.length - 1, Number(arg) || 0));
          r.reading = r.axis.obstacles[r.chosen]?.reading ?? null;
          this._refresh();
        }
        break;
      }
      case 'swapHome':
        this.swapHome();
        break;
      case 'retry':
        void this.configure();
        break;
    }
  }

  private _clearCard(card: CardId): void {
    const def = CARDS.find((c) => c.id === card)!;
    if (def.input === 'route') {
      this._route = null;
      for (const c of CARDS) if (c.input === 'route') delete this._res[c.id];
    } else if (def.input === 'cordon') {
      this._cordonIn = null;
      delete this._res.cordon;
    } else if (def.input === 'patrol') {
      this._patrolIn = {};
      delete this._res.patrol;
    } else if (def.input === 'water') {
      this._waterIn = null;
      this._waterFlip = false;
      delete this._res.water;
    } else {
      this._infilLine = null;
      delete this._res.infil;
    }
    this._status = null;
    this._refresh();
  }

  // ── presenting ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private _ctx(card: CardId) {
    return {
      def: CARDS.find((c) => c.id === card)!,
      params: this._params[card],
      dataLine: this._probe?.dataLine() ?? '',
      threatSet: !!this._threat(),
      pending: !!this._res[card]?.pending,
      routeName: this._route?.name ?? null,
      inputName: card === 'cordon' ? (this._cordonIn?.name ?? null) : null,
    };
  }

  private _refresh(): void {
    if (!this._enabled || !this._open) return;
    const host = this._getView()?.container as HTMLElement | null;
    this._cards.mount(host);
    this._cards.attachGrip();
    this._attachHover();
    const card = this._card;
    const r = this._res[card];
    this._cards.render({
      state: this._state,
      error: this._error,
      card,
      result: r?.result ?? null,
      pending: !!r?.pending,
      status: this._status,
      drawing: this._draw.active,
      inputs: {
        route: this._route ? { name: this._route.name, pts: this._route.pts.length } : null,
        cordon: this._cordonIn ? this._cordonIn.name : null,
        patrolStart: !!this._patrolIn.start,
        patrolObj: !!this._patrolIn.obj,
        infil: !!this._infilLine,
        water: this._waterIn ? this._waterIn.name : null,
      },
      ctx: this._ctx(card),
      elevAt: (p) => this._probe?.elev(p[0], p[1]) ?? NaN,
      infilLine: this._infilLine,
      waterRules: WATER_R,
    });
    this._showMap();
  }

  // ── keys ───────────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * N opens / closes the Mov Detail; while it is open, 1-8 switch its cards and the same number again turns the
   * band's page (Shift turns back; past the last page it starts again); Esc closes it (a draw in progress takes Esc
   * first). Digits are the Mov Guide's only while its card is open, so the Ground Guide's Extended View 1-3 work otherwise.
   */
  private _attachKeys(): void {
    if (this._keyHandler || !this._opts.keys) return;
    this._keyHandler = (e: KeyboardEvent) => {
      if (!this._enabled || e.ctrlKey || e.metaKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName))) return;
      const k = e.key.toLowerCase();
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };
      if (k === 'n' && !e.repeat) {
        stop();
        this.showCards(!this._open);
        return;
      }
      if (!this._open) return;
      if (k === 'escape') {
        if (this._draw.active) return; // the draw tool stops first
        stop();
        this.showCards(false);
        return;
      }
      // Q: the Water cursor card's next style (only while the Water card is open).
      if (k === 'q' && this._card === 'water' && !e.repeat) {
        stop();
        this.setWaterCardStyle(WATER_CARD_STYLES[(WATER_CARD_STYLES.indexOf(this._waterStyle) + (e.shiftKey ? WATER_CARD_STYLES.length - 1 : 1)) % WATER_CARD_STYLES.length]);
        return;
      }
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && Number(digit[1]) > CARDS.length) return;
      if (!digit || e.repeat) return;
      stop();
      const card = CARDS[Number(digit[1]) - 1].id;
      if (card !== this._card) {
        this.setCard(card);
        return;
      }
      // The Water card: the same number walks its pages, then its lenses (Shift back).
      if (card === 'water' && this._cards.walkLens(e.shiftKey ? -1 : 1)) return;
      if (!this._cards.turn(e.shiftKey ? -1 : 1) && !e.shiftKey) {
        while (this._cards.turn(-1)) {
          /* back to the first page */
        }
      }
    };
    window.addEventListener('keydown', this._keyHandler, true);
  }

  private _detachKeys(): void {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler, true);
    this._keyHandler = null;
  }

  // ── the cursor card ────────────────────────────────────────────────────────────────────────────────────────────────

  private _attachHover(): void {
    const view = this._getView();
    if (!view || !this._opts.cursor) return;
    if (this._hoverView === view && this._hoverHandles.length) return;
    this._detachHover();
    this._hoverView = view;
    this._hoverHandles.push(
      view.on('pointer-move', (e: any) => {
        // Over the Mov Detail (or any panel laid on the map) the card has nothing to say.
        const tgt = e.native?.target as HTMLElement | undefined;
        if (tgt?.closest?.('.mgd, .mgx')) {
          this._cursor.hide();
          this._waterCard.hide();
          return;
        }
        const mp = view.toMap({ x: e.x, y: e.y });
        const p = mp ? this._toMerc(mp, mp.spatialReference) : null;
        if (!p) {
          this._cursor.hide();
          return;
        }
        this._hoverAt = { p, x: e.x, y: e.y };
        if (this._hoverRaf) return;
        this._hoverRaf = requestAnimationFrame(() => {
          this._hoverRaf = 0;
          this._hoverNow();
        });
      }),
      view.on('pointer-leave', () => {
        this._cursor.hide();
        this._waterCard.hide();
        if (this._waterTimer) clearTimeout(this._waterTimer);
        this._waterTimer = null;
      }),
    );
  }

  private _detachHover(): void {
    for (const h of this._hoverHandles) h.remove();
    this._hoverHandles = [];
    this._hoverView = null;
    if (this._hoverRaf) cancelAnimationFrame(this._hoverRaf);
    this._hoverRaf = 0;
  }

  private _hoverNow(): void {
    const h = this._hoverAt;
    if (!h || !this._open || !this._opts.cursor || !this.isActive) {
      this._cursor.hide();
      this._waterCard.hide();
      return;
    }
    // The Water card has its own cursor card; the small one stays for drawing and for ground with no water near.
    if (this._card === 'water' && !this._drawing && this._waterHover(h)) {
      this._cursor.hide();
      return;
    }
    this._waterCard.hide();
    let info: HoverInfo | null = null;
    try {
      info = this._hover(h.p);
    } catch {
      info = null;
    }
    if (!info) this._cursor.hide();
    else this._cursor.show(this._getView()?.container ?? null, h.x, h.y, info, this._cards.topClear + 4);
  }

  /** The Water cursor card's style (Q cycles it; kept for next time). */
  get waterCardStyle(): WaterCardStyle {
    return this._waterStyle;
  }
  setWaterCardStyle(style: WaterCardStyle): void {
    if (!WATER_CARD_STYLES.includes(style)) return;
    this._waterStyle = style;
    try {
      localStorage.setItem(WATER_STYLE_KEY, style);
    } catch {
      /* storage blocked */
    }
    this._status = `Water cursor card: ${style} (Q for the next)`;
    if (this._waterFull && this._hoverAt) this._showWaterCard(this._waterFull.w, this._hoverAt, false);
    this._refresh();
  }

  /**
   * The Water cursor card at the pointer: a quick read as it moves (the type, name and width of the water within
   * ~36 px), the full reading once it rests 350 ms (home being the pointer's side). False when no water is near.
   */
  private _waterHover(h: { p: MercXY; x: number; y: number }): boolean {
    const probe = this._probe;
    const view = this._getView();
    if (!probe || !view) return false;
    const resM = Number(view.resolution) > 0 ? Number(view.resolution) : 10;
    const near = Math.max(80, Math.min(400, 40 * resM));
    const q = quickWater(probe, WATER_R, h.p, near);
    if (this._waterTimer) clearTimeout(this._waterTimer);
    this._waterTimer = null;
    if (!q) {
      this._waterCard.hide();
      return false;
    }
    const container = view.container as HTMLElement | null;
    const r = container?.getBoundingClientRect();
    this._waterCard.moveTo((r?.left ?? 0) + h.x, (r?.top ?? 0) + h.y);
    // The same obstacle as the last full reading, near it: keep that card (dimmed) while the mouse moves.
    const f = this._waterFull;
    const same = f && f.w.type === q.type && (f.w.name ?? '') === (q.name ?? '') && Math.hypot(f.p[0] - h.p[0], f.p[1] - h.p[1]) < 600;
    if (same) this._showWaterCard(f!.w, h, true);
    else {
      const wv = q.width.v !== null ? `${Math.round(q.width.v)} m${q.width.src === 'pamphlet' ? ' (IBB typical)' : ''}` : 'not recorded';
      this._waterCard.quick({ label: q.label, annex: q.annex, name: q.name, width: wv, distM: q.distM }, { keys: this._opts.keys });
    }
    this._waterTimer = setTimeout(() => {
      this._waterTimer = null;
      if (!this.isActive || this._card !== 'water' || this._hoverAt !== h) return;
      const p = this._params.water;
      const w = readWater(probe, WATER_R, h.p, {
        purpose: p.purpose === 'hold' ? 'hold' : 'cross',
        month: Number(p.month) || new Date().getMonth() + 1,
        type: p.type as WaterTypeId | 'auto',
        threat: this._threat(),
        homeHint: h.p,
        snapM: near,
        crossingsKm: Number(p.crossingsKm) || WATER_R.crossingsKm,
      });
      if (!w) return;
      this._waterFull = { w, p: h.p };
      this._showWaterCard(w, h, false);
      // Tiles still on their way: read again once they are in.
      if (w.pending) this._waterTimer = setTimeout(() => this._hoverAt === h && this._hoverNow(), 700);
    }, 350);
    return true;
  }

  private _showWaterCard(w: WaterReading, h: { p: MercXY }, moving: boolean): void {
    const view = this._getView();
    this._waterCard.show(w, WATER_R, {
      style: this._waterStyle,
      pointer: h.p,
      km: Number(this._params.water.crossingsKm) || WATER_R.crossingsKm,
      northDeg: screenNorth(view),
      keys: this._opts.keys,
      moving,
    });
  }

  /** Headless: what the cursor card says at a [lng, lat] point (for hosts and tests). */
  hoverAt(lng: number, lat: number): HoverInfo | null {
    return this.isActive ? this._hover(lngLatToMerc(lng, lat)) : null;
  }

  /** What is under the pointer for the open card. */
  private _hover(p: MercXY): HoverInfo | null {
    const probe = this._probe;
    const view = this._getView();
    if (!probe || !view) return null;
    const resM = Number(view.resolution) > 0 ? Number(view.resolution) : 10;
    const nearM = 36 * resM; // Web Mercator metres within ~36 px
    const card = this._card;
    const def = CARDS.find((c) => c.id === card)!;
    const r = this._res[card]?.result ?? null;
    const d2 = (a: MercXY, b: MercXY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const segD = (q: MercXY, a: MercXY, b: MercXY) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy || 1;
      const tt = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2));
      return Math.hypot(q[0] - (a[0] + tt * dx), q[1] - (a[1] + tt * dy));
    };
    const kmOf = (m: number) => `${(m / 1000).toFixed(2)} km`;
    const hh = (min: number) => {
      const v = ((Math.round(min) % 1440) + 1440) % 1440;
      return `${String(Math.floor(v / 60)).padStart(2, '0')}${String(v % 60).padStart(2, '0')}`;
    };

    // While drawing a route: the route so far.
    if (this._drawing) {
      const live = this._drawing.live;
      if (!live) return { title: 'Drawing', colour: '#22d3ee', lines: [{ v: 'Click to add points; double-click or Enter to finish' }] };
      const c = live.counts;
      const worst = live.stretches.reduce((m, s) => Math.max(m, s.score), 0);
      const words = [c.ambush && `${c.ambush} ambush`, c.mine && `${c.mine} mine`, c.vp && `${c.vp} VP`, c.block && `${c.block} block`, c.bua && `${c.bua} BUA`].filter(Boolean).join(', ');
      return {
        title: `Route so far ${(live.lengthM / 1000).toFixed(2)} km`,
        colour: vband(worst),
        lines: [{ k: 'Risk', v: live.risk.toUpperCase(), c: vband(worst) }, { k: 'Dangers', v: words || 'none yet' }],
        strip: this._stripOf(live, live.lengthM),
        hint: 'Double-click or Enter finishes',
      };
    }

    // Route cards: the station under the pointer.
    if (r && 'route' in r && r.route) {
      const st = r.route.stations;
      let best = st[0];
      let bd = Infinity;
      for (const s of st) {
        const d = d2(p, [s.x, s.y]);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      if (best && bd <= nearM) {
        const m = best.chainM;
        const here = r.route.stretches.filter((s) => m >= s.fromM && m <= s.toM).sort((a, b) => b.score - a.score);
        const worst = here[0]?.score ?? 0;
        const lines: HoverInfo['lines'] = here.slice(0, 3).map((s) => ({ v: `${s.label}: ${s.why}`, c: vband(s.score) }));
        if (!lines.length) lines.push({ v: 'No danger read here', c: '#3fb27f' });
        if (r.card === 'picket') {
          const by = r.plan.pickets.map((k, i) => ({ k, i })).filter(({ k }) => m >= k.coversFromM - 50 && m <= k.coversToM + 50);
          lines.push(by.length ? { k: 'Seen by', v: by.map(({ k, i }) => `P${i + 1} ${k.side}`).join(', ') } : { k: 'Seen by', v: 'no picket: a gap to patrol', c: '#e5484d' });
        } else if (r.card === 'convoy') {
          const b = r.plan.bounds.find((q) => m >= q.fromM && m <= q.toM);
          const halt = (SPEEDS as any).columns?.wheeled?.halt ?? {};
          const mpm = (r.plan.speedKmh * 1000) / 60;
          const at = (start: number) => {
            const run = m / mpm;
            return start + run + (halt.everyMin ? Math.floor(run / halt.everyMin) * (halt.forMin ?? 15) : 0);
          };
          const last = r.plan.packets[r.plan.packets.length - 1];
          if (b) lines.push({ k: 'Bound', v: `B${b.n} (${kmOf(b.fromM)}-${kmOf(b.toM)})` });
          lines.push({ k: 'Packets', v: `first ${hh(at(r.plan.packets[0].spMin))}, last ${hh(at(last.spMin + last.passMin))}` });
        } else if (r.card === 'mines') {
          const ms = r.sites.find((q) => Math.abs(q.chainM - m) < 120);
          if (ms) lines.unshift({ k: `Site ${ms.rank}`, v: ms.why, c: vband(ms.score) });
        } else if (r.card === 'ambush') {
          const site = r.sites.find((q) => Math.abs(q.chainM - m) < 250);
          if (site) lines.unshift({ k: `Site ${site.rank}`, v: `score ${site.score} · ${site.layout.shape} layout`, c: vband(site.score) });
        } else if (r.card === 'block') {
          const site = r.sites.find((q) => Math.abs(q.chainM - m) < 250);
          if (site) lines.unshift({ k: `Site ${site.rank}`, v: `score ${site.score} · ${site.positions.length} flanking Posns`, c: vband(site.score) });
        }
        return { title: `${kmOf(m)} along the route`, colour: worst ? vband(worst) : '#3fb27f', lines, strip: this._stripOf(r.route, r.route.lengthM, m) };
      }
    }

    // Cordon: a road block, the sector, inside or outside.
    if (r?.card === 'cordon') {
      const c = r.reading;
      const rb = c.exits.findIndex((q) => d2(p, q) <= nearM);
      if (rb >= 0) return { title: `Road block ${rb + 1}`, colour: '#e5484d', lines: [{ v: `${this._rules.cordon.roadBlockMen} men on the exit, ${this._params.cordon.outerRingM} m out` }] };
      const inside = pointInRingLocal(p, c.ring);
      let sec = r.layout.sectors[0];
      let sd = Infinity;
      for (const s of r.layout.sectors) {
        const d = d2(p, [s.x, s.y]);
        if (d < sd) {
          sd = d;
          sec = s;
        }
      }
      const lines: HoverInfo['lines'] = [];
      if (sec && c.urban) lines.push({ k: 'Sector', v: `${sec.label}: ${sec.men} men${sec.rooftop ? ' + rooftop Sec' : ''}` });
      const per = probe.people(p[0], p[1]);
      if (per !== null) lines.push({ k: 'People', v: `${Math.round(per).toLocaleString('en')} a km²` });
      return { title: inside ? 'Inside the cordon' : 'Outside the cordon', colour: inside ? '#4d8fd6' : '#8a96a3', lines };
    }

    // Patrol: the leg under the pointer.
    if (r?.card === 'patrol') {
      for (const [name, c] of [['out', r.out], ['in', r.back]] as const) {
        if (!c) continue;
        for (const l of c.legs) {
          if (segD(p, l.from, l.to) > nearM) continue;
          return {
            title: `Leg ${l.i + 1} (route ${name})`,
            colour: name === 'out' ? '#22d3ee' : '#f28c28',
            lines: [
              { k: 'Bearing', v: `${String(Math.round(l.bearingDeg)).padStart(3, '0')}° grid` },
              { k: 'Distance', v: `${Math.round(l.distM)} m · ${l.paces.toLocaleString('en')} paces` },
              { k: 'Time', v: `${Math.round(l.minNight)} min night · ${Math.round(l.minDay)} min day` },
              { k: 'Ends at', v: l.endFeature ? `${l.endFeature.label}${l.endFeature.name ? ` (${l.endFeature.name})` : ''}` : 'no landmark: count paces' },
            ],
          };
        }
      }
    }

    // Infil: a lane or a post.
    if (r?.card === 'infil') {
      for (const l of r.reading.lanes) {
        for (let i = 0; i + 1 < l.path.length; i++) {
          if (segD(p, l.path[i], l.path[i + 1]) <= nearM) return { title: `Lane ${l.n}`, colour: '#e5484d', lines: [{ k: 'Crosses', v: l.where }, { k: 'Length', v: `${(l.lengthM / 1000).toFixed(1)} km across the band` }, { k: 'Seen now', v: `${l.seenPct} %` }] };
        }
      }
      const post = r.reading.posts.find((q) => d2(p, [q.x, q.y]) <= nearM);
      if (post) return { title: post.source === 'new' ? `New post P${post.n}` : 'Existing post', colour: post.source === 'new' ? '#4d8fd6' : '#8a96a3', lines: [{ v: post.name ?? (post.source === 'new' ? `Sees ${post.coversPct} % of the lanes` : 'in the data') }] };
    }

    // Water: a crossing of the reading, else the obstacle under the pointer (a quick read: type, name, width).
    if (card === 'water') {
      const w = r?.card === 'water' ? r.reading : null;
      const xg = w?.crossings.find((q) => d2(p, [q.x, q.y]) <= nearM);
      if (xg) {
        return {
          title: `${xg.label}${xg.name ? ` ${xg.name}` : ''}`,
          colour: xg.tankable ? '#3fb27f' : '#f28c28',
          lines: [
            ...(xg.load ? [{ k: 'Load', v: xg.load }] : []),
            ...(xg.months ? [{ k: 'In use', v: `${xg.months}${xg.inUseNow === false ? ' (not this month)' : xg.inUseNow ? ' (this month)' : ''}`, c: xg.inUseNow === false ? '#e5484d' : undefined }] : []),
            ...(xg.boats ? [{ k: 'Boats', v: xg.boats }] : []),
            { k: 'From the section', v: `${kmOf(xg.distM)} ${xg.dir}` },
          ],
        };
      }
      const q = quickWater(probe, WATER_R, p, Math.max(60, nearM));
      const picking = this._draw.active;
      if (q) {
        const wv = q.width.v !== null ? `${Math.round(q.width.v)} m${q.width.src === 'pamphlet' ? ' (IBB typical)' : ''}` : 'not recorded';
        return {
          title: `${q.annex ? `${q.annex}. ` : ''}${q.label}`,
          colour: '#22d3ee',
          lines: [...(q.name ? [{ k: 'Name', v: q.name }] : []), { k: 'Width', v: wv }],
          hint: picking ? 'Click on your own bank, a little off the water' : !w ? 'Click the Bank on the card, then here' : undefined,
        };
      }
      if (picking) return { title: 'No water here', colour: '#8a96a3', lines: [{ v: `Move within ${WATER_R.snapM} m of a canal, river or drain` }] };
    }

    // Anywhere else: the ground, the people, the nearest place.
    const cls = probe.cls(p[0], p[1]);
    const per = probe.people(p[0], p[1]);
    const place = probe.features(p[0], p[1], 3000, new Set<string>(this._rules.bua.placeKinds))[0] ?? null;
    const lines: HoverInfo['lines'] = [];
    if (cls !== null) lines.push({ k: 'Ground', v: probe.classLabel(cls) });
    if (per !== null) lines.push({ k: 'People', v: `${Math.round(per).toLocaleString('en')} a km²` });
    if (place) lines.push({ k: 'Near', v: `${place.name ?? place.label} ${place.distM < 1000 ? `${Math.round(place.distM)} m` : `${(place.distM / 1000).toFixed(1)} km`}` });
    const picking = this._draw.active && card === 'cordon';
    const key = CARDS.findIndex((c) => c.id === card) + 1;
    return {
      title: picking ? `Click to cordon${place?.name ? ` ${place.name}` : ' here'}` : `${def.label} (key ${key})`,
      colour: cls === 3 ? '#a78bfa' : '#8a96a3',
      lines,
      hint: !r && !picking ? this._needs(def.input) : undefined,
    };
  }

  private _needs(input: CardInput): string {
    return input === 'route' ? 'Draw Route on the card' : input === 'cordon' ? 'Click a Town on the card' : input === 'patrol' ? 'Click Start and Objective on the card' : input === 'water' ? 'Click the Bank on the card' : 'Draw Line on the card';
  }

  private _stripOf(route: RouteReading, L: number, at?: number): HoverInfo['strip'] {
    const runs: Array<{ from: number; to: number; c: string }> = [];
    for (const s of route.stretches) if (s.score >= 30) runs.push({ from: s.fromM / L, to: s.toM / L, c: vband(s.score) });
    // Worst on top.
    runs.sort((a, b) => (a.c === '#e5484d' ? 1 : 0) - (b.c === '#e5484d' ? 1 : 0));
    return { at: (at ?? L) / Math.max(1, L), runs };
  }

  private _showMap(): void {
    if (!this._enabled || !this._open || !this._opts.map) return;
    const card = this._card;
    const r = this._res[card]?.result ?? null;
    const p: MovMapProducts = {};
    const lines: MovMapLine[] = [];
    const marks: MovMapMark[] = [];
    if (this._drawing?.live) p.route = { stations: this._drawing.live.stations, stretches: this._drawing.live.stretches };
    else if (r) {
      switch (r.card) {
        case 'cordon': {
          p.cordon = r.reading;
          r.layout.sectors.forEach((s) => marks.push({ at: [s.x, s.y], t: String(s.n), c: MG_BLUE, title: `${s.label}: ${Math.round(s.toM - s.fromM)} m, ${s.men} men` }));
          r.layout.posts.filter((q) => q.kind === 'rooftop').forEach((q) => marks.push({ at: [q.x, q.y], t: 'R', c: MG_VIOLET, shape: 'square', title: q.label }));
          break;
        }
        case 'picket':
          p.route = { stations: r.route.stations, stretches: r.route.stretches };
          p.pickets = r.plan.pickets;
          p.gaps = r.plan.gaps;
          p.checkPosts = r.checkPosts;
          r.plan.pickets.forEach((k, i) => marks.push({ at: [k.x, k.y], t: `P${i + 1}`, c: MG_BLUE, title: `P${i + 1} ${k.side}` }));
          break;
        case 'convoy':
          p.route = { stations: r.route.stations, stretches: r.route.stretches };
          marks.push({ at: r.plan.sp, t: 'SP', c: MG_GREEN, shape: 'square', title: 'Start point' });
          marks.push({ at: r.plan.rp, t: 'RP', c: MG_GREEN, shape: 'square', title: 'Release point' });
          r.plan.bounds.slice(0, -1).forEach((b) => marks.push({ at: [b.x, b.y], t: `B${b.n}`, c: MG_BLUE, shape: 'square', title: `End of bound ${b.n}: ${b.haltWhy}` }));
          break;
        case 'mines':
          p.route = { stations: r.route.stations, stretches: [] };
          r.sites.forEach((m) => marks.push({ at: [m.x, m.y], t: String(m.rank), c: MG_RED, shape: 'diamond', title: m.why }));
          break;
        case 'patrol': {
          if (r.routes.out) lines.push({ pts: r.routes.out, c: MG_CYAN, w: 3.5 });
          if (r.routes.back) lines.push({ pts: r.routes.back, c: MG_ORANGE, w: 2.5, style: 'dash' });
          const s = this._patrolIn.start, o = this._patrolIn.obj;
          if (s) marks.push({ at: s, t: 'S', c: MG_GREEN, shape: 'square', title: 'Start' });
          if (o) marks.push({ at: o, t: 'O', c: MG_RED, shape: 'square', title: 'Objective' });
          r.out?.legs.forEach((l) => marks.push({ at: l.to, t: String(l.i + 1), c: MG_CYAN, title: `End of leg ${l.i + 1}` }));
          if (r.out?.fmp) marks.push({ at: [r.out.fmp.x, r.out.fmp.y], t: 'FMP', c: MG_VIOLET, shape: 'square', title: 'Final meeting point' });
          break;
        }
        case 'ambush': {
          p.route = { stations: r.route.stations, stretches: [] };
          r.sites.forEach((s, i) => {
            if (i !== r.chosen) marks.push({ at: [s.x, s.y], t: String(s.rank), c: MG_ORANGE, title: `Site ${s.rank}: ${s.score}` });
          });
          const s = r.sites[r.chosen];
          if (s) {
            const L = s.layout;
            lines.push({ pts: L.kz, c: MG_RED, w: 7, a: 0.8 });
            lines.push({ pts: L.fireLine, c: MG_BLUE, w: 3 });
            if (L.arm) lines.push({ pts: L.arm, c: MG_BLUE, w: 3, style: 'dash' });
            lines.push({ pts: [L.fireLine[0], L.meeting], c: MG_GREEN, w: 1.5, style: 'short-dash' });
            L.stops.forEach((q, i) => marks.push({ at: q, t: `S${i + 1}`, c: MG_BLUE, shape: 'square', title: 'Stop group' }));
            marks.push({ at: L.meeting, t: 'MP', c: MG_GREEN, shape: 'square', title: `Meeting point ${L.meetingM} m back` });
            marks.push({ at: [s.x, s.y], t: String(s.rank), c: MG_RED, title: `Site ${s.rank}` });
          }
          break;
        }
        case 'block': {
          p.route = { stations: r.route.stations, stretches: [] };
          r.sites.forEach((s, i) => marks.push({ at: [s.x, s.y], t: i === r.chosen ? 'RB' : String(s.rank), c: i === r.chosen ? MG_RED : MG_ORANGE, shape: 'square', title: `Site ${s.rank}: ${s.score}` }));
          const s = r.sites[r.chosen];
          if (s) {
            const st = r.route.stations.filter((q) => q.chainM >= s.approachFromM && q.chainM <= s.chainM).map((q) => [q.x, q.y] as MercXY);
            if (st.length >= 2) lines.push({ pts: st, c: MG_RED, w: 5, a: 0.55 });
            s.positions.forEach((q, i) => {
              marks.push({ at: [q.x, q.y], t: `A${i + 1}`, c: MG_BLUE, shape: 'diamond', title: `Position sees ${q.seesPct} % of the approach` });
              lines.push({ pts: [[q.x, q.y], [s.x, s.y]], c: MG_BLUE, w: 1.2, style: 'short-dash' });
            });
          }
          break;
        }
        case 'infil': {
          if (this._infilLine) lines.push({ pts: this._infilLine, c: [255, 255, 255], w: 3 });
          r.reading.lanes.forEach((l) => {
            lines.push({ pts: l.path, c: MG_RED, w: 3, style: 'dash' });
            marks.push({ at: l.path[Math.floor(l.path.length / 2)], t: `L${l.n}`, c: MG_RED, title: `Lane ${l.n}: ${Math.round(l.lengthM)} m, seen ${l.seenPct} %` });
          });
          r.reading.posts.forEach((q) => marks.push({ at: [q.x, q.y], t: q.source === 'new' ? `P${q.n}` : 'E', c: q.source === 'new' ? MG_BLUE : [120, 144, 156], shape: 'square', title: q.name ?? (q.source === 'new' ? 'New post' : 'Existing post') }));
          break;
        }
        case 'water': {
          if (r.axis && this._waterIn?.mode === 'axis') {
            lines.push({ pts: this._waterIn.pts, c: [255, 255, 255], w: 2.5, style: 'short-dash' });
            r.axis.obstacles.forEach((o, i) => {
              if (i !== r.chosen) marks.push({ at: o.reading.at, t: String(i + 1), c: MG_CYAN, title: `${i + 1}. ${o.reading.typeLabel}${o.reading.name ? ` (${o.reading.name})` : ''}` });
            });
          }
          if (r.reach) {
            lines.push({ pts: r.reach.path, c: MG_CYAN, w: 6, a: 0.5 });
            r.reach.stations.forEach((s, i) => {
              const tag = i === r.reach!.narrowest ? 'N' : i === r.reach!.lowestFar ? 'L' : '';
              marks.push({ at: s.at, t: tag || String(s.n), c: tag ? MG_ORANGE : MG_BLUE, size: tag ? undefined : 14, title: `${s.n}: ${s.widthM ?? '?'} m wide, far bank ${s.farM ?? '?'} m${tag === 'N' ? ' (narrowest)' : tag === 'L' ? ' (lowest far bank)' : ''}` });
            });
          }
          const w = r.reading;
          if (w) {
            if (w.line && !r.reach) lines.push({ pts: w.line, c: MG_CYAN, w: 5, a: 0.6 });
            // The section across, with home (green H) and far (red F) on the bank crests.
            const sec = w.section;
            const nrm = w.axisDeg + 90;
            const a0 = offsetPt(w.at[0], w.at[1], nrm, sec.d[0] ?? -300);
            const a1 = offsetPt(w.at[0], w.at[1], nrm, sec.d[sec.d.length - 1] ?? 300);
            lines.push({ pts: [a0, a1], c: [255, 255, 255], w: 1.6, style: 'dash' });
            const crestAt = (side: 0 | 1, fallback: number) => offsetPt(w.at[0], w.at[1], nrm, sec.crests[side]?.[0] ?? fallback);
            const homeSide: 0 | 1 = w.homeSign === 1 ? 1 : 0;
            marks.push({ at: crestAt(homeSide, w.homeSign * 60), t: 'H', c: MG_GREEN, shape: 'square', title: `Home bank (${w.home.dir}): ${w.homeWhy}` });
            marks.push({ at: crestAt(homeSide === 1 ? 0 : 1, -w.homeSign * 60), t: 'F', c: MG_RED, shape: 'square', title: `Far bank (${w.far.dir})` });
            w.crossings.forEach((q) => {
              const t = /bridge|viaduct/.test(q.kind) ? 'B' : q.kind === 'ford' ? 'Fd' : q.kind === 'ferry' ? 'Fy' : q.kind === 'culvert' ? 'C' : 'X';
              const c: MovRGB = q.tankable ? MG_GREEN : q.inUseNow === false ? [120, 144, 156] : MG_ORANGE;
              marks.push({ at: [q.x, q.y], t, c, shape: 'diamond', title: `${q.label}${q.name ? ` ${q.name}` : ''}${q.load ? `: ${q.load}` : ''}${q.months ? ` (${q.months})` : ''}` });
            });
          }
          break;
        }
      }
    } else if (CARDS.find((c) => c.id === card)?.input === 'route' && this._route) {
      lines.push({ pts: this._route.pts, c: MG_CYAN, w: 3 });
    }
    p.lines = lines;
    p.marks = marks;
    this._map.show(p);
  }

  // ── symbols for "Create on map" ────────────────────────────────────────────────────────────────────────────────────

  private _symbolsFor(r: CardResult, which?: number): PlanSymbol[] {
    const out: PlanSymbol[] = [];
    const closed = (ring: MercXY[]) => [...ring, ring[0]];
    switch (r.card) {
      case 'cordon': {
        const c = r.reading;
        out.push(lineSym(K.line, closed(c.ring), 'Inner Cordon'));
        out.push(lineSym(K.lineDotted, closed(c.outer), 'Outer Cordon'));
        const ctr = c.ring.reduce((a, q) => [a[0] + q[0] / c.ring.length, a[1] + q[1] / c.ring.length], [0, 0]) as MercXY;
        out.push(pointSym(K.cordonSearch, ctr, 'Cordon and Search'));
        for (const s of r.layout.sectors) out.push(pointSym(K.plPost, [s.x, s.y], s.label));
        for (const q of r.layout.posts) {
          if (q.kind === 'roadBlock') out.push(pointSym(K.blockRd, [q.x, q.y], q.label));
          else if (q.kind === 'sideRoad') out.push(pointSym(K.checkPt, [q.x, q.y], q.label));
          else if (q.kind === 'rooftop') out.push(pointSym(K.obsnPost, [q.x, q.y], q.label));
          else out.push(pointSym(K.inf, [q.x, q.y], q.label, { echelon: '13' }));
        }
        break;
      }
      case 'picket': {
        out.push(lineSym(K.arrow, this._route?.pts ?? r.route.stations.map((s) => [s.x, s.y] as MercXY), 'Route'));
        r.plan.pickets.forEach((k, i) => out.push(pointSym(K.plPost, [k.x, k.y], `P${i + 1}`)));
        r.checkPosts.forEach((c, i) => out.push(pointSym(K.checkPt, [c.x, c.y], `CP ${i + 1}`)));
        break;
      }
      case 'convoy': {
        out.push(lineSym(K.arrow, this._route?.pts ?? r.route.stations.map((s) => [s.x, s.y] as MercXY), 'Convoy Route'));
        out.push(pointSym(K.startPt, r.plan.sp, 'SP'));
        out.push(pointSym(K.releasePt, r.plan.rp, 'RP'));
        r.plan.bounds.slice(0, -1).forEach((b) => out.push(pointSym(K.checkPt, [b.x, b.y], `B${b.n}`)));
        break;
      }
      case 'mines':
        r.sites.forEach((m) => out.push(pointSym(K.mine, [m.x, m.y], `L${m.rank}`)));
        break;
      case 'patrol': {
        if (r.routes.out) out.push(lineSym(K.arrow, r.routes.out, 'Route Out'));
        if (r.routes.back) out.push(lineSym(K.arrowDotted, r.routes.back, 'Route In'));
        if (this._patrolIn.start) out.push(pointSym(K.startPt, this._patrolIn.start, 'Start'));
        if (r.out?.fmp) out.push(pointSym(K.rallyPt, [r.out.fmp.x, r.out.fmp.y], 'FMP'));
        r.out?.legs.slice(0, -1).forEach((l) => out.push(pointSym(K.checkPt, l.to, String(l.i + 1))));
        break;
      }
      case 'ambush': {
        const s = r.sites[which ?? r.chosen];
        if (!s) break;
        const L = s.layout;
        out.push(lineSym(K.lineDotted, L.kz, 'Killing Zone'));
        out.push(pointSym(K.inf, [(L.fireLine[0][0] + L.fireLine[1][0]) / 2, (L.fireLine[0][1] + L.fireLine[1][1]) / 2], 'Fire Gp', { echelon: '14' }));
        L.stops.forEach((q, i) => out.push(pointSym(K.inf, q, `Stop ${i + 1}`, { echelon: '13' })));
        out.push(pointSym(K.rallyPt, L.meeting, 'MP'));
        break;
      }
      case 'block': {
        const s = r.sites[which ?? r.chosen];
        if (!s) break;
        out.push(pointSym(K.blockRd, [s.x, s.y], 'Rd Block'));
        s.positions.forEach((q, i) => out.push(pointSym(K.antiTank, [q.x, q.y], `AT ${i + 1}`, { echelon: '13' })));
        break;
      }
      case 'infil': {
        r.reading.lanes.forEach((l) => out.push(lineSym(K.infilLane, l.path, `Lane ${l.n}`, { identity: '6' })));
        r.reading.posts.filter((q) => q.source === 'new').forEach((q) => out.push(pointSym(K.obsnPost, [q.x, q.y], `AIP ${q.n}`)));
        break;
      }
      case 'water': {
        // The obstacle as an Obstacle Line named by its type (unless it is already a placed symbol), its crossings.
        const label = (w: WaterReading) => `${w.annex ? `${w.typeLabel} (Annex P ${w.annex})` : w.typeLabel}${w.name ? ` ${w.name}` : ''}`;
        const crossings = (w: WaterReading) => {
          for (const q of w.crossings) {
            if (/bridge|viaduct/.test(q.kind)) out.push(pointSym(K.bridge, [q.x, q.y], q.load === 'Class 60+ (tankable)' ? 'Br Cl 60+' : q.load === 'Foot bridge' ? 'Ft Br' : `Br ${q.load ?? ''}`.trim()));
            else if (q.kind === 'ford' || q.kind === 'ferry') out.push(pointSym(K.checkPt, [q.x, q.y], q.kind === 'ford' ? 'Ford' : 'Ferry'));
          }
        };
        if (r.mode === 'axis' && r.axis) {
          for (const o of r.axis.obstacles) if (o.reading.line && o.reading.source !== 'symbol') out.push(lineSym(K.obstacleLine, o.reading.line, label(o.reading)));
          if (r.reading) crossings(r.reading);
        } else if (r.mode === 'reach' && r.reach && r.reading) {
          out.push(lineSym(K.obstacleLine, r.reach.path, label(r.reading)));
          crossings(r.reading);
        } else if (r.reading) {
          if (r.reading.line && r.reading.source !== 'symbol') out.push(lineSym(K.obstacleLine, r.reading.line, label(r.reading)));
          crossings(r.reading);
        }
        break;
      }
    }
    return out;
  }

  private _toMerc(p: any, sr?: any): MercXY | null {
    if (!p) return null;
    if (Array.isArray(p)) {
      const wk = sr?.wkid ?? sr?.latestWkid;
      return sr?.isWGS84 || wk === 4326 ? lngLatToMerc(p[0], p[1]) : [p[0], p[1]];
    }
    const s = p.spatialReference ?? sr;
    const wk = s?.wkid ?? s?.latestWkid;
    if (s?.isWebMercator || [102100, 3857, 102113, 3785].includes(wk)) return [p.x, p.y];
    if (typeof p.longitude === 'number' && typeof p.latitude === 'number') return lngLatToMerc(p.longitude, p.latitude);
    if (s?.isWGS84 || wk === 4326) return lngLatToMerc(p.x, p.y);
    return null;
  }

  private _goTo(x: number, y: number): void {
    const view = this._getView();
    if (!view?.goTo) return;
    void view.goTo({ target: new Point({ x, y, spatialReference: { wkid: 102100 } }), zoom: Math.max(view.zoom ?? 14, 15) }).catch(() => undefined);
  }
}

/** The movers each card reads for (exported for the cards' labels). */
export type MoverChoice = GoingSets;
