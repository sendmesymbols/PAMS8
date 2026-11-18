/**
 * PlanBuildTab.ts — the Deployment Mgr's Build tab (PlanBuilder_Plan.md; Phase 1 geometry, Phase 2 terrain fit).
 *
 * Task → Enemy → Place → Check → Create. The tab picks a recipe (MS/Data/Deployments/Recipes), lays it out with the
 * pure solver (PlanSolve.ts) and hands the result to the Deployment Mgr as a plan document, so placing it is the
 * Mgr's own flow: the ghost follows the cursor, one Ctrl+Z takes it back, Last placement repositions or removes it.
 *
 * With the terrain bundle (`planBuilder.useTerrain`): while the mouse moves the ghost is the quick layout at doctrinal
 * spacing; when it rests (`planBuilder.fit.restMs`) the plan is fitted to the ground there (PlanFit.ts: posns slide
 * out of NO-GO, the ground, fields of fire, flanks, approaches and the killing ground are read, Auto ranks the
 * layouts), the ghost becomes the fitted plan, a card at the cursor gives the ranking and the worst check, and the
 * approaches are drawn. The click fits once more at exactly that spot and places the fitted plan. With a threat
 * marker the plan turns to face it as it moves and one click places it. Without the bundle (switched off or missing)
 * nothing is loaded and every ground check stays grey.
 *
 * Loaded only while `features.planBuilder` is on (dynamic import from DeploymentBuilderEngine); destroy() leaves
 * nothing behind (probe, worker, layer, card, listeners).
 */
import Graphic from '@arcgis/core/Graphic';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Polyline from '@arcgis/core/geometry/Polyline';
import Point from '@arcgis/core/geometry/Point';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import TextSymbol from '@arcgis/core/symbols/TextSymbol';
import type MapView from '@arcgis/core/views/MapView';
import type SceneView from '@arcgis/core/views/SceneView';
import Plan from '../ImportExport/Plan.ts';
import Utils from '../../Support/utils.ts';
import symbolMeta from '../../Data/Symbols.json';
import planDoctrine from '../../Data/PlanDoctrine.json';
import nightMarchDoctrine from '../../Data/NightMarchDoctrine.json';
import { nmRulesFrom } from '../NightMarch/NightMarchRead';
import ocokaDoctrine from '../../Data/OcokaDoctrine.json';
import { doctrineAt, validateRecipe, validateFamilies, type Recipe, type DoctrineSet } from './PlanRecipes';
import { solveRecipe, toPlanDocument, planText, detailLines, type SolveResult, type CheckState, type SlotResult, type Check, type XY } from './PlanSolve';
import { withMoves, triggerLines, enemyStartWords, type WhatIfResult } from './PlanWhatIf';
import { fitLayout, nextBestSpot, rankFits, scoreRowState, SCORE_ROWS, toWorld, type FittedLayout, type FitLayoutInput } from './PlanFit';
import { PlanGroundProbe } from './PlanGroundProbe';
import { applyContext, defaultEnemy, echelonLabel, enemyFupM, firstLayout, terrainLabel, ENEMY_TYPES, TERRAIN_KINDS, type EnemySpec, type EnemyType, type TerrainKind, type TerrainSpec } from './PlanContext';
import { checkPlan, checkText, readSymbols, reportWorld, type CheckReport, type PosnKind } from './PlanCheck';
import { twoPhaseRecipe } from './PlanPhase';
import { addTankTimes, defTankRows, withDefTanks, withTanks, type TankMode } from './PlanTanks';
import { artyOnPlan, artyRows, ownArtyTypes, withArty, type ArtyDoctrine, type ArtyType } from './PlanArty';
import { bridgeKinds, engrText, ownEngrTypes, type EngrType } from './PlanEngr';
import { gunRulesFrom } from '../GunDeployment/GunDeploymentFind';
import gunDoctrine from '../../Data/GunDoctrine.json';
import { OWN_ORBAT_FILES, brief, doctrineForUnit, enUnitFor, forceFromOrbat, mergeOwn, minefieldRow, ownAtTypes, ownBdeTypes, ownBnTypes, ownDivTypes, ownUnitFor, sizeText, tankSqnOf, tankSqnText, typeFits, unitForPlan, unitLine, withAtGroup, type AtType, type OrbatSet, type OwnType, type TankSqn, type UnitBrief } from './PlanOrbat';
import { atgmExtras } from './PlanFit';
import { attackTimes, hRelText, hSumRow, phase2Row } from './PlanAttack';
import { checkSmallOp, solveSmall, type Mover } from './PlanSmallOps';
import { SMALL_TASKS } from './PlanRecipes';
import { rulesFrom as movRulesFrom } from '../MovementGuide/MovementGuideScan';
import { plRulesFrom, type PlFootSpeeds } from '../PlatoonGuide/PlatoonGuideRead';
import movementDoctrine from '../../Data/MovementDoctrine.json';
import platoonDoctrine from '../../Data/PlatoonDoctrine.json';
import movementSpeeds from '../../Data/MovementSpeeds.json';
import { waterRulesFrom } from '../MovementGuide/MovementGuideWater';
import { checkCrossing, hRel as hClock, withMinefield, type Light } from './PlanCrossing';
import type { PlanEntry, PlacementHooks, DrawnRead } from './DeploymentBuilderEngine';

export interface BuildTabHost {
  /** Place this plan document through the Deployment Mgr's placement flow. */
  place(entry: PlanEntry, doc: any): void;
  log(msg: string, ok: boolean): void;
  view(): MapView | SceneView | null;
  container(): HTMLElement | null;
  hooks(h: PlacementHooks | null): void;
  /** Swap the plan being placed (the fitted layout) and redraw the ghost where it was. */
  replace(doc: any, redraw: boolean): void;
  /** The plan on the map as plan records, for Check my plan (nothing is changed). */
  readDrawn?(scope: 'selected' | 'last' | 'all'): DrawnRead;
  /** Move the pivot of the plan being placed (Web Mercator): J takes an ambush to its better site. False: not moved. */
  moveAnchor?(xy: XY): boolean;
  /** A slot in the Mgr's tab bar for the Build a plan / Check my plan switch; none: the switch gets a row of its own. */
  aside?(): HTMLElement | null;
}

/** Roles a posn can be set to in Check my plan (a click walks them). */
const ROLE_CYCLE: PosnKind[] = ['fwd', 'depth', 'res', 'cpen', 'alt', 'ignore'];
const ROLE_LABEL: Record<PosnKind, string> = { fwd: 'Forward', depth: 'Depth', res: 'Reserve', cpen: 'C Pen', alt: 'Alternate', sup: 'Sup posn', sub: 'Inside', outline: 'Outline', dummy: 'Dummy', ignore: 'Left out' };
const EN_ECHELONS = ['15', '16', '18', '21'];
/** Slot kinds that are a sub-unit's posn (a Coy of a Bn plan). */
const FOOTPRINT_ROLES = new Set(['fwd', 'depth', 'res', 'round']);

interface Family { id: string; name: string; task: string; echelon: string; unit?: string; recipes: string[] }
/** One layout fitted at one spot. */
type Fitted = FittedLayout & { doc: ReturnType<typeof toPlanDocument>; whatIf?: WhatIfResult };

const DEFAULT_RECIPES_URL = '/MS/Data/Deployments/Recipes';
const DEFAULT_ORBAT_URL = '/MS/Data/Orbat/PK';
const R_EARTH = 6378137;
const TASKS: { id: string; label: string; later?: string }[] = [
  { id: 'defence', label: 'Defence' },
  { id: 'attack', label: 'Attack' },
  { id: 'ambush', label: 'Ambush' },
  { id: 'patrol', label: 'Patrol' },
  { id: 'recce', label: 'Recce' },
  { id: 'crossing', label: 'Crossing' },
];
const STEPS = ['Task', 'Enemy', 'Place', 'Check', 'Create'];
const LAYOUT_LABEL: Record<string, string> = {
  'two-up': 'Two up', 'three-up': 'Three up', 'one-up': 'One up', 'all-round': 'All round', canal: 'Canal', 'rev-slope': 'Rev slope', frontal: 'Frontal',
  'left-flank': 'Lt flank', 'right-flank': 'Rt flank',
  line: 'Line', l: 'L', v: 'V', patrol: 'Out and back', 'two-ops': 'Two OPs', 'three-ops': 'Three OPs', 'four-bn': 'Four Bns', 'two-bde': 'Two Bdes', area: 'Area', screen: 'Screen',
};
const MOVER_LABEL: Record<Mover, string> = { wheeled: 'Wheeled', tracked: 'Tanks', dismounted: 'On foot' };
const MOVERS: Mover[] = ['wheeled', 'tracked', 'dismounted'];
/** The Movement Guide's foot speeds (MovementSpeeds.json movers.foot), as its own cards read them. */
const footSpeeds = (): PlFootSpeeds => {
  const f = (movementSpeeds as any).movers?.foot ?? {};
  return { ground: f.ground ?? { open: [4, 3] }, road: f.road?.track ?? [4, 3], toblerA: Array.isArray(f.slope?.a) ? f.slope.a[0] : 3.5, toblerB: typeof f.slope?.b === 'number' ? f.slope.b : 0.05 };
};
/** A recipe id without the two-phase suffix (PlanPhase.twoPhaseRecipe adds -2ph). */
const baseId = (id: string) => id.replace(/-gun$/, '').replace(/-en$/, '').replace(/-mf$/, '').replace(/-tk[cf]$/, '').replace(/-tkdd$/, '').replace(/-2ph1?$/, '');
const WORD: Record<CheckState, string> = { pass: 'Pass', warn: 'Warn', fail: 'Fail', unchecked: 'Not checked' };
const RGB: Record<CheckState, [number, number, number]> = { pass: [47, 168, 98], warn: [238, 138, 31], fail: [229, 72, 77], unchecked: [127, 136, 147] };
const esc = (s: unknown) => Utils.escapeHtml(String(s ?? ''));
/** Line icons for the tab (a 14 px grid, drawn in currentColor). */
const ICONS: Record<string, string> = {
  check: '<path d="M3 7.4l2.5 2.5L11 4.4"/>',
  warn: '<path d="M7 3.2v4.6"/><path d="M7 10.5v.1"/>',
  x: '<path d="M4.2 4.2l5.6 5.6M9.8 4.2l-5.6 5.6"/>',
  dash: '<path d="M4 7h6"/>',
  aim: '<circle cx="7" cy="7" r="4.3"/><path d="M7 1.2v2.6M7 10.2v2.6M1.2 7h2.6M10.2 7h2.6"/>',
  pin: '<path d="M7 12.6s3.9-3.5 3.9-6.6a3.9 3.9 0 0 0-7.8 0c0 3.1 3.9 6.6 3.9 6.6z"/><circle cx="7" cy="6" r="1.3"/>',
  copy: '<rect x="4.6" y="4.6" width="7.2" height="7.2" rx="1.6"/><path d="M9.4 4.6V3.4a1.2 1.2 0 0 0-1.2-1.2H3.4a1.2 1.2 0 0 0-1.2 1.2v4.8a1.2 1.2 0 0 0 1.2 1.2h1.2"/>',
  next: '<path d="M3 7h8M7.8 3.8L11 7l-3.2 3.2"/>',
  scan: '<circle cx="6.2" cy="6.2" r="3.9"/><path d="M9.1 9.1l3 3"/>',
  layers: '<path d="M7 2l5 2.6-5 2.6-5-2.6z"/><path d="M2 7.2l5 2.6 5-2.6"/><path d="M2 9.8l5 2.6 5-2.6"/>',
};
const icon = (k: string, cls = ''): string => `<svg class="pb-ic${cls ? ` ${cls}` : ''}" viewBox="0 0 14 14" aria-hidden="true">${ICONS[k] ?? ''}</svg>`;
const VERDICT_ICON: Record<CheckState, string> = { pass: 'check', warn: 'warn', fail: 'x', unchecked: 'dash' };
/** A verdict: its word and an icon besides the colour. */
const pillHtml = (st: CheckState): string => `<span class="pb-pill pb-${st}">${icon(VERDICT_ICON[st], 'pb-ic-sm')}${WORD[st]}</span>`;
/** Fails, then warnings, then not checked, then passes; the doctrine order kept within each. */
const worstFirst = <T extends { st: CheckState }>(rows: T[]): T[] => (['fail', 'warn', 'unchecked', 'pass'] as CheckState[]).flatMap((s) => rows.filter((r) => r.st === s));
interface BtnOpts { kind?: 'primary' | 'ghost'; sm?: boolean; icon?: string; after?: boolean; armed?: boolean; title?: string }
/** A button of the tab: primary (one per screen), secondary (the default) or ghost; armed = waiting for a click on the map. */
const btn = (label: string, data: string, o: BtnOpts = {}): string =>
  `<button type="button" class="pb-btn${o.kind ? ` pb-btn--${o.kind}` : ''}${o.sm ? ' pb-btn--sm' : ''}${o.armed ? ' is-armed' : ''}" data-pb="${esc(data)}"${o.title ? ` title="${esc(o.title)}"` : ''}>`
  + (o.armed ? '<i class="pb-pulse" aria-hidden="true"></i>' : o.icon && !o.after ? icon(o.icon) : '')
  + `<span>${esc(label)}</span>${o.icon && o.after && !o.armed ? icon(o.icon) : ''}</button>`;
/** One of a few as a segmented control. Auto, when given, leads behind a divider; the value it picked carries a dashed ring. */
interface SegItem { on: boolean; label: string; data: string; title?: string; disabled?: boolean; picked?: boolean }
const seg = (items: SegItem[], o: { auto?: SegItem; sm?: boolean; label?: string } = {}): string => {
  const b = (i: SegItem) => {
    const title = i.picked ? `Auto picked ${i.label}${i.title ? `. ${i.title}` : ''}` : i.title;
    return `<button type="button" data-pb="${esc(i.data)}" aria-pressed="${i.on}"${i.picked ? ' class="pb-autopick"' : ''}${i.disabled ? ' aria-disabled="true"' : ''}${title ? ` title="${esc(title)}"` : ''}>${esc(i.label)}</button>`;
  };
  return `<div class="pb-seg${o.sm ? ' pb-seg--sm' : ''}" role="group"${o.label ? ` aria-label="${esc(o.label)}"` : ''}>`
    + `${o.auto ? `${b(o.auto)}<span class="pb-sep" aria-hidden="true"></span>` : ''}${items.map(b).join('')}</div>`;
};
/** A labelled row of the tab: its label, then its controls. */
const row = (label: string, inner: string): string => `<div class="pb-row"><span>${esc(label)}</span><div class="pb-chips">${inner}</div></div>`;
/** "M while placing", with the key as a key. */
const keyHint = (k: string): string => `<span class="pb-keyhint"><kbd>${esc(k)}</kbd> while placing</span>`;
/**
 * A unit's facts laid out (unitLine in one line is kept for Copy as Text): the name and strength, each weapon with its
 * range ("range ?" where weapons.json has none), the source and what the extraction lacks.
 */
const unitFacts = (b: UnitBrief): string => {
  const km = (m: number | null) => (m === null ? null : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
  const wpn = (n: number, name: string, r: number | null) => `<span class="pb-wpn"><span class="n">${n}</span><span class="x">×</span>${esc(name)}`
    + `${km(r) ? `<span class="r">${km(r)}</span>` : '<span class="q" title="No range in weapons.json">range ?</span>'}</span>`;
  const ws = [...b.atgm, ...b.rr, ...b.mortars].map((x) => wpn(x.count, x.name.replace(/ Wpn Sys| Launcher/g, ''), x.rangeM));
  if (b.mgCount) ws.push(wpn(b.mgCount, 'MG1A3', b.mgEffM));
  const head = [b.strength ? `${b.strength.toLocaleString('en-GB')} all ranks` : null, sizeText(b),
    b.mounted ? `mounted (${b.apcs} APCs)` : null].filter(Boolean).join(' · ');
  const notes = b.notes.filter((n) => !/no range in weapons\.json/.test(n));
  return `<div class="pb-facts"><div><b>${esc(b.name)}</b>${esc(head)}</div>${ws.length ? `<div class="pb-wpns">${ws.join('')}</div>` : ''}`
    + `<div class="pb-src">${esc(b.src)}${notes.length ? ` · <span class="q">${esc(notes.join('; '))}</span>` : ''}</div></div>`;
};
/** A check's reason in the panel: its headline, one line per item, why and the fixes when it carries them. */
const reasonHtml = (c: Check): string => {
  const d = c.detail;
  if (!d) return `<div class="pb-ck-why">${esc(c.reason)}</div>`;
  const items = d.items?.length ? `<ul class="pb-det-items">${d.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const why = d.why && c.st !== 'pass' ? `<div class="pb-det-why"><b>Why</b> ${esc(d.why)}</div>` : '';
  const fix = d.fix?.length && c.st !== 'pass' ? `<div class="pb-det-fix"><b>Fix</b><ul>${d.fix.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  return `<div class="pb-det-head">${esc(d.head)}</div>${items}${why}${fix}`;
};
/** A check as a row that leads with its verdict: the name, then the reason under it. */
const ckRow = (st: CheckState, name: string, body: string): string => `<li class="pb-ck"><div>${pillHtml(st)}</div><div><div class="pb-ck-name">${esc(name)}</div>${body}</div></li>`;
/** Checks as rows, the worst first. */
const ckList = (rows: Check[]): string => `<ul class="pb-checks">${worstFirst(rows).map((c) => ckRow(c.st, c.name, reasonHtml(c))).join('')}</ul>`;
/** A row of plain text under a check's name. */
const whyHtml = (s: string): string => `<div class="pb-ck-why">${esc(s)}</div>`;
let previewSeq = 0;
/**
 * The worst check on the cursor card, kept short so the card fits beside the cursor: its short lines (at most 3), a
 * one-line why and the first 2 fixes; the rest is in the Check step. Without a detail, one line as before.
 */
const cardCheckHtml = (c: Check & { name: string }, word: string): string => {
  const d = c.detail;
  if (!d) return `<div class="pb-card-w"><span class="pb-pill pb-${c.st}">${word}</span> ${esc(c.name)}: ${esc(c.reason)}</div>`;
  const lines = d.short ?? d.items ?? [];
  const more = (n: number, k: number) => (n > k ? `<li class="pb-card-dim">${n - k} more in the Check step</li>` : '');
  return `<div class="pb-card-w"><span class="pb-pill pb-${c.st}">${word}</span> <b>${esc(c.name)}</b> · ${esc(d.head)}</div>`
    + (lines.length ? `<ul class="pb-card-items">${lines.slice(0, 3).map((x) => `<li>${esc(x)}</li>`).join('')}${more(lines.length, 3)}</ul>` : '')
    + (d.whyShort || d.why ? `<div class="pb-card-why"><b>Why</b> ${esc(d.whyShort ?? d.why)}</div>` : '')
    + (d.fix?.length ? `<div class="pb-card-fix"><b>Fix</b><ul>${d.fix.slice(0, 2).map((x) => `<li>${esc(x)}</li>`).join('')}${more(d.fix.length, 2)}</ul></div>` : '');
};
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
/** A fit move in words: out of NO-GO, or up to higher ground. */
const slideWord = (s: { label: string; distM: number; why?: string; riseM?: number }) => (s.why === 'high' ? `${esc(s.label)} up ${fmtM(s.distM)} to ground ${s.riseM} m higher` : `${esc(s.label)} slid ${fmtM(s.distM)} out of NO-GO`);
const MERC = { wkid: 102100 };
/** Copy as Text for a crossing: the timeline from H, the bridge sites, his observers outside the bridgehead. */
const crossLines = (c: NonNullable<FittedLayout['fit']['crossing']>): string[] => [
  ...c.times.map((t) => `  ${hClock(t.atMin).padEnd(10)} ${t.label}`),
  ...c.bridges.map((b) => `  Bridge site: ${b.why}${b.movedM >= 100 ? ` (moved ${Math.round(b.movedM)} m)` : ''}`),
  `  Far side that sees the crossing places: ${c.observers.length} places, ${c.observers.filter((o) => !o.inside).length} outside the bridgehead`,
];
/** The GMA (deg, E +) route cards and night legs give magnetic bearings with (planBuilder.gmaDeg); null: grid and mils. */
const gmaOf = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/** A grid bearing as a route card gives it: grid degrees, mils (6400 to the circle) and magnetic when the GMA is set. */
const brgText = (gridDeg: number, gma: number | null): string => {
  const mils = String(Math.round((((gridDeg % 360) + 360) % 360) * 6400 / 360) % 6400).padStart(4, '0');
  const mag = gma === null ? null : Math.round(((((gridDeg - gma) % 360) + 360) % 360));
  return `${Math.round(gridDeg)} deg grid, ${mils} mils${mag === null ? '' : `, ${mag} deg mag`}`;
};
/** Copy as Text for an ambush, patrol or recce: the site and better sites, the route card, the OPs. */
const smallLines = (s: NonNullable<FittedLayout['fit']['small']>, gma: number | null = null): string[] => {
  if (s.task === 'ambush') return [
    `  Site ${s.site?.score ?? '?'} / 100, laid as ${s.site?.shape ?? '?'} (the ground suits ${s.site?.groundShape ?? '?'})`,
    ...(s.site?.parts ?? []).map((p) => `    ${p.ok ? '+' : '-'} ${p.what} (${p.pts})`),
    ...(s.better ?? []).map((b) => `  Better site ${Math.abs(b.alongM)} m ${b.alongM < 0 ? 'up the Rd toward him' : 'down the Rd'}: scores ${b.score} (${b.shape})`),
    ...(s.outlying ?? []).map((o) => `  ${o.label}: ${Math.abs(o.alongM)} m ${o.alongM < 0 ? 'up the Rd toward him' : 'down the Rd'}, site ${o.score} / 100, sees ${o.seenPct} % of its stretch`),
  ];
  if (s.task === 'patrol') return (s.legs ?? []).map((l) => `  ${l.way} leg ${l.i}: ${brgText(l.bearingDeg, gma)}, ${l.distM} m, ${l.paces} paces, ${l.minDay} min by day / ${l.minNight} by night${l.feature ? `, ends at ${l.feature}` : ''}`);
  return (s.ops ?? []).map((o) => `  ${o.label}: sees ${o.seenPct} % of ${s.screen ? 'the ground he would watch you from' : 'the NAI'}, ${o.riseM === 0 ? 'level with' : o.riseM > 0 ? `${o.riseM} m above` : `${-o.riseM} m below`} it, ${o.cover ? 'in cover' : 'in the open'}`);
};

export class PlanBuildTab {
  private _box: HTMLElement;
  private _host: BuildTabHost;
  /** The host's slot in its tab bar for the mode switch (null: the switch gets a row of its own). */
  private _aside: HTMLElement | null = null;
  /** The types these layouts cannot use (a Bn not of four Coys, an AT Bn for a Coy plan): folded behind "+N not offered" until opened. */
  private _allTypes = false;
  private _settings: Record<string, any> = {};
  private _doc: DoctrineSet = { plan: planDoctrine as any, ocoka: ocokaDoctrine as any };
  private _families: Family[] = [];
  private _recipes = new Map<string, Recipe>();
  private _loadState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private _loadError = '';
  private _recipesUrl = '';

  private _step = 1;
  private _task = 'defence';
  private _familyId = '';
  private _recipeId = '';
  private _auto = false;
  private _detail: 'coy' | 'pl' = 'coy';
  private _alternates: 'visible' | 'hidden' | 'none' = 'hidden';
  private _altFromSettings = true;
  private _msg = '';
  private _result: SolveResult | null = null;
  private _destroyed = false;

  // terrain
  private _probe: PlanGroundProbe | null = null;
  private _probeState: 'off' | 'loading' | 'ready' | 'missing' = 'off';
  private _probeUrl = '';
  private _threat: XY | null = null;
  private _arming: { remove(): void } | null = null;
  private _armKey: ((e: KeyboardEvent) => void) | null = null;
  private _layer: GraphicsLayer | null = null;
  private _card: HTMLElement | null = null;
  // placement
  private _placing: { entry: PlanEntry; baseDoc: any; swapped: boolean } | null = null;
  private _restTimer: ReturnType<typeof setTimeout> | null = null;
  private _rest: { anchor: XY; bearing: number; screen: { x: number; y: number } | null; cursor?: XY | null } | null = null;
  private _ranked: Fitted[] = [];
  /** The last fit (at rest or on the click): what the Check step and Copy as Text show. */
  private _lastFit: Fitted | null = null;
  /** J's moves for this rest (plan metres by role), and the posns J has moved already. */
  private _manual: Record<string, XY> = {};
  private _jMoved = new Set<string>();
  private _jKey: ((e: KeyboardEvent) => void) | null = null;
  private _jNote = '';
  /** An ambush's KZ before each J (Shift+J goes back); the note the next rest shows after a J. */
  private _ambushFrom: XY[] = [];
  private _noteNext = '';
  /** Check step: this plan, or every layout of the family fitted at the same spot. */
  private _checkView: 'plan' | 'compare' = 'plan';
  private _compare: Fitted[] | null = null;
  /** The last fit's routes kept on the map after the placement (Check step). */
  private _routesShown = false;
  // the enemy and the ground (PlanContext): 'auto' = the doctrinal default / read off the bundle
  private _enEch: string = 'auto';
  private _enType: 'auto' | EnemyType = 'auto';
  private _ground: 'auto' | TerrainKind = 'auto';
  /** An attack by night: night rates, the Night March chart from the Assy Area to the FUP. */
  private _night = false;
  /** An attack in one or two phases (PlanPhase: Obj 2, the follow-up Coys round Obj 1, H2). */
  private _phases: 1 | 2 = 1;
  /** Tanks with the attack (PlanTanks): none, in the fire support role, or in close support (armour heavy). T cycles it while placing. */
  private _tanks: TankMode = 'none';
  /** Where the cursor card was shown last (screen px), for a refresh without a rest point. */
  private _cardAt: { x: number; y: number } | null = null;
  /** Phase 2 by both follow-up Coys (no Bn reserve) or by C Coy with D Coy kept as the reserve; null: the doctrine's default. R flips it while placing. */
  private _ph2Coys: 1 | 2 | null = null;
  private _ph2 = new Map<string, Recipe>();
  /** Hostile units and posns on the map (Web Mercator), read once per placement for a two-phase attack's Obj 2. */
  private _enemyAt: XY[] | null = null;
  private _nmRules = nmRulesFrom(nightMarchDoctrine);
  // ambush, patrol, recce (PlanSmallOps over the Movement / Platoon Guides)
  private _movRules = movRulesFrom(movementDoctrine);
  /** A crossing (PlanCrossing): the Water engine's rules and the light the Annex Q times are taken for. */
  private _waterRules = waterRulesFrom(movementDoctrine);
  private _light: Light = 'dark';
  /** A crossing: his minefield assumed in front of the obstacle (IBB S47 para 6: the home side drawn back, Breach lanes). */
  private _mf = false;
  private _plRules = plRulesFrom(platoonDoctrine);
  private _speeds = footSpeeds();
  /** An ambush's target: wheeled, tanks or on foot (M walks it while placing). */
  private _mover: Mover = 'wheeled';
  /** The cursor while aiming (Web Mercator): a patrol's Obj, a recce's NAI. */
  private _cursor: XY | null = null;
  // the ORBAT (MS/Data/Orbat/PK): what the unit holds, the enemy's units, the engineer rates; null: not loaded
  private _orbat: OrbatSet | null = null;
  /**
   * The own unit type chosen (an ORBAT Bn-sized type: Mtn Inf Bn, MIB, a Rangers Wing ...); null: the family's. A Bn plan
   * is laid for it, a Coy plan for its rifle Coy and a Pl plan for that Coy's rifle Pl (PlanOrbat.unitForPlan).
   */
  private _unitId: string | null = null;
  /** The Bde type chosen for a Bde plan (Inf Bde, IIBG, Indep Mech Inf Bde Gp, IABG); null: the Inf Bde. */
  private _bdeId: string | null = null;
  /** The Div type chosen for a Div plan (Inf Div, Armd Div); null: the Inf Div. */
  private _divId: string | null = null;
  /** Tank Sqns grouped to a Bn defence (0 to 3 of an Armr Regt's Sqns): their harbours beside the reserve, the C Pen force at the tank rate. */
  private _defTanks = 0;
  /** The engineers with a defence (the minefield) or a crossing (bridging, the breach): an ORBAT unit; null: the doctrine's (one Fd Coy, Annex Q). */
  private _engrId: string | null = null;
  private _engrCache: EngrType[] | null = null;
  private get _engrTypes(): EngrType[] { return this._orbat ? (this._engrCache ??= ownEngrTypes(this._orbat)) : []; }
  private get _engr(): EngrType | null { return this._engrId ? this._engrTypes.find((e) => e.id === this._engrId) ?? null : null; }
  /** The artillery with a Bn plan (an ORBAT Regt or Bty: Fd, Med, Med (SP), Mtn, Hy); null: none drawn. */
  private _artyId: string | null = null;
  private _artyCache: ArtyType[] | null = null;
  private get _artyTypes(): ArtyType[] { return this._orbat ? (this._artyCache ??= ownArtyTypes(this._orbat)) : []; }
  /** The Gun Deployment doctrine's figures the gun area is laid by (GunDoctrine.json). */
  private _artyDoc: ArtyDoctrine = (() => {
    const R = gunRulesFrom(gunDoctrine as any);
    const pct = (v: number) => `${Math.round(v * 100)} %`;
    return {
      defMinM: R.front.def.minM.value, attkMinM: R.front.attk.minM.value, defMaxFrac: R.front.def.maxFrac.value, attkMaxFrac: R.front.attk.maxFrac.value,
      regtM: [R.areas.regt.frontM.value, R.areas.regt.depthM.value], btyM: [R.areas.bty.frontM.value, R.areas.bty.depthM.value],
      room: [R.room.okShare.value, R.room.minShare.value],
      src: { band: `GunDoctrine front: at least ${(R.front.def.minM.value / 1000).toFixed(1)} km behind in defence (${R.front.def.minM.basis}), ${(R.front.attk.minM.value / 1000).toFixed(1)} km in an attack (${R.front.attk.minM.basis}), at most ${pct(R.front.def.maxFrac.value)} of the planning range (${R.front.def.maxFrac.basis})`, area: `gun area ${R.areas.regt.frontM.value} x ${R.areas.regt.depthM.value} m a Regt (${R.areas.regt.frontM.basis}), ${R.areas.bty.frontM.value} x ${R.areas.bty.depthM.value} m a Bty (${R.areas.bty.frontM.basis}; GunDoctrine areas)` },
    };
  })();
  /** The Bn-sized types the ORBAT offers, and the AT Bns whose Coys can be grouped (read once per load). */
  private _typesCache: OwnType[] | null = null;
  private get _types(): OwnType[] { return this._orbat ? (this._typesCache ??= ownBnTypes(this._orbat)) : []; }
  private _atCache: AtType[] | null = null;
  private get _atTypes(): AtType[] { return this._orbat ? (this._atCache ??= ownAtTypes(this._orbat)) : []; }
  /** The AT Bn whose ATGM Coys are grouped to a Bn defence (an ORBAT id: LAT, HAT); null: none. */
  private _atId: string | null = null;
  /** How many of its Coys are grouped (1 to its 3). */
  private _atCoys = 1;
  // Check my plan (Phase 5)
  private _mode: 'build' | 'check' = 'build';
  private _checkScope: 'selected' | 'last' | 'all' = 'selected';
  private _checkRecs: DrawnRead['records'] | null = null;
  private _checkNote = '';
  private _checkKinds: Record<string, PosnKind> = {};
  private _check: CheckReport | null = null;
  private _checkTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(box: HTMLElement, host: BuildTabHost) {
    this._box = box;
    this._host = host;
    this._box.addEventListener('click', this._onClick);
    this._aside = host.aside?.() ?? null;
    this._aside?.addEventListener('click', this._onClick);
  }

  public setSettings(settings: Record<string, any>): void {
    this._settings = settings ?? {};
    const create = this._settings.alternates?.create;
    if (this._altFromSettings && (create === 'visible' || create === 'hidden' || create === 'none')) this._alternates = create;
    const url = String(this._settings.recipesUrl || DEFAULT_RECIPES_URL).replace(/\/+$/, '');
    if (url !== this._recipesUrl) { this._recipesUrl = url; this._loadState = 'idle'; }
    if (this._settings.useTerrain === false) this._closeProbe();
    if (this._box.isConnected && !this._box.hidden) this.shown();
  }

  /** The tab came into view: load the recipes (and the terrain bundle when it is wanted) once, then draw. */
  public shown(): void {
    if (this._loadState === 'idle') void this._load();
    if (this._settings.useTerrain !== false) void this._openProbe();
    this._render();
  }

  /** The map switched between 2D and 3D: the overlay layer moves to the new view. */
  public viewChanged(): void {
    this._layer?.destroy();
    this._layer = null;
    this._disarm();
    this._drawThreat();
  }

  public destroy(): void {
    this._destroyed = true;
    this._box.removeEventListener('click', this._onClick);
    this._box.innerHTML = '';
    this._aside?.removeEventListener('click', this._onClick);
    if (this._aside) this._aside.innerHTML = '';
    this._aside = null;
    this._endPlacing();
    this._disarm();
    if (this._checkTimer) clearTimeout(this._checkTimer);
    this._checkTimer = null;
    this._closeProbe();
    this._layer?.destroy();
    this._layer = null;
    this._card?.remove();
    this._card = null;
  }

  // ── recipes ──────────────────────────────────────────────────────────────────────────────────────────────────
  private async _load(): Promise<void> {
    this._loadState = 'loading';
    this._render();
    const base = this._recipesUrl || DEFAULT_RECIPES_URL;
    try {
      const get = async (u: string) => {
        const r = await fetch(u);
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${u}`);
        return r.json();
      };
      const index = await get(`${base}/index.json`);
      const fams: Family[] = Array.isArray(index?.families) ? index.families : [];
      const loaded: Recipe[] = [];
      for (const f of fams) for (const id of f.recipes ?? []) {
        try { loaded.push(await get(`${base}/${id}.json`)); } catch (e) { this._host.log(`Recipe ${id}: ${e instanceof Error ? e.message : String(e)}`, false); }
      }
      if (this._destroyed) return;
      const good: Recipe[] = [];
      for (const r of loaded) {
        const bad = validateRecipe(r, { doc: this._doc, symbols: symbolMeta as any, file: `${r?.id}.json` }).filter((i) => i.level === 'fail');
        if (bad.length) this._host.log(`Recipe ${r?.id} left out: ${bad.map((b) => b.msg).join('; ')}`, false);
        else good.push(r);
      }
      for (const i of validateFamilies(good).filter((x) => x.level === 'fail')) this._host.log(`Recipes: ${i.msg}`, false);
      this._recipes = new Map(good.map((r) => [r.id, r]));
      this._families = fams.map((f) => ({ ...f, recipes: (f.recipes ?? []).filter((id) => this._recipes.has(id)) })).filter((f) => f.recipes.length);
      await this._loadOrbat();
      if (this._destroyed) return;
      this._loadState = 'ready';
      this._host.log(`Intelligent Deployment: ${good.length} recipes in ${this._families.length} families`, true);
      this._pickDefaults();
    } catch (e) {
      this._loadState = 'failed';
      this._loadError = e instanceof Error ? e.message : String(e);
      this._host.log(`Intelligent Deployment: recipes not loaded (${this._loadError})`, false);
    }
    this._render();
  }

  /**
   * The ORBAT files: every own arm as one list (a Bde's Sig Coy or Armr Regt is in another arm's file), the enemy,
   * the weapons, the engineer tables. inf.json, en.json and weapons.json must be there; an arm file that is missing
   * is said and left out. No ORBAT at all: the doctrine figures stand, said so.
   */
  private async _loadOrbat(): Promise<void> {
    const base = String(this._settings.orbatUrl || DEFAULT_ORBAT_URL).replace(/\/+$/, '');
    this._typesCache = null;
    this._atCache = null;
    this._artyCache = null;
    this._engrCache = null;
    this._ph2.clear();
    try {
      const get = async (f: string) => { const r = await fetch(`${base}/${f}`); if (!r.ok) throw new Error(`HTTP ${r.status} for ${f}`); return r.json(); };
      const [inf, ...arms] = OWN_ORBAT_FILES;
      const [infDoc, en, weapons, ...armDocs] = await Promise.all([get(inf), get('en.json'), get('weapons.json'), ...arms.map((f) => get(f).catch(() => null))]);
      const missing = arms.filter((_, i) => !armDocs[i]);
      const engr = armDocs[arms.indexOf('engr.json')];
      this._orbat = { own: mergeOwn([infDoc?.units, ...armDocs.map((d) => d?.units)]), en: en?.units ?? [], weapons: weapons?.weapons ?? [], engrData: engr?.engrData ?? [] };
      this._host.log(`Intelligent Deployment: ORBAT ${this._orbat.own.length} own units of ${OWN_ORBAT_FILES.length - missing.length} arms and ${this._orbat.en.length} enemy units${missing.length ? ` (not found: ${missing.join(', ')})` : ''}`, true);
    } catch (e) {
      this._orbat = null;
      this._host.log(`Intelligent Deployment: no ORBAT at ${base} (${e instanceof Error ? e.message : String(e)}): doctrine figures only`, false);
    }
  }

  /** What a layout wants of its unit: a Bn plan its Coys (4), a Coy plan its Pls (3); 0: nothing to count. */
  private _needOf(recipe: Recipe): number {
    if (recipe.echelon !== '16' && recipe.echelon !== '15') return 0;
    const sub = recipe.echelon === '16' ? '15' : '14';
    return recipe.forCoys ?? (recipe.slots.filter((s) => s.echelon === sub && FOOTPRINT_ROLES.has(s.kind)).length || (recipe.echelon === '16' ? 4 : 3));
  }

  /**
   * The layouts of a family the unit type can use. A Bn family holds layouts for four Coys and for three (Lt Cdo): the
   * ones shown are for the type chosen, else for four. Other families show every layout.
   */
  private _famIds(fam: Family | undefined): string[] {
    if (!fam) return [];
    if (fam.echelon !== '16') return fam.recipes;
    const need = (id: string) => { const r = this._recipes.get(id); return r ? this._needOf(r) : 4; };
    const counts = new Set(fam.recipes.map(need));
    if (counts.size < 2) return fam.recipes;
    const t = this._unitId ? this._types.find((x) => x.id === this._unitId) : null;
    const want = t && counts.has(t.coys) ? t.coys : need(fam.recipes.find((id) => !this._recipes.get(id)?.forCoys) ?? fam.recipes[0]);
    return fam.recipes.filter((id) => need(id) === want);
  }

  /** The Coy counts a family's layouts are for (a Bn family: 4, and 3 where it has 3-Coy layouts). */
  private _famNeeds(fam: Family | undefined): Set<number> {
    return new Set((fam?.recipes ?? []).map((id) => { const r = this._recipes.get(id); return r ? this._needOf(r) : 4; }));
  }

  /**
   * The own unit the recipe is laid for (ORBAT): the type chosen (a Bn plan the type itself, a Coy or Pl plan its rifle
   * Coy or Pl; a Bde plan the Bde type), else the family's, else the standard one. A type these layouts cannot use
   * (a 3-Coy Bn for a 4-Coy layout) is not taken.
   */
  private _unit(recipe: Recipe | null | undefined): UnitBrief | null {
    if (!recipe || !this._orbat) return null;
    const fam = this._families.find((f) => f.recipes.includes(baseId(recipe.id)));
    const preferred = recipe.unit ?? fam?.unit;
    const t = this._unitId ? this._types.find((x) => x.id === this._unitId) : null;
    const type = t && typeFits(t, recipe.echelon, this._needOf(recipe)) ? t.id : null;
    const b = brief(this._orbat, unitForPlan(this._orbat, recipe.echelon, { type, bde: this._bdeId, div: this._divId, preferred })) ?? brief(this._orbat, ownUnitFor(recipe.echelon, preferred));
    return this._atGrouped(recipe) ? withAtGroup(this._orbat, b, this._atId, this._atCoys) : b;
  }

  /** The AT grouping applies to a Bn defence: LAT / HAT Coys grouped to it add their ATGM pairs on the tank approaches. */
  private _atGrouped(recipe: Recipe | null | undefined): boolean {
    return !!this._atId && !!recipe && recipe.echelon === '16' && recipe.task === 'defence';
  }

  /** The enemy's unit in the ORBAT for the recipe's enemy (Sec 13). */
  private _enUnit(recipe: Recipe, kind: TerrainKind | null): UnitBrief | null {
    if (!this._orbat) return null;
    const e = this._enemyFor(recipe, kind);
    return brief(this._orbat, enUnitFor(e.echelon, e.type, kind));
  }

  /** The doctrine with the unit's own weapon ranges (ORBAT), and the symbol catalogue. */
  private _ctx(recipe: Recipe | null | undefined) {
    return { doc: doctrineForUnit(this._doc, this._unit(recipe)), symbols: symbolMeta as any };
  }

  /** The recipe for an id (with or without the two-phase suffix): the two-phase version when Phases is 2. */
  private _rcp(id: string): Recipe | undefined {
    const t = this._rcpBase(id);
    const a = this._artyId ? this._artyTypes.find((x) => x.id === this._artyId) : null;
    if (!t || !a || t.echelon !== '16' || (t.task !== 'defence' && t.task !== 'attack')) return t;
    const key = `${t.id}:gun:${a.id}`;
    let g = this._ph2.get(key);
    if (!g) { g = withArty(t, this._doc, artyOnPlan(a, t.task, this._artyDoc)); this._ph2.set(key, g); }
    return g;
  }

  /** The recipe with the choices that change its slots, before the artillery: his minefield, tanks, two phases. */
  private _rcpBase(id: string): Recipe | undefined {
    const base = this._recipes.get(baseId(id));
    // a crossing with his minefield assumed (PlanCrossing.withMinefield), cached like the attack's variants
    if (base?.task === 'crossing') {
      let m: Recipe = base;
      if (this._mf) {
        const key = `${base.id}:mf`;
        m = this._ph2.get(key) ?? withMinefield(base, this._doc);
        this._ph2.set(key, m);
      }
      const e = this._engr;
      if (!e || !this._orbat) return m;
      const ek = `${m.id}:en:${e.id}`;
      let x = this._ph2.get(ek);
      if (!x) { x = { ...m, id: `${m.id}-en`, name: `${m.name}, ${e.name}`, engr: { ...e, kinds: bridgeKinds(this._orbat.engrData ?? []) } }; this._ph2.set(ek, x); }
      return x;
    }
    // tank Sqns grouped to a Bn defence (PlanTanks.withDefTanks), cached like the attack's variants
    if (base?.task === 'defence' && (base.echelon === '16' || base.echelon === '15')) {
      if (!this._defTanks || !this._tankSqn) return base;
      const key = `${base.id}:dt${this._defTanks}`;
      let d = this._ph2.get(key);
      if (!d) { d = withDefTanks(base, this._doc, this._defTanks, this._tankSqn); this._ph2.set(key, d); }
      return d;
    }
    if (!base || base.task !== 'attack' || (this._phases !== 2 && this._tanks === 'none')) return base;
    const coys = this._coys, key = `${base.id}:${this._phases}:${coys}:${this._tanks}`;
    let t = this._ph2.get(key);
    if (!t) {
      t = this._phases === 2 ? twoPhaseRecipe(base, this._doc, undefined, coys) : base;
      // tanks with phase 1 (PlanTanks), after the second phase is laid
      t = withTanks(t, this._doc, this._tanks, this._tankSqn);
      this._ph2.set(key, t);
    }
    return t;
  }

  /** The tank Sqn with an attack, from the ORBAT's Armr Regt (null: not loaded; the doctrine's Sqn without counts). */
  private get _tankSqn(): TankSqn | null { return this._orbat ? tankSqnOf(this._orbat) : null; }

  private _tanksWord(m: TankMode = this._tanks): string {
    return m === 'close' ? 'tanks in close sp (armour heavy)' : m === 'fire' ? 'tanks in fire sp (infantry heavy)' : 'no tanks';
  }

  /** T while placing (or the Tanks chips): no tanks, fire sp, close sp. */
  private _setTanks(m: TankMode): void {
    this._tanks = m;
    this._swapPlan(`T: ${this._tanksWord(m)}`);
  }

  /** Phase 2's follow-up Coys: the user's choice, else attack.phase2.coys. */
  private get _coys(): 1 | 2 {
    return this._ph2Coys ?? (Number(doctrineAt(this._doc, 'attack.phase2.coys')) === 1 ? 1 : 2);
  }

  private _coysWord(c: 1 | 2 = this._coys): string { return c === 2 ? 'C, D Coys (no Bn reserve)' : 'C Coy, D Coy the reserve'; }

  /** An attack is being built (the P key applies). */
  private get _isAttack(): boolean { return this._recipes.get(baseId(this._recipeId))?.task === 'attack'; }

  /** A crossing is being built (PlanCrossing). */
  private get _isCrossing(): boolean { return this._recipes.get(baseId(this._recipeId))?.task === 'crossing'; }

  /** An ambush, patrol or recce is being built (PlanSmallOps; the M key, the aim point). */
  private get _isSmall(): boolean { return SMALL_TASKS.includes(this._recipes.get(baseId(this._recipeId))?.task ?? ''); }
  private get _smallTask(): string { return this._isSmall ? this._recipes.get(baseId(this._recipeId))!.task : ''; }
  /** The recce laid as a screen (IC s73): the click is the Wdr RV in the main posn. */
  private get _isScreen(): boolean { return this._isSmall && this._recipes.get(baseId(this._recipeId))?.layout === 'screen'; }

  /** A patrol's Obj or a recce's NAI follows the cursor while aiming: the aimed distance, ground metres. */
  private _aimM(anchor: XY, cursor: XY | null): number | null {
    if (!cursor || this._smallTask === 'ambush') return null;
    const k = 1 / Math.cos(2 * Math.atan(Math.exp(anchor.y / R_EARTH)) - Math.PI / 2);
    const d = Math.hypot(cursor.x - anchor.x, cursor.y - anchor.y) / k;
    return d > 50 ? d : null;
  }

  /** M while placing (or the Target chips): the ambush's target. */
  private _setMover(m: Mover): void {
    this._mover = m;
    this._swapPlan(`M: target ${MOVER_LABEL[m].toLowerCase()}`);
  }

  /** A two-phase attack is being built (the R key and the card's hint apply). */
  private get _isPh2(): boolean { return this._phases === 2 && this._isAttack; }

  /**
   * R while placing (or the Ph 2 by chips): phase 2 by both follow-up Coys or by C Coy with D Coy kept as the reserve.
   * The plan is solved again; while placing, the ghost is swapped for the new one and, at rest, fitted again on the spot.
   */
  private _setCoys(c: 1 | 2): void {
    this._ph2Coys = c;
    this._swapPlan(`R: phase 2 by ${this._coysWord(c)}`);
  }

  /** P while placing (or the Phases chips): an attack in one phase or two, swapped on the fly. */
  private _setPhases(n: 1 | 2): void {
    this._phases = n;
    this._swapPlan(n === 2 ? `P: two phases, Ph 2 by ${this._coysWord()}` : 'P: one phase, a reserve kept');
  }

  /** The plan solved again after a choice; while placing, the ghost swapped and, at rest, fitted again on the spot. */
  private _swapPlan(note: string): void {
    this._solve();
    const p = this._placing, res = this._result;
    if (!p || !res) return;
    const out = this._docFor(res);
    p.baseDoc = out.doc;
    Object.assign(p.entry, { roles: out.roles, hidden: out.hidden, recipe: res.recipe.id, name: `${res.recipe.name} (built)` });
    this._jNote = note;
    if (this._rest && this._terrain) { this._manual = {}; this._jMoved.clear(); this._fitAtRest(); return; }
    this._host.replace(out.doc, false);
    p.swapped = false;
    this._showCard(this._rest?.screen ?? null, `<div class="pb-card-dim">${esc(this._jNote)}</div>`);
  }

  /** Hostile units and posns drawn on the map, for Obj 2 (read once per placement). */
  private _enemyPosns(): XY[] {
    if (this._enemyAt) return this._enemyAt;
    try {
      const rd = this._host.readDrawn?.('all');
      const syms = rd ? readSymbols(rd.records) : [];
      this._enemyAt = syms.filter((x) => x.side === 'enemy' && !x.pbRole && x.pts.length && (x.key.startsWith('10') || /^251512/.test(x.key)))
        .map((x) => ({ x: x.pts.reduce((a, q) => a + q.x, 0) / x.pts.length, y: x.pts.reduce((a, q) => a + q.y, 0) / x.pts.length }));
    } catch { this._enemyAt = []; }
    return this._enemyAt;
  }

  private _pickDefaults(): void {
    const fams = this._families.filter((f) => f.task === this._task);
    if (!fams.some((f) => f.id === this._familyId)) this._familyId = fams[0]?.id ?? '';
    const fam = this._families.find((f) => f.id === this._familyId);
    const ids = this._famIds(fam);
    if (fam && !ids.includes(this._recipeId)) this._recipeId = ids[0] ?? '';
    if (fam && ids.length < 2) this._auto = false;
    this._solve();
  }

  private _solve(): void {
    const r = this._rcp(this._recipeId);
    if (!r) { this._result = null; this._lastFit = null; return; }
    // ambush, patrol, recce: laid by the solver's shapes; no enemy force, ground kind or ORBAT rows
    if (SMALL_TASKS.includes(r.task)) { this._result = solveSmall(r, this._ctx(r), this._opts(), null); this._lastFit = null; return; }
    // a crossing: laid by its shapes (PlanCrossing re-lays it along the obstacle); no enemy force or ORBAT rows
    if (r.task === 'crossing') { this._result = solveRecipe(r, this._ctx(r), this._opts()); this._lastFit = null; return; }
    const unit = this._unit(r), ctx = this._ctx(r);
    const opts = { ...this._opts(), mountedReserve: !!unit?.mounted };
    let res = solveRecipe(r, ctx, opts);
    // the unit's other ATGM pairs (ORBAT): without the ground, on the open flanks of the FDL
    const extras = r.task === 'attack' ? [] : atgmExtras(res, r, unit, null, null, ctx.doc);
    if (extras.length) res = solveRecipe(r, ctx, { ...opts, extraPoints: extras });
    this._result = this._withContext(res);
    this._lastFit = null;
  }

  /** Both sides' strengths from the ORBAT, for the force ratio. */
  private _force(recipe: Recipe, kind: TerrainKind | null) {
    return forceFromOrbat(this._unit(recipe), this._enUnit(recipe, kind), recipe.tanks || recipe.defTanks ? this._tankSqn : null, recipe.defTanks ?? 1, recipe.defTanksUnit === 'Tp');
  }

  /** The artillery's rows without the ground: Arty reach (his FUP for his type in defence). */
  private _artyGeomRows(res: SolveResult): Check[] {
    if (!res.recipe.arty) return [];
    const kind = this._ground === 'auto' ? null : this._ground;
    const fup = res.recipe.task === 'attack' ? null : enemyFupM(this._doc, this._enemyFor(res.recipe, kind).type)[0];
    return artyRows(res.items, res.recipe, fup);
  }

  /** The rows the ORBAT adds to a defence: the protective minefield in time (engineer rates). */
  private _orbatRows(res: SolveResult): Check[] {
    if (!this._orbat || res.recipe.task === 'attack') return [];
    const m = minefieldRow(this._orbat, this._doc, res.frontageM, this._unit(res.recipe), this._engr);
    // tank Sqns and artillery without the ground; a fitted plan has had them from PlanFit already (on the ground)
    if (res.mode === 'terrain') return m ? [m] : [];
    return [...(m ? [m] : []), ...(res.recipe.defTanks ? defTankRows(res.items, res.recipe, null, null, this._doc, null) : []), ...this._artyGeomRows(res)];
  }

  /** The enemy for a recipe: the user's echelon / type over the doctrinal default (PlanContext.defaultEnemy). */
  private _enemyFor(recipe: Recipe, kind: TerrainKind | null): EnemySpec {
    const d = defaultEnemy(this._doc, recipe.echelon, kind, recipe.task);
    const user = this._enEch !== 'auto' || this._enType !== 'auto';
    return { echelon: this._enEch !== 'auto' ? this._enEch : d.echelon, type: this._enType !== 'auto' ? this._enType : d.type, source: user ? 'user' : 'default' };
  }

  /** Geometry mode (and before a fit): the ground as set, or plains assumed; the enemy and force rows. */
  private _withContext(res: SolveResult): SolveResult {
    const r = res.recipe;
    const t: TerrainSpec = this._ground !== 'auto' ? { kind: this._ground, source: 'user' } : { kind: 'plains', source: 'assumed', why: this._terrain ? 'read where the plan rests, once it is placed' : 'no terrain data' };
    const rows = applyContext(res.rows, this._doc, r.echelon, r.task, res.frontageM, r.slots.filter((s) => s.kind === 'fwd').length, this._enemyFor(r, t.kind), t, this._force(r, t.kind));
    const h = r.task === 'attack' ? attackTimes(res, null, null, this._doc, t.kind, this._night, null) : null;
    const tk = h && r.tanks ? addTankTimes(h, res, null, null, this._doc, this._night, r.tanks, null) : [];
    const p2 = h ? phase2Row(h, this._doc) : null;
    return { ...res, rows: [...rows, ...this._orbatRows(res), ...(r.task === 'attack' ? this._artyGeomRows(res) : []), ...(h ? [hSumRow(h, this._doc)] : []), ...(p2 ? [p2] : []), ...tk] };
  }

  // ── terrain ──────────────────────────────────────────────────────────────────────────────────────────────────
  private get _terrain(): boolean { return this._probeState === 'ready' && !!this._probe?.ready; }

  private async _openProbe(): Promise<void> {
    const url = String(this._settings.bundleUrl || '/terrain-bundle').replace(/\/+$/, '');
    if (this._probe && this._probeUrl === url && this._probeState !== 'off') return;
    this._closeProbe();
    this._probeUrl = url;
    this._probeState = 'loading';
    const probe = new PlanGroundProbe(() => this._onGroundChanged());
    this._probe = probe;
    // at least 256 tiles: each posn reads sight on its own 3 x 3-tile grid (four layers), and a Bde plan's posns lie
    // in different tiles; with 64 the grids evicted each other and never finished loading
    const ok = await probe.configure(url, { cacheTiles: Math.max(Number(this._settings.cacheTiles) || 0, 256), useWorker: this._settings.useWorker !== false });
    if (this._probe !== probe || this._destroyed) { probe.destroy(); return; }
    if (ok) { this._probeState = 'ready'; this._host.log(`Intelligent Deployment: terrain bundle at ${url} (${probe.dataLine()})`, true); }
    else { this._probeState = 'missing'; probe.destroy(); this._probe = null; this._host.log(`Intelligent Deployment: no terrain bundle at ${url}: geometry only`, false); }
    this._render();
  }

  private _closeProbe(): void {
    this._probe?.destroy();
    this._probe = null;
    this._probeState = 'off';
    this._probeUrl = '';
  }

  /** Tiles arrived: a fit that met loading ground runs again where the mouse rests. */
  private _onGroundChanged(): void {
    if (this._rest && this._placing && this._ranked.some((f) => f.fit.pending)) this._fitAtRest();
    // Check my plan: tiles that arrived after the check are read again (once they stop coming)
    if (this._mode === 'check' && this._checkRecs && this._check) {
      if (this._checkTimer) clearTimeout(this._checkTimer);
      this._checkTimer = setTimeout(() => { this._checkTimer = null; this._runCheck(); }, 300);
    }
  }

  // ── the threat marker ────────────────────────────────────────────────────────────────────────────────────────
  private _arm(): void {
    const view = this._host.view();
    if (!view) return;
    this._disarm();
    this._msg = 'Click on the map where the enemy comes from (Esc to stop).';
    this._arming = view.on('click', (evt: any) => {
      evt.stopPropagation?.();
      const mp = evt.mapPoint;
      if (mp) this._threat = this._merc(mp);
      this._disarm();
      this._msg = this._threat ? (this._mode === 'check' ? 'Threat marked: the plan is checked against it.' : 'Threat marked: the plan faces it, and one click places it.') : '';
      this._drawThreat();
      if (this._mode === 'check' && this._checkRecs) this._runCheck();
      this._render();
    });
    this._armKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { this._disarm(); this._msg = ''; this._render(); } };
    document.addEventListener('keydown', this._armKey);
  }
  private _disarm(): void {
    this._arming?.remove();
    this._arming = null;
    if (this._armKey) document.removeEventListener('keydown', this._armKey);
    this._armKey = null;
  }
  private _merc(p: any): XY {
    if (p.spatialReference?.wkid === 4326) {
      const la = Math.max(-85, Math.min(85, p.y));
      return { x: (p.x * Math.PI * R_EARTH) / 180, y: R_EARTH * Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360)) };
    }
    return { x: p.x, y: p.y };
  }

  private _layerOn(): GraphicsLayer | null {
    const view = this._host.view();
    if (!view?.map) return null;
    if (!this._layer || !view.map.layers.includes(this._layer)) {
      this._layer?.destroy();
      this._layer = new GraphicsLayer({ id: 'ms-plan-builder', listMode: 'hide', title: 'Plan Builder' });
      view.map.add(this._layer);
    }
    return this._layer;
  }
  private _drawThreat(): void {
    const layer = this._layerOn();
    if (!layer) return;
    layer.graphics.removeMany(layer.graphics.filter((g) => g.attributes?.kind === 'threat').toArray());
    if (!this._threat) return;
    const at = new Point({ x: this._threat.x, y: this._threat.y, spatialReference: MERC });
    layer.addMany([
      new Graphic({ geometry: at, symbol: new SimpleMarkerSymbol({ style: 'diamond', size: 16, color: [229, 72, 77, 0.85], outline: { color: [20, 24, 29], width: 1.5 } }), attributes: { kind: 'threat' } }),
      new Graphic({ geometry: at, symbol: new TextSymbol({ text: 'Threat', color: [255, 208, 209], haloColor: [20, 24, 29], haloSize: 1.5, yoffset: 14, font: { size: 10, weight: 'bold' } }), attributes: { kind: 'threat' } }),
    ]);
  }

  // ── actions ──────────────────────────────────────────────────────────────────────────────────────────────────
  private _onClick = (e: MouseEvent): void => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-pb]');
    if (!t || t.getAttribute('aria-disabled') === 'true') return;
    const [act, val] = (t.dataset.pb ?? '').split(':');
    this._msg = '';
    switch (act) {
      case 'step': this._step = Number(val) || 1; break;
      case 'task': {
        const task = TASKS.find((x) => x.id === val);
        if (task?.later) { this._msg = `${task.label}: ${task.later}.`; break; }
        this._task = val; this._defTanks = 0; this._auto = false; this._pickDefaults(); break;
      }
      case 'family': this._defTanks = 0; this._familyId = val; this._recipeId = ''; this._auto = false; this._pickDefaults(); break;
      case 'layout': this._recipeId = val; this._auto = false; this._solve(); break;
      case 'auto':
        if (!this._terrain) { this._msg = 'Auto ranks the layouts on the ground: it needs terrain data.'; break; }
        this._auto = true; break;
      case 'moreTypes': this._allTypes = !this._allTypes; break;
      case 'detail': this._detail = val === 'pl' ? 'pl' : 'coy'; this._solve(); break;
      case 'alt': this._alternates = (val as any) || 'hidden'; this._altFromSettings = false; this._solve(); break;
      case 'threat': this._arm(); break;
      case 'clearThreat': this._threat = null; this._disarm(); this._drawThreat(); if (this._mode === 'check' && this._checkRecs) this._runCheck(); break;
      case 'mode':
        this._mode = val === 'check' ? 'check' : 'build';
        if (this._mode === 'build') { this._clearProducts(); if (this._lastFit && this._step === 4) this._drawProducts(this._lastFit as Fitted); }
        else if (this._check) this._drawCheck(this._check);
        break;
      case 'enEch': this._enEch = val || 'auto'; this._solve(); if (this._mode === 'check' && this._checkRecs) this._runCheck(); break;
      case 'enType': this._enType = (val as any) || 'auto'; this._solve(); if (this._mode === 'check' && this._checkRecs) this._runCheck(); break;
      case 'night': this._night = val === 'on'; this._solve(); break;
      case 'phases': this._setPhases(val === '2' ? 2 : 1); break;
      case 'ph2Coys': this._setCoys(val === '1' ? 1 : 2); break;
      case 'tanks': this._setTanks(val === 'close' || val === 'fire' ? val : 'none'); break;
      case 'mover': this._setMover(MOVERS.includes(val as Mover) ? (val as Mover) : 'wheeled'); break;
      case 'mf': this._mf = val === 'on'; this._swapPlan(this._mf ? 'His minefield assumed: the home side drawn back, a lane to each crossing place' : 'No minefield known'); break;
      case 'light': this._light = val === 'day' || val === 'moon' ? val : 'dark'; this._swapPlan(`Light: ${this._light === 'moon' ? 'moonlight' : this._light === 'dark' ? 'dark night' : 'day'}`); break;
      case 'ground': this._ground = (val as any) || 'auto'; this._solve(); if (this._mode === 'check' && this._checkRecs) this._runCheck(); break;
      case 'checkScope': this._checkScope = (val as any) || 'selected'; break;
      case 'checkRun': this._readAndCheck(); return;
      case 'role': {
        const p = this._check?.posns.find((x) => x.id === val);
        if (!p) break;
        const i = ROLE_CYCLE.indexOf(p.kind);
        this._checkKinds = { ...this._checkKinds, [val]: ROLE_CYCLE[(i + 1) % ROLE_CYCLE.length] };
        this._runCheck();
        break;
      }
      case 'checkCopy': void this._copyCheck(); return;
      case 'checkClear': this._check = null; this._checkRecs = null; this._checkKinds = {}; this._clearProducts(); break;
      case 'unitType': this._unitId = val || null; this._pickDefaults(); break;
      case 'bdeType': this._bdeId = val || null; this._solve(); break;
      case 'divType': this._divId = val || null; this._solve(); break;
      case 'atType': this._atId = val || null; this._solve(); break;
      case 'arty': this._artyId = val || null; this._solve(); break;
      case 'engr': this._engrId = val || null; this._solve(); break;
      case 'defTanks': this._defTanks = Math.max(0, Math.min(3, Number(val) || 0)); this._solve(); break;
      case 'atCoys': this._atCoys = Math.max(1, Math.min(3, Number(val) || 1)); this._solve(); break;
      case 'retry': this._loadState = 'idle'; this.shown(); return;
      case 'place': this._place(); return;
      case 'copy': void this._copy(); return;
      case 'checkView':
        this._checkView = val === 'compare' ? 'compare' : 'plan';
        if (this._checkView === 'compare' && !this._compare) this._runCompare();
        break;
      case 'compareRun': this._runCompare(); break;
      case 'routes': this._toggleRoutes(); break;
      case 'useLayout':
        this._recipeId = baseId(val); this._auto = false; this._solve();
        this._msg = 'That layout is chosen: Place on Map lays it.';
        break;
    }
    this._render();
  };

  private _opts() {
    return { detail: this._detail, alternates: this._alternates } as const;
  }

  /** The plan document for a solved layout, its pivot and roles. */
  private _docFor(res: SolveResult) {
    return toPlanDocument(res, Plan.createSymbol as any, Plan.createOverlay as any, Date.now(), { aimAtOwnSide: res.recipe.task === 'attack', labelSize: Number(this._settings.labelSize) || 7 });
  }

  private _place(): void {
    const res = this._result;
    if (!res) return;
    this._disarm();
    const out = this._docFor(res);
    const entry: PlanEntry = {
      id: `built-${res.recipe.id}-${Date.now().toString(36)}`,
      name: `${res.recipe.name} (built)`,
      category: 'built',
      file: '',
      description: `Built from the recipe ${res.recipe.id}; laid by doctrinal spacing${this._terrain ? ', fitted to the ground where it lands' : ', ground not checked'}`,
      pivot: out.pivotId ?? undefined,
      hidden: out.hidden,
      roles: out.roles,
      recipe: res.recipe.id,
      rotate: true,
      // a defence faces the threat marker (one click); an attack is aimed from the objective toward the own side; an
      // ambush is aimed up the road toward him, a patrol at its Obj, a recce at its NAI (the second click)
      faceAt: this._threat && res.recipe.task !== 'attack' && res.recipe.task !== 'crossing' && !SMALL_TASKS.includes(res.recipe.task) ? { ...this._threat } : undefined,
      // geometry mode: the ground as set (none when Auto: nothing was read), the enemy and unit it was laid for
      meta: this._meta(res.recipe, this._ground === 'auto' ? null : this._ground, null, this._enemyFor(res.recipe, this._ground === 'auto' ? null : this._ground), this._unit(res.recipe)?.id ?? null),
    };
    this._placing = { entry, baseDoc: out.doc, swapped: false };
    this._ranked = [];
    this._manual = {};
    this._jMoved.clear();
    // J / Shift+J while placing (capture phase: the placement is modal, so it is ours, not another guide's J)
    if (this._jKey) document.removeEventListener('keydown', this._jKey, true);
    this._jKey = (e: KeyboardEvent) => {
      const isR = e.key === 'r' || e.key === 'R', isP = e.key === 'p' || e.key === 'P', isT = e.key === 't' || e.key === 'T', isM = e.key === 'm' || e.key === 'M';
      if (e.key !== 'j' && e.key !== 'J' && !isR && !isP && !isT && !isM) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      // M: an ambush's target (wheeled, tanks, on foot): what NO-GO holds it on the road
      if (isM) {
        if (this._smallTask !== 'ambush' || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        this._setMover(MOVERS[(MOVERS.indexOf(this._mover) + 1) % MOVERS.length]);
        this._render();
        return;
      }
      // J on an ambush: the KZ to the best of the better sites along the Rd (the blue ring); Shift+J back where it was
      if (this._smallTask === 'ambush' && (e.key === 'j' || e.key === 'J')) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        this._jumpAmbush(e.shiftKey);
        return;
      }
      // J moves a posn; a patrol, recce or crossing moves with the mouse (its better sites are shown on the map)
      if (this._isSmall || this._isCrossing) return;
      // R: phase 2 by both follow-up Coys, or C Coy with D Coy the reserve (two-phase attacks only)
      if (isR) {
        if (!this._isPh2 || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        this._setCoys(this._coys === 2 ? 1 : 2);
        this._render();
        return;
      }
      // T: no tanks, fire sp, close sp
      if (isT) {
        if (!this._isAttack || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        this._setTanks(this._tanks === 'none' ? 'fire' : this._tanks === 'fire' ? 'close' : 'none');
        this._render();
        return;
      }
      // P: the attack in one phase or two
      if (isP) {
        if (!this._isAttack || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        this._setPhases(this._phases === 2 ? 1 : 2);
        this._render();
        return;
      }
      if (!this._terrain) return;
      e.preventDefault();
      e.stopPropagation();
      this._jump(e.shiftKey);
    };
    document.addEventListener('keydown', this._jKey, true);
    this._cursor = null;
    this._host.hooks({
      onGhost: (anchor, bearing, phase, screen, cursor) => this._onGhost(anchor, bearing, phase, screen, cursor ?? null),
      prepareCommit: (anchor, bearing, cursor) => this._prepareCommit(anchor, bearing, cursor ?? null),
      onEnd: () => this._endPlacing(),
    });
    this._host.place(entry, out.doc);
  }

  // ── fit at rest ──────────────────────────────────────────────────────────────────────────────────────────────
  private _onGhost(anchor: XY, bearing: number | null, _phase: 'anchor' | 'bearing', screen: { x: number; y: number } | null, cursor: XY | null = null): void {
    if (!this._placing) return;
    this._cursor = cursor;
    // moving: back to the quick layout, J's moves dropped, products off, the card says so
    const aimM = this._isSmall ? this._aimM(anchor, cursor) : null;
    if (aimM !== null && this._result) {
      // a patrol's Obj or a recce's NAI follows the cursor: the quick layout stretched to it
      const res = solveSmall(this._result.recipe, this._ctx(this._result.recipe), this._opts(), aimM);
      this._host.replace(this._docFor(res).doc, false);
      this._placing.swapped = true;
    } else if (this._placing.swapped) { this._host.replace(this._placing.baseDoc, false); this._placing.swapped = false; }
    this._manual = {};
    this._jMoved.clear();
    // a J on an ambush moved the anchor: its note stays for the rest that follows; choosing freely again forgets the moves
    this._jNote = this._noteNext;
    this._noteNext = '';
    if (_phase === 'anchor') this._ambushFrom = [];
    this._clearProducts();
    if (this._restTimer) clearTimeout(this._restTimer);
    this._restTimer = null;
    this._rest = null;
    const aimWord = this._isCrossing ? 'Aim across to the far bank, then click' : this._smallTask === 'ambush' ? 'Aim up the Rd toward where he comes from, then click'
      : this._smallTask === 'patrol' ? 'Move to the Obj and click' : this._smallTask === 'recce' ? (this._isScreen ? 'Move out to the ground he would watch you from, then click' : 'Move to the area to watch (NAI) and click') : 'Aim it (move, then click)';
    if (!this._terrain || bearing === null) {
      this._showCard(screen, this._terrain ? `<div class="pb-card-dim">${aimWord} to fit it to the ground</div>` : `<div class="pb-card-dim">Geometry only: ground not checked${aimM !== null ? ` · ${this._smallTask === 'patrol' ? 'Obj' : 'NAI'} ${fmtM(aimM)}` : ''}</div>`);
      return;
    }
    this._showCard(screen, `<div class="pb-card-dim">Moving: quick ghost at ${this._isSmall ? 'the rule\'s' : 'doctrinal'} spacing${aimM !== null ? ` · ${this._smallTask === 'patrol' ? 'Obj' : 'NAI'} ${fmtM(aimM)}` : ''}</div>`);
    if (this._settings.fit?.atRest === false) return;
    const ms = Math.max(150, Number(this._settings.fit?.restMs) || 350);
    this._rest = { anchor, bearing, screen, cursor };
    this._restTimer = setTimeout(() => { this._restTimer = null; this._fitAtRest(); }, ms);
  }

  private _fitAtRest(): void {
    const p = this._placing, r = this._rest;
    if (!p || !r) return;
    const ranked = this._fitAll(r.anchor, r.bearing);
    if (!ranked.length) return;
    this._show(ranked);
  }

  /** Take a fitted layout (or ranking) as the ghost: swap the plan, draw the products, update the card. */
  private _show(ranked: Fitted[]): void {
    const p = this._placing, r = this._rest;
    if (!p || !r) return;
    this._ranked = ranked;
    const best = ranked[0];
    this._lastFit = best;
    this._syncEntry(best);
    this._host.replace(best.doc.doc, true);
    p.swapped = true;
    this._drawProducts(best);
    this._showCard(r.screen, this._cardHtml(ranked));
    if (this._step === 4) this._render();
  }

  private _prepareCommit(anchor: XY, bearing: number, cursor: XY | null = null): any | null {
    if (this._restTimer) clearTimeout(this._restTimer);
    this._restTimer = null;
    if (cursor) this._cursor = cursor;
    const small = this._isSmall;
    if (!this._terrain) {
      // geometry only: a patrol's Obj or a recce's NAI where the second click is
      const aimM = small ? this._aimM(anchor, this._cursor) : null;
      if (aimM === null || !this._result) return null;
      const res = solveSmall(this._result.recipe, this._ctx(this._result.recipe), this._opts(), aimM);
      this._result = res;
      return this._docFor(res).doc;
    }
    // the click where it rests with J's moves (or an ambush, patrol, recce fitted there): keep what is shown; elsewhere fit afresh
    const same = this._rest && this._lastFit && Math.hypot(this._rest.anchor.x - anchor.x, this._rest.anchor.y - anchor.y) < 1 && Math.abs(this._rest.bearing - bearing) < 1e-6;
    const sameAim = !small || (!!this._rest?.cursor === !!this._cursor && (!this._cursor || Math.hypot(this._rest!.cursor!.x - this._cursor.x, this._rest!.cursor!.y - this._cursor.y) < 1));
    const ranked = same && sameAim && (small || Object.keys(this._manual).length) ? [this._lastFit!] : this._fitAll(anchor, bearing);
    if (!ranked.length) return null;
    this._lastFit = ranked[0];
    this._syncEntry(ranked[0]);
    return ranked[0].doc.doc;
  }

  /** The recipes to fit: the chosen layout, or with Auto every layout of the family; best first (PlanFit.rankFits). */
  private _fitAll(anchor: XY, bearing: number, all = false): Fitted[] {
    const fam = this._families.find((f) => f.id === this._familyId);
    const ids = (this._auto || all) && fam ? this._famIds(fam) : [this._recipeId];
    const out: Fitted[] = [];
    for (const id of ids) {
      const recipe = this._rcp(id);
      if (!recipe) continue;
      const f = this._fitOne(recipe, anchor, bearing, id === this._recipeId ? this._manual : {});
      if (f) out.push(f);
    }
    // the layout this ground suggests goes first (it only breaks ties: the score card ranks them)
    const first = out[0]?.terrain ? firstLayout(this._doc, out[0].terrain.kind) : null;
    if (first && out.length > 1) out.sort((a, b) => Number(b.recipe.layout === first) - Number(a.recipe.layout === first));
    return rankFits(out);
  }

  /** What a route card's bearings are: grid and mils, magnetic too when planBuilder.gmaDeg is set. */
  private _brgNote(): string {
    const g = gmaOf(this._settings.gmaDeg);
    return g === null ? 'grid bearings and mils; set the GMA in Settings for magnetic' : `grid, mils and magnetic (GMA ${g > 0 ? '+' : ''}${g}°)`;
  }

  /** A bearing cell: grid degrees, mils under it, magnetic beside them when the GMA is set. */
  private _brgCell(gridDeg: number): string {
    const g = gmaOf(this._settings.gmaDeg);
    const mils = String(Math.round((((gridDeg % 360) + 360) % 360) * 6400 / 360) % 6400).padStart(4, '0');
    const mag = g === null ? '' : ` · ${Math.round(((((gridDeg - g) % 360) + 360) % 360))}° M`;
    return `${Math.round(gridDeg)}°<span class="pb-dim"> · ${mils} mils${mag}</span>`;
  }

  private _fitInput(recipe: Recipe, anchor: XY, bearing: number, manual: Record<string, XY>): FitLayoutInput | null {
    const probe = this._probe;
    if (!probe) return null;
    const kind = this._ground === 'auto' ? null : this._ground;
    return {
      recipe, ctx: this._ctx(recipe), opts: this._opts(), ground: probe, anchor, bearing,
      threat: this._threat, manual, begin: () => probe.begin(),
      enemy: this._enemyFor(recipe, kind), terrain: this._ground,
      unit: this._unit(recipe), force: this._force(recipe, kind),
      night: (recipe.task === 'attack' || recipe.task === 'patrol') && this._night, nmRules: this._nmRules,
      enemyAt: recipe.phases === 2 ? this._enemyPosns() : null,
      // ambush, patrol, recce (PlanSmallOps): the aim point, the Movement / Platoon Guide rules, the foot speeds, the target
      cursor: this._cursor, movRules: this._movRules, plRules: this._plRules, speeds: this._speeds, mover: this._mover,
      // a crossing (PlanCrossing): the Water engine's rules, the light (Annex Q column), this month (the season)
      waterRules: this._waterRules, light: this._light, month: new Date().getMonth() + 1,
      gmaDeg: gmaOf(this._settings.gmaDeg),
    };
  }

  private _fitOne(recipe: Recipe, anchor: XY, bearing: number, manual: Record<string, XY> = {}): Fitted | null {
    const inp = this._fitInput(recipe, anchor, bearing, manual);
    const fl = inp ? fitLayout(inp) : null;
    if (!fl || !inp) return null;
    // an ambush, patrol or recce has no posns to move or trigger table: its own reading is the fit
    if (SMALL_TASKS.includes(recipe.task) || recipe.task === 'crossing') return { ...fl, doc: this._docFor(fl.raw) };
    // the what-if: Sup and C Pen posns, routes and times against the enemy (PlanWhatIf)
    const f = withMoves(fl, inp);
    f.res = { ...f.res, rows: [...f.res.rows, ...this._orbatRows(f.res)] };
    return { ...f, doc: this._docFor(f.raw) };
  }

  /**
   * J on an ambush: the KZ to the best better site along the Rd (the blue ring), the aim kept toward the mouse; the fit
   * runs there at rest. Shift+J takes it back to where it was.
   */
  private _jumpAmbush(back: boolean): void {
    const r = this._rest, s = this._lastFit?.fit.small;
    const say = (note: string) => { this._jNote = note; this._showCard(r?.screen ?? null, this._cardHtml(this._ranked)); };
    if (!this._placing || !this._host.moveAnchor) return;
    if (back) {
      const prev = this._ambushFrom.pop();
      if (!prev) { say('Shift+J: the KZ is where you clicked it.'); return; }
      this._noteNext = 'J move taken back: the KZ where it was.';
      if (!this._host.moveAnchor(prev)) { this._ambushFrom.push(prev); this._noteNext = ''; }
      return;
    }
    if (!r || !s) { say('J works while the plan rests: click the KZ, aim, stop the mouse.'); return; }
    const b = s.better?.[0];
    if (!b) { say('J: no better site on the Rd read.'); return; }
    this._noteNext = `J: the KZ moved ${fmtM(Math.abs(b.alongM))} ${b.alongM < 0 ? 'up the Rd toward him' : 'down the Rd'} to the site that scores ${b.score} (here ${s.site?.score ?? '?'}); Shift+J takes it back`;
    this._ambushFrom.push({ x: r.anchor.x, y: r.anchor.y });
    if (!this._host.moveAnchor({ x: b.x, y: b.y })) { this._ambushFrom.pop(); this._noteNext = ''; say('J: this plan faces the threat marker; rest the mouse on the blue ring instead.'); }
  }

  /** J: the worst posn to the best spot round it (the layout shown is kept; Auto stops). Shift+J takes the last back. */
  private _jump(back: boolean): void {
    const r = this._rest, cur = this._lastFit;
    if (!this._placing || !r || !cur) { this._jNote = 'J works while the plan rests: stop the mouse first.'; this._showCard(this._rest?.screen ?? null, this._cardHtml(this._ranked)); return; }
    this._auto = false;
    this._recipeId = baseId(cur.recipe.id);
    if (back) {
      const last = [...this._jMoved].pop();
      if (!last) return;
      this._jMoved.delete(last);
      const m = { ...this._manual };
      delete m[last];
      this._manual = m;
      this._jNote = 'J move taken back.';
    } else {
      const inp = this._fitInput(cur.recipe, r.anchor, r.bearing, this._manual);
      if (!inp) return;
      // each spot fitted with its what-if, so J can also move the reserve when its moves are too slow
      const j = nextBestSpot(inp, cur, this._jMoved, (i) => { const fl = fitLayout(i); return fl ? withMoves(fl, i) : null; });
      if (!j) { this._jNote = 'J: no posn does better nearby.'; this._showCard(r.screen, this._cardHtml(this._ranked)); return; }
      this._manual = j.to.manual;
      this._jMoved.add(j.role);
      this._jNote = `J: ${j.label} moved ${fmtM(j.distM)} (Shift+J takes it back)`;
    }
    const f = this._fitOne(cur.recipe, r.anchor, r.bearing, this._manual);
    if (f) this._show([f]);
  }

  /** Every layout of the family fitted where the last fit was (Compare). */
  private _runCompare(): void {
    const f = this._lastFit;
    if (!f || !this._terrain) { this._compare = null; return; }
    this._compare = this._fitAll(f.anchor, f.bearing, true);
  }

  /** The entry the Mgr places carries the fitted layout's roles and hidden ids (Auto may change the layout). */
  private _syncEntry(f: Fitted): void {
    const e = this._placing?.entry;
    if (!e) return;
    e.roles = f.doc.roles;
    e.hidden = f.doc.hidden;
    e.recipe = f.recipe.id;
    e.name = `${f.recipe.name} (built)`;
    e.meta = this._meta(f.recipe, f.terrain?.kind ?? null, f.terrain?.why ?? null, f.enemy, f.unit?.id ?? null);
  }

  /** What a plan was built for, carried on its graphics (`pbMeta`) so Check my plan reads it against the same. */
  private _meta(recipe: Recipe, ground: TerrainKind | null, groundWhy: string | null, enemy: EnemySpec | null, unit: string | null): Record<string, unknown> {
    return {
      ground, groundWhy,
      enemy: enemy ? { echelon: enemy.echelon, type: enemy.type } : null,
      unit, threat: this._threat && recipe.task !== 'attack' ? { ...this._threat } : null,
      // the AT Coys grouped to it (read back by Check my plan for the ATGM pairs and AT cover)
      atGroup: this._atGrouped(recipe) ? { id: this._atId, coys: this._atCoys } : null,
      defTanks: recipe.defTanks ?? 0,
      defTanksUnit: recipe.defTanksUnit ?? null,
      arty: recipe.arty ?? null,
      engr: this._engr && (recipe.task === 'defence' || recipe.task === 'crossing') ? this._engr.id : null,
    };
  }

  private _endPlacing(): void {
    if (this._restTimer) clearTimeout(this._restTimer);
    this._restTimer = null;
    this._rest = null;
    this._placing = null;
    this._enemyAt = null;
    this._manual = {};
    this._jMoved.clear();
    this._jNote = '';
    this._ambushFrom = [];
    this._noteNext = '';
    if (this._jKey) document.removeEventListener('keydown', this._jKey, true);
    this._jKey = null;
    this._host.hooks(null);
    this._clearProducts();
    this._card?.remove();
    this._card = null;
    this._compare = null;
    this._routesShown = false;
    if (this._lastFit && !this._destroyed) {
      // what was placed: the Check step shows its fit
      this._recipeId = baseId(this._lastFit.recipe.id);
      this._result = this._lastFit.res;
      this._render();
    }
  }

  // ── what the fit draws ───────────────────────────────────────────────────────────────────────────────────────
  private _clearProducts(): void {
    const l = this._layer;
    if (!l) return;
    l.graphics.removeMany(l.graphics.filter((g) => g.attributes?.kind !== 'threat').toArray());
  }

  private _drawProducts(f: Fitted): void {
    const layer = this._layerOn();
    if (!layer) return;
    this._clearProducts();
    const gs: Graphic[] = [];
    for (const a of f.fit.approaches) {
      const path = a.path.map((p) => [p.x, p.y]);
      if (path.length < 2) continue;
      gs.push(new Graphic({ geometry: new Polyline({ paths: [path], spatialReference: MERC }), symbol: new SimpleLineSymbol({ color: [255, 107, 111, a.main ? 0.9 : 0.6], width: a.main ? 3 : 2, style: a.main ? 'solid' : 'dash' }), attributes: { kind: 'apch' } }));
      const mid = a.path[Math.floor(a.path.length * 0.35)];
      gs.push(new Graphic({ geometry: new Point({ x: mid.x, y: mid.y, spatialReference: MERC }), symbol: new TextSymbol({ text: `${a.id}${a.main ? ' main' : ''}`, color: [255, 179, 181], haloColor: [20, 24, 29], haloSize: 1.5, font: { size: 10, weight: 'bold' } }), attributes: { kind: 'apch' } }));
      for (const c of a.chokes.slice(0, 3)) gs.push(new Graphic({ geometry: new Point({ x: c.at.x, y: c.at.y, spatialReference: MERC }), symbol: new SimpleMarkerSymbol({ style: 'circle', size: 10, color: [0, 0, 0, 0], outline: { color: [255, 107, 111], width: 2 } }), attributes: { kind: 'apch' } }));
    }
    gs.push(...this._routeGraphics(f));
    gs.push(...this._attackGraphics(f));
    gs.push(...this._smallGraphics(f));
    gs.push(...this._crossGraphics(f));
    // each posn's ground verdict as a ring at its centre
    for (const s of f.res.slots) {
      const w = toWorld(f.frame, s.centre);
      gs.push(new Graphic({ geometry: new Point({ x: w.x, y: w.y, spatialReference: MERC }), symbol: new SimpleMarkerSymbol({ style: 'circle', size: 13, color: [...RGB[s.st], 0.35] as any, outline: { color: RGB[s.st], width: 2.5 } }), attributes: { kind: 'status' } }));
    }
    layer.addMany(gs);
  }

  /**
   * An attack on the map: the fire-lift rings round the objective with the minute each lifts (IC s66 p305), the route
   * on foot from the Assy Area to the FUP, and his MSR choke behind the objective.
   */
  private _attackGraphics(f: Fitted): Graphic[] {
    const a = f.fit.attack;
    const obj = f.raw.items.find((i) => i.role === 'obj');
    if (!a || !obj) return [];
    const gs: Graphic[] = [];
    const W = (p: XY) => toWorld(f.frame, p);
    const text = (p: XY, t: string, color: number[], size = 9, yoffset = 0) => new Graphic({ geometry: new Point({ x: p.x, y: p.y, spatialReference: MERC }), symbol: new TextSymbol({ text: t, color: color as any, haloColor: [20, 24, 29], haloSize: 1.5, yoffset, font: { size, weight: 'bold' } }), attributes: { kind: 'lift' } });
    // labels round the objective's far right corner, or (Obj 1 of two) its near left corner, clear of Obj 2's
    const liftRings = (pts: XY[], lifts: { label: string; rM: number; at: number }[], tag: string, near = false) => {
      const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x)), y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
      lifts.forEach((l, li) => {
        // the objective's outline grown by the ring's distance, its corners rounded
        const r = l.rM, ring: number[][] = [];
        const corners: [number, number, number][] = [[x1, y1, 0], [x1, y0, 90], [x0, y0, 180], [x0, y1, 270]];
        for (const [cx, cy, a0] of corners) for (let d = 0; d <= 90; d += 15) { const t = ((a0 + d) * Math.PI) / 180; const w = W({ x: cx + r * Math.sin(t), y: cy + r * Math.cos(t) }); ring.push([w.x, w.y]); }
        ring.push(ring[0]);
        gs.push(new Graphic({ geometry: new Polyline({ paths: [ring], spatialReference: MERC }), symbol: new SimpleLineSymbol({ color: [238, 138, 31, 0.75], width: 1.5, style: 'short-dash' }), attributes: { kind: 'lift' } }));
        const la = ((near ? 195 + li * 25 : 15 + li * 25) * Math.PI) / 180;
        gs.push(text(W({ x: (near ? x0 : x1) + r * Math.sin(la), y: (near ? y0 : y1) + r * Math.cos(la) }), `${tag}${l.label} ${hRelText(l.at)}`, [255, 196, 120], 8));
      });
    };
    // two phases: the lifts on Obj 2 from H2, the follow-up Coys' way round Obj 1, H2 at SL 2
    const obj2 = f.raw.items.find((i) => i.role === 'obj2'), p2 = a.hSum?.phase2;
    liftRings(obj.pts, a.hSum?.lifts ?? [], '', !!(obj2 && p2));
    if (obj2 && p2) liftRings(obj2.pts, p2.lifts, 'Ph 2 ');
    const r2 = a.phase2?.route;
    if (r2 && r2.length >= 2 && p2) {
      gs.push(new Graphic({ geometry: new Polyline({ paths: [r2.map((p) => { const w = W(p); return [w.x, w.y]; })], spatialReference: MERC }), symbol: new SimpleLineSymbol({ color: [142, 193, 234, 0.9], width: 2, style: 'short-dot' }), attributes: { kind: 'route' } }));
      const who = f.raw.items.filter((i) => i.role === 'fu1' || i.role === 'fu2').map((i) => i.label.replace(/ Coy$/, '')).join(', ');
      gs.push(text(W(r2[Math.floor(r2.length / 2)]), `${who} Coy${who.includes(',') ? 's' : ''} to FUP 2 ${hRelText(p2.h2At - p2.gapMin)}`, [142, 193, 234]));
      const sl2 = f.raw.items.find((i) => i.role === 'sl2');
      if (sl2) gs.push(text(W({ x: sl2.pts.reduce((s, p) => s + p.x, 0) / sl2.pts.length, y: sl2.pts.reduce((s, p) => s + p.y, 0) / sl2.pts.length }), `H2 = ${hRelText(p2.h2At)}`, [255, 196, 120], 9, -12));
    }
    if (a.route && a.route.length >= 2) {
      gs.push(new Graphic({ geometry: new Polyline({ paths: [a.route.map((p) => { const w = W(p); return [w.x, w.y]; })], spatialReference: MERC }), symbol: new SimpleLineSymbol({ color: [142, 193, 234, 0.9], width: 2, style: 'short-dash' }), attributes: { kind: 'route' } }));
      const m = W(a.route[Math.floor(a.route.length / 2)]);
      if (a.hSum) gs.push(new Graphic({ geometry: new Point({ x: m.x, y: m.y, spatialReference: MERC }), symbol: new TextSymbol({ text: `leave Assy ${hRelText(-a.hSum.leaveBeforeH)}`, color: [142, 193, 234], haloColor: [20, 24, 29], haloSize: 1.5, font: { size: 9, weight: 'bold' } }), attributes: { kind: 'route' } }));
    }
    // the tanks (PlanTanks): when they leave FUP (Tks), their way to the fire posns (fire sp) or when they rush (close sp)
    const ht = a.hSum?.tanks, tkFup = f.raw.items.find((i) => i.role === 'tkFup');
    if (ht && tkFup) {
      const tkText = (p: XY, t: string, yoff = 0) => gs.push(new Graphic({ geometry: new Point({ x: p.x, y: p.y, spatialReference: MERC }), symbol: new TextSymbol({ text: t, color: [150, 214, 150], haloColor: [20, 24, 29], haloSize: 1.5, yoffset: yoff, font: { size: 9, weight: 'bold' } }), attributes: { kind: 'tanks' } }));
      const fc = tkFup.pts.reduce((s, p) => ({ x: s.x + p.x / tkFup.pts.length, y: s.y + p.y / tkFup.pts.length }), { x: 0, y: 0 });
      tkText(W(fc), `Tks leave ${hRelText(ht.leaveAt)}`, -14);
      const route = a.tanks?.route;
      if (route && route.length >= 2) {
        gs.push(new Graphic({ geometry: new Polyline({ paths: [route.map((p) => { const w = W(p); return [w.x, w.y]; })], spatialReference: MERC }), symbol: new SimpleLineSymbol({ color: [150, 214, 150, 0.9], width: 2, style: 'short-dash' }), attributes: { kind: 'tanks' } }));
        tkText(W(route[route.length - 1]), `Tks firing ${hRelText(ht.atAt)}`, 14);
      }
      const tkAx = f.raw.items.find((i) => i.role === 'tkAxis');
      if (tkAx && ht.onObjAt !== null) tkText(W(tkAx.pts[tkAx.pts.length - 1]), `Tks at aslt line ${hRelText(ht.atAt)}, on Obj ${hRelText(ht.onObjAt)}`, 14);
    }
    // his counter-attack ways in onto the last objective (reorganisation): red dashes, a DF target on each
    for (const c of a.counter?.apchs ?? []) {
      const path = c.path.filter((_, i) => i % 4 === 0 || i === c.path.length - 1).map((p) => { const w = W(p); return [w.x, w.y]; });
      gs.push(new Graphic({ geometry: new Polyline({ paths: [path], spatialReference: MERC }), symbol: new SimpleLineSymbol({ color: [229, 72, 77, c.deadAtM !== null ? 0.95 : 0.6], width: 2, style: 'dash' }), attributes: { kind: 'counter' } }));
      const lab = W(c.path[Math.floor(c.path.length * 0.3)]);
      gs.push(new Graphic({ geometry: new Point({ x: lab.x, y: lab.y, spatialReference: MERC }), symbol: new TextSymbol({ text: `En CA from ${c.from}${c.deadAtM !== null ? ` · dead Gr ${fmtM(c.deadAtM)}` : ''}`, color: [255, 179, 181], haloColor: [20, 24, 29], haloSize: 1.5, font: { size: 8, weight: 'bold' } }), attributes: { kind: 'counter' } }));
      if (c.df) {
        const d = W(c.df);
        gs.push(new Graphic({ geometry: new Point({ x: d.x, y: d.y, spatialReference: MERC }), symbol: new SimpleMarkerSymbol({ style: 'x', size: 10, color: [255, 196, 120], outline: { color: [255, 196, 120], width: 2 } }), attributes: { kind: 'counter' } }));
        gs.push(new Graphic({ geometry: new Point({ x: d.x, y: d.y, spatialReference: MERC }), symbol: new TextSymbol({ text: 'DF', color: [255, 196, 120], haloColor: [20, 24, 29], haloSize: 1.5, xoffset: 10, font: { size: 8, weight: 'bold' } }), attributes: { kind: 'counter' } }));
      }
    }
    if (a.choke) {
      const w = W(a.choke.at);
      gs.push(new Graphic({ geometry: new Point({ x: w.x, y: w.y, spatialReference: MERC }), symbol: new SimpleMarkerSymbol({ style: 'diamond', size: 13, color: [229, 72, 77, 0.3], outline: { color: [229, 72, 77], width: 2 } }), attributes: { kind: 'choke' } }));
      gs.push(new Graphic({ geometry: new Point({ x: w.x, y: w.y, spatialReference: MERC }), symbol: new TextSymbol({ text: `En MSR: ${a.choke.kind}`, color: [255, 179, 181], haloColor: [20, 24, 29], haloSize: 1.5, yoffset: 12, font: { size: 9, weight: 'bold' } }), attributes: { kind: 'choke' } }));
    }
    return gs;
  }

  /**
   * An ambush, patrol or recce on the map (PlanSmallOps): the road read and the KZ points the fire group sees (green)
   * or not (red), better sites along the road as rings with their score; the patrol's stretches the threat may see
   * (red) and those hidden from it (green), dangers on the way; each OP's view of the NAI (green dots seen, red not).
   */
  private _smallGraphics(f: Fitted): Graphic[] {
    const s = f.fit.small;
    if (!s) return [];
    const gs: Graphic[] = [];
    const line = (pts: number[][], color: number[], width: number, style: string, kind = 'small') => {
      if (pts.length >= 2) gs.push(new Graphic({ geometry: new Polyline({ paths: [pts], spatialReference: MERC }), symbol: new SimpleLineSymbol({ color: color as any, width, style: style as any }), attributes: { kind } }));
    };
    const dot = (x: number, y: number, color: number[], size = 6, style = 'circle') => gs.push(new Graphic({ geometry: new Point({ x, y, spatialReference: MERC }), symbol: new SimpleMarkerSymbol({ style: style as any, size, color: color as any, outline: { color: [20, 24, 29, 0.8], width: 0.8 } }), attributes: { kind: 'small' } }));
    const label = (x: number, y: number, text: string, color: number[], yoffset = 12, size = 9) => gs.push(new Graphic({ geometry: new Point({ x, y, spatialReference: MERC }), symbol: new TextSymbol({ text, color: color as any, haloColor: [20, 24, 29], haloSize: 1.5, yoffset, font: { size, weight: 'bold' } }), attributes: { kind: 'small' } }));
    if (s.task === 'ambush') {
      if (s.road) line(s.road, [255, 214, 102, 0.55], 4, 'solid');
      for (const p of s.kzPts ?? []) dot(p.x, p.y, p.seen ? [47, 168, 98, 0.95] : [229, 72, 77, 0.95], 6);
      for (const b of s.better ?? []) {
        gs.push(new Graphic({ geometry: new Point({ x: b.x, y: b.y, spatialReference: MERC }), symbol: new SimpleMarkerSymbol({ style: 'circle', size: 22, color: [0, 0, 0, 0], outline: { color: [142, 193, 234], width: 2.5 } }), attributes: { kind: 'small' } }));
        label(b.x, b.y, `Better site ${b.score} (${LAYOUT_LABEL[b.shape.toLowerCase()] ?? b.shape})`, [142, 193, 234], 18);
      }
    } else if (s.task === 'patrol') {
      for (const seg of s.exposed ?? []) line(seg, [229, 72, 77, 0.85], 5, 'solid');
      for (const seg of s.dead ?? []) line(seg, [47, 168, 98, 0.7], 5, 'solid');
      for (const m of (s.marks ?? []).slice(0, 8)) { dot(m.x, m.y, [238, 138, 31, 0.9], 9, 'diamond'); label(m.x, m.y, m.label, [255, 196, 120], 12, 8); }
    } else if (s.task === 'recce') {
      for (const p of s.naiPts ?? []) dot(p.x, p.y, p.by.length ? [47, 168, 98, 0.95] : [229, 72, 77, 0.95], 6);
      for (const o of s.ops ?? []) label(o.x, o.y, `${o.label}: ${o.seenPct} %${o.riseM > 0 ? ` · +${o.riseM} m` : ''}`, [142, 193, 234], -18, 8);
    }
    return gs;
  }

  private _showCard(screenIn: { x: number; y: number } | null, html: string): void {
    if (this._settings.card === false) return;
    const box = this._host.container();
    // a key pressed while moving (T, P, R) has no rest point: the card stays where it was shown last
    const screen = screenIn ?? (this._card ? this._cardAt : null);
    if (!box || !screen) return;
    this._cardAt = screen;
    if (!this._card) {
      this._card = document.createElement('div');
      this._card.className = 'pb-card';
      box.appendChild(this._card);
    }
    this._card.innerHTML = `${html}<div class="pb-card-foot">Click: place · Esc: cancel${this._isAttack ? ` · P: ${this._phases === 2 ? '1 phase' : '2 phases'} · T: ${this._tanks === 'none' ? 'tanks fire sp' : this._tanks === 'fire' ? 'tanks close sp' : 'no tanks'}` : ''}${this._isPh2 ? ` · R: Ph 2 by ${this._coys === 2 ? 'C Coy only' : 'C, D Coys'}` : ''}${this._smallTask === 'ambush' ? ` · M: target ${MOVER_LABEL[MOVERS[(MOVERS.indexOf(this._mover) + 1) % MOVERS.length]].toLowerCase()}` : ''}</div>`;
    const w = box.clientWidth, h = box.clientHeight;
    let x = screen.x + 22, y = screen.y + 22;
    if (x + 290 > w) x = screen.x - 300;
    if (y + this._card.offsetHeight + 8 > h) y = screen.y - this._card.offsetHeight - 22;
    // still too tall for either side: as low as it fits, never off the map's foot
    y = Math.min(y, h - this._card.offsetHeight - 8);
    this._card.style.left = `${Math.max(4, x)}px`;
    this._card.style.top = `${Math.max(4, y)}px`;
  }

  private _cardHtml(ranked: Fitted[]): string {
    const best = ranked[0];
    const worst = [...best.res.rows, ...best.res.slots.flatMap((s) => s.checks.map((c) => ({ ...c, name: `${s.label}: ${c.name}` })))]
      .find((c) => c.st === 'fail') ?? [...best.res.rows, ...best.res.slots.flatMap((s) => s.checks.map((c) => ({ ...c, name: `${s.label}: ${c.name}` })))].find((c) => c.st === 'warn');
    const rows = ranked.slice(0, 4).map((r, i) => `<div class="pb-card-rk${i === 0 ? ' pb-top' : ''}"><span>${esc(LAYOUT_LABEL[r.recipe.layout] ?? r.recipe.layout)}</span><i style="width:${r.fit.score}%"></i><span>${r.fit.score}</span></div>`).join('');
    const slid = best.fit.slides.length ? `<div class="pb-card-dim">${best.fit.slides.map((s) => slideWord(s)).join(', ')}</div>` : '';
    return `<b>${esc(best.recipe.name)}${this._auto ? ' (Auto)' : ''}</b>${best.fit.pending ? ' <span class="pb-card-dim">ground loading…</span>' : ''}
      ${ranked.length > 1 ? rows : `<div class="pb-card-rk pb-top"><span>Score</span><i style="width:${best.fit.score}%"></i><span>${best.fit.score}</span></div>`}
      ${worst ? cardCheckHtml(worst, WORD[worst.st]) : ''}${slid}
      ${this._jNote ? `<div class="pb-card-dim">${esc(this._jNote)}</div>` : best.fit.small ? this._smallCardLine(best) : best.fit.crossing ? this._crossCardLine(best) : worst ? '<div class="pb-card-dim">J: the worst posn to better ground nearby</div>' : ''}`;
  }

  /** The card's last line for a crossing: the obstacle, the bridge, the tanks across, his observers. */
  private _crossCardLine(f: Fitted): string {
    const c = f.fit.crossing!;
    const t = (re: RegExp) => c.times.find((x) => re.test(x.label));
    const br = t(/Br .* open|bridge/i), tk = t(/Sqn across|Tanks across/);
    const out = c.observers.filter((o) => !o.inside).length;
    return `<div class="pb-card-dim">${esc(c.obstacle.name ?? c.obstacle.typeLabel)}${c.obstacle.widthM ? ` ${Math.round(c.obstacle.widthM)} m` : ''}${br ? ` · bridge ${esc(hClock(br.atMin))}` : ''}${tk ? ` · tanks ${esc(hClock(tk.atMin))}` : ''} · ${out ? `${out} observers outside (red)` : 'no observer outside'}</div>`;
  }

  /**
   * A crossing on the map (PlanCrossing): the obstacle as read, the far-side ground that sees the crossing places (red
   * outside the bridgehead, amber taken inside it), where each wave enters for the drift, the bridges and fords on it.
   */
  private _crossGraphics(f: Fitted): Graphic[] {
    const c = f.fit.crossing;
    if (!c) return [];
    const gs: Graphic[] = [];
    const dot = (x: number, y: number, color: number[], size = 7, style = 'circle') => gs.push(new Graphic({ geometry: new Point({ x, y, spatialReference: MERC }), symbol: new SimpleMarkerSymbol({ style: style as any, size, color: color as any, outline: { color: [20, 24, 29, 0.8], width: 0.8 } }), attributes: { kind: 'cross' } }));
    const label = (x: number, y: number, text: string, color: number[], yoffset = 12) => gs.push(new Graphic({ geometry: new Point({ x, y, spatialReference: MERC }), symbol: new TextSymbol({ text, color: color as any, haloColor: [20, 24, 29], haloSize: 1.5, yoffset, font: { size: 8, weight: 'bold' } }), attributes: { kind: 'cross' } }));
    if (c.obstacle.line.length >= 2) gs.push(new Graphic({ geometry: new Polyline({ paths: [c.obstacle.line.map((p) => [p[0], p[1]])], spatialReference: MERC }), symbol: new SimpleLineSymbol({ color: [64, 156, 255, 0.55], width: 5 }), attributes: { kind: 'cross' } }));
    for (const o of c.observers) dot(o.x, o.y, o.inside ? [238, 138, 31, 0.9] : [229, 72, 77, 0.95], o.inside ? 6 : 8);
    const out = c.observers.filter((o) => !o.inside);
    if (out.length) { const o = out.reduce((a, b) => (b.sees > a.sees ? b : a)); label(o.x, o.y, 'sees the crossings', [255, 179, 181]); }
    for (const e of c.entries) { dot(e.x, e.y, [142, 193, 234, 0.95], 8, 'triangle'); label(e.x, e.y, 'Entry (drift)', [142, 193, 234], -12); }
    for (const q of c.crossings) { dot(q.x, q.y, [47, 168, 98, 0.95], 10, 'square'); label(q.x, q.y, q.label, [150, 214, 150]); }
    return gs;
  }

  /** The card's last line for an ambush, patrol or recce: what was read, in one line. */
  private _smallCardLine(f: Fitted): string {
    const s = f.fit.small!;
    if (s.task === 'ambush') {
      const b = s.better?.[0];
      return `<div class="pb-card-dim">Target ${esc(MOVER_LABEL[this._mover].toLowerCase())} · site ${s.site?.score ?? '?'}${s.site && s.site.groundShape !== s.site.shape ? ` · the ground suits an ${esc(LAYOUT_LABEL[s.site.groundShape.toLowerCase()] ?? s.site.groundShape)}` : ''}${b ? ` · better site ${fmtM(Math.abs(b.alongM))} ${b.alongM < 0 ? 'toward him' : 'on'} (blue ring, J goes there)` : ''}${s.outlying?.length ? ` · outlying ${s.outlying.map((o) => `${fmtM(Math.abs(o.alongM))} ${o.alongM < 0 ? 'up' : 'down'} (${o.score})`).join(', ')}` : ''}</div>`;
    }
    if (s.task === 'patrol') {
      const out = (s.legs ?? []).filter((l) => l.way === 'Out'), back = (s.legs ?? []).filter((l) => l.way === 'In');
      const sum = (ls: typeof out) => ls.reduce((a, l) => a + l.minNight, 0);
      return `<div class="pb-card-dim">${out.length} legs out, ${back.length} in · by night ${sum(out)} + ${sum(back)} min · red: seen, green: hidden</div>`;
    }
    const seen = (s.naiPts ?? []).filter((p) => p.by.length).length, all = (s.naiPts ?? []).length || 1;
    if (s.screen) return `<div class="pb-card-dim">${(s.ops ?? []).length} posts see ${Math.round((100 * seen) / all)} % of the ground he would watch you from · green: seen, red: not</div>`;
    return `<div class="pb-card-dim">${(s.ops ?? []).length} OPs see ${Math.round((100 * seen) / all)} % of the NAI · green: seen, red: not</div>`;
  }

  // ── Check my plan (Phase 5) ──────────────────────────────────────────────────────────────────────────────────
  /** Read the plan off the map (selected / last placement / all) and check it. */
  private _readAndCheck(): void {
    const rd = this._host.readDrawn?.(this._checkScope);
    if (!rd) { this._msg = 'Check my plan needs the Deployment Mgr\'s plan reader.'; this._render(); return; }
    this._checkRecs = rd.records;
    this._checkNote = rd.note;
    this._checkKinds = {};
    if (!rd.records.length) { this._check = null; this._clearProducts(); this._msg = `Nothing to check: ${rd.note}.`; this._render(); return; }
    // an ambush, patrol, recce or crossing built here: read as drawn with the build's own rows (PlanSmallOps /
    // PlanCrossing check mode), not the defence / attack rules
    const smallId = readSymbols(rd.records).find((s) => s.pbRecipe && [...SMALL_TASKS, 'crossing'].includes(this._recipes.get(baseId(s.pbRecipe))?.task ?? ''))?.pbRecipe;
    if (smallId) { this._checkBuiltSmall(rd.records, smallId); return; }
    this._runCheck();
    if (this._check) this._host.log(`Intelligent Deployment: checked ${rd.note}: ${this._check.title}`, true);
  }

  private _runCheck(): void {
    const recs = this._checkRecs;
    if (!recs || !recs.length) return;
    this._probe?.begin();
    const override = this._enEch !== 'auto' || this._enType !== 'auto'
      ? { echelon: this._enEch !== 'auto' ? this._enEch : undefined, type: this._enType !== 'auto' ? this._enType : undefined }
      : null;
    try {
      this._check = checkPlan(recs as any, this._doc, {
        threat: this._threat, kinds: this._checkKinds, enemyOverride: override, terrain: this._ground,
        ground: this._terrain ? this._probe : null, orbat: this._orbat, recipes: Object.fromEntries([...this._recipes, ...[...this._ph2.values()].map((t) => [t.id, t] as const)]) as any,
      });
    } catch (e) {
      this._check = null;
      this._msg = `Check my plan failed: ${e instanceof Error ? e.message : String(e)}`;
      this._host.log(this._msg, false);
    }
    if (this._check && this._mode === 'check') this._drawCheck(this._check);
    this._render();
  }

  /** The check on the map: a ring per posn (or per axis head) by its verdict, the approaches, the en FUP. */
  /**
   * Check my plan for an ambush, patrol, recce or crossing built here: its symbols by role (as drawn, nothing moved), read
   * with the same rows the build uses; the report shown as Check my plan shows a defence's.
   */
  private _checkBuiltSmall(records: DrawnRead['records'], recipeId: string): void {
    const syms = readSymbols(records).filter((s) => s.pbRole && s.pbRecipe === recipeId);
    const base = this._recipes.get(baseId(recipeId));
    if (!base || !syms.length) { this._msg = 'Nothing of that plan to read.'; this._render(); return; }
    const recipe = recipeId.endsWith('-mf') ? withMinefield(base, this._doc) : base;
    if (!this._terrain || !this._probe) { this._check = null; this._msg = `${recipe.name}: reading it as drawn needs terrain data.`; this._render(); return; }
    const drawn: Record<string, { pts: [number, number][]; base?: { start: [number, number]; mid: [number, number]; end: [number, number] } }> = {};
    for (const s of syms) {
      if (drawn[s.pbRole!]) continue;
      drawn[s.pbRole!] = { pts: s.pts.map((q) => [q.x, q.y] as [number, number]), ...(s.base ? { base: { start: [s.base.start.x, s.base.start.y], mid: [s.base.mid.x, s.base.mid.y], end: [s.base.end.x, s.base.end.y] } } : {}) };
    }
    // the plan's click (its pivot: the KZ target, the SP, H) as drawn, else its first symbol
    const anchorPt: [number, number] = drawn[recipe.pivot ?? '']?.pts[0] ?? [syms[0].pts[0].x, syms[0].pts[0].y];
    const inp = this._fitInput(recipe, { x: anchorPt[0], y: anchorPt[1] }, 0, {});
    if (!inp) return;
    this._probe.begin();
    const out = recipe.task === 'crossing' ? checkCrossing(inp, drawn) : checkSmallOp(inp, drawn);
    if (!out) { this._check = null; this._msg = `${recipe.name}: not read (no terrain reader).`; this._render(); return; }
    const st = (n: string) => out.rows.filter((r) => r.st === n).length;
    this._check = {
      task: recipe.task as any, title: `${recipe.name}: read as drawn, ${st('fail')} fail, ${st('warn')} warn`,
      read: [`${out.read.length} of its symbols read by their roles: ${out.read.slice(0, 12).join(', ')}${out.read.length > 12 ? '…' : ''}`, 'Read as drawn: nothing moved, no site searched; the build\'s rows'],
      unclear: out.missing.length ? [`not on the map: ${out.missing.join(', ')}`] : [],
      posns: [], slots: [], rows: out.rows, groups: [], enemy: null, terrain: null, threat: null, frame: null, fit: null, whatIf: null,
      confirm: out.confirm, assumptions: [], mapped: null,
      small: (out as any).small, crossing: (out as any).crossing, pending: out.pending,
    } as any;
    if (this._mode === 'check') this._drawCheck(this._check!);
    this._host.log(`Intelligent Deployment: checked ${recipe.name} as drawn`, true);
    this._render();
  }

  private _drawCheck(r: CheckReport): void {
    const layer = this._layerOn();
    if (!layer) return;
    this._clearProducts();
    // an ambush, patrol, recce or crossing read as drawn: the build's own map products
    const xr = r as any;
    if (xr.small || xr.crossing) {
      layer.addMany([...this._smallGraphics({ fit: { small: xr.small } } as any), ...this._crossGraphics({ fit: { crossing: xr.crossing } } as any)]);
      return;
    }
    const gs: Graphic[] = [];
    const ring = (x: number, y: number, st: CheckState, text: string) => {
      const at = new Point({ x, y, spatialReference: MERC });
      gs.push(new Graphic({ geometry: at, symbol: new SimpleMarkerSymbol({ style: 'circle', size: 15, color: [...RGB[st], 0.3] as any, outline: { color: RGB[st], width: 2.5 } }), attributes: { kind: 'check' } }));
      if (text) gs.push(new Graphic({ geometry: at, symbol: new TextSymbol({ text, color: RGB[st], haloColor: [20, 24, 29], haloSize: 1.5, yoffset: -16, font: { size: 9, weight: 'bold' } }), attributes: { kind: 'check' } }));
    };
    const mid = (pts: XY[]) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
    if (r.task === 'defence') {
      for (const s of r.slots) { const p = r.posns.find((x) => x.id === s.role); if (p) { const c = mid(p.poly); ring(c.x, c.y, s.st, WORD[s.st]); } }
      for (const a of r.fit?.approaches ?? []) {
        const path = a.path.map((p) => [p.x, p.y]);
        if (path.length < 2) continue;
        gs.push(new Graphic({ geometry: new Polyline({ paths: [path], spatialReference: MERC }), symbol: new SimpleLineSymbol({ color: [255, 107, 111, a.main ? 0.9 : 0.6], width: a.main ? 3 : 2, style: a.main ? 'solid' : 'dash' }), attributes: { kind: 'apch' } }));
      }
      const fup = r.fit?.enFup ? reportWorld(r, r.fit.enFup) : null;
      if (fup) {
        const at = new Point({ x: fup.x, y: fup.y, spatialReference: MERC });
        gs.push(new Graphic({ geometry: at, symbol: new SimpleMarkerSymbol({ style: 'x', size: 14, color: [255, 107, 111], outline: { color: [255, 107, 111], width: 3 } }), attributes: { kind: 'check' } }));
        gs.push(new Graphic({ geometry: at, symbol: new TextSymbol({ text: 'En FUP', color: [255, 179, 181], haloColor: [20, 24, 29], haloSize: 1.5, yoffset: 12, font: { size: 9, weight: 'bold' } }), attributes: { kind: 'check' } }));
      }
    } else {
      for (const g of r.groups) {
        const c = g.obj ? mid(g.obj.pts) : g.axis.pts[g.axis.pts.length - 1];
        ring(c.x, c.y, g.st, g.label);
      }
    }
    layer.addMany(gs);
  }

  private async _copyCheck(): Promise<void> {
    if (!this._check) return;
    const xr = this._check as any;
    // an ambush, patrol, recce or crossing read as drawn: its rows, their why and fix, what to confirm
    const text = xr.small || xr.crossing
      ? [xr.title.toUpperCase(), ...xr.read, ...xr.unclear, '', 'CHECKS', ...xr.rows.flatMap((c: Check) => [`  ${c.name.padEnd(20)} ${WORD[c.st].padEnd(11)} ${c.reason}`, ...detailLines(c)]), '', 'CONFIRM ON THE GROUND', ...xr.confirm.map((x: string) => `  - ${x}`)].join('\n')
      : checkText(this._check);
    try { await navigator.clipboard.writeText(text); this._msg = 'Copied to the clipboard.'; }
    catch { this._msg = 'The clipboard is not available here.'; }
    this._render();
  }

  /** En force (echelon) and type: Auto (the doctrinal default, or in Check my plan his symbols first) leads; what it picked is ringed. */
  private _enemyRows(task: string, ownEch: string | null): string {
    const d = ownEch ? defaultEnemy(this._doc, ownEch, this._ground === 'auto' ? null : this._ground, task) : null;
    const typeLabel = (t: string) => String((planDoctrine as any).enemy?.types?.[t]?.label ?? t);
    const why = task === 'attack' ? 'One level down: your 3 : 1 on him (MW p 80)' : ownEch ? 'One level up: the 3 : 1 an attacker plans for (MW p 80)' : 'From his symbols on the map, else one level up';
    const autoE = this._enEch === 'auto', autoT = this._enType === 'auto';
    const ech = seg(EN_ECHELONS.map((e) => ({ on: this._enEch === e, label: echelonLabel(this._doc, e), data: `enEch:${e}`, picked: autoE && d?.echelon === e })),
      { auto: { on: autoE, label: 'Auto', data: 'enEch:auto', title: d ? `${why}: ${echelonLabel(this._doc, d.echelon)}` : why }, label: 'En force' });
    const tips: Record<EnemyType, string> = { inf: 'On foot: approaches on foot, foot rates, FUP 1000-1200 m (IBB p201)', mech: 'Tracked approaches, IPB vehicle rates, tank FUP 2500-3000 m (IBB p214)', armd: 'Tracked approaches, IPB vehicle rates, tank FUP 2500-3000 m (IBB p214)' };
    const type = seg(ENEMY_TYPES.map((t) => ({ on: this._enType === t, label: typeLabel(t), data: `enType:${t}`, title: tips[t], picked: autoT && d?.type === t })),
      { auto: { on: autoT, label: 'Auto', data: 'enType:auto', title: d ? `The default for his echelon: ${typeLabel(d.type)}` : 'From his symbols on the map' }, label: 'En type' });
    return row(task === 'attack' ? 'Defender' : 'En force', ech) + row('En type', type);
  }

  /**
   * The unit type (ORBAT). A Bn plan: each infantry Bn type and the FC and Rangers Wings; a Coy or Pl plan: the same
   * types, taken as that type's rifle Coy or Pl; a Bde plan: the Bde types. A type the layouts cannot use (a Bn of
   * other than four Coys, an AT Bn with no rifle Coy) is not offered and folds behind "+N not offered". Under the
   * chips, what the unit holds.
   */
  private _unitTypeRow(recipe: Recipe): string {
    const u = this._unit(recipe);
    if (!this._orbat) return '<div class="pb-hint">ORBAT not loaded: doctrine figures only (ranges, the reserve on foot).</div>';
    const facts = u ? unitFacts(u) : '';
    const ech = recipe.echelon;
    if (ech === '18') {
      const chips = ownBdeTypes(this._orbat).map((t) => this._chip(u?.id === t.id, `${t.name}${t.mounted ? ' (mounted)' : ''}`, `bdeType:${t.id}`,
        `${t.bns} Bn-sized manoeuvre units, ${t.coys} manoeuvre Coys`)).join('');
      return `${chips ? row('Type', chips) : ''}${facts}`;
    }
    if (ech === '21') {
      const chips = ownDivTypes(this._orbat).map((t) => this._chip(u?.id === t.id, t.name, `divType:${t.id}`, `${t.coys} manoeuvre Coys / Sqns`)).join('');
      return `${chips ? row('Type', chips) : ''}${facts}`;
    }
    if (ech !== '16' && ech !== '15' && ech !== '14') return facts;
    const need = this._needOf(recipe), sub = ech === '15' ? 'Coy' : 'Pl';
    // a Bn family with layouts for three Coys as well as four: a type fits when any layout is for its Coys
    const needs = ech === '16' ? this._famNeeds(this._families.find((f) => f.id === this._familyId)) : new Set([need]);
    needs.add(need);
    const types = this._types;
    const mine = (t: OwnType) => u?.id === (ech === '16' ? t.id : ech === '15' ? t.coy : t.pl);
    // two types can share a sub-unit (the Mjd and Mtn Mjd Bns' Pl): the one chosen is the one lit
    const on = types.find((t) => t.id === this._unitId && mine(t)) ?? types.find(mine);
    const why = (t: OwnType): string => {
      if (ech === '16') return needs.has(t.coys) ? `${t.coys} Coys` : t.coys === 0 ? 'An AT Bn: its ATGM Coys are grouped out to the Bns (the AT row)' : `${t.coys} manoeuvre Coys: these layouts are for ${[...needs].sort().join(' or ')}`;
      if (ech === '15') return !t.coy ? 'No rifle Coy: its Coys are ATGM Coys' : t.plsPerCoy === need || t.plsPerCoy === null ? `Its rifle Coy${t.plsPerCoy ? `: ${t.plsPerCoy} Pls` : ''}` : `Its rifle Coy has ${t.plsPerCoy} Pls: these layouts are for ${need}`;
      return t.pl ? 'Its rifle Pl' : 'No rifle Pl: its Coys are ATGM Coys';
    };
    const fits = (t: OwnType) => [...needs].some((n) => typeFits(t, ech, n));
    const off = types.filter((t) => !fits(t) && t !== on);
    const chips = types.filter((t) => this._allTypes || !off.includes(t)).map((t) => this._chip(t === on, `${t.name}${t.mounted ? ' (mounted)' : ''}`, `unitType:${t.id}`, why(t), !fits(t))).join('');
    const more = off.length ? `<button type="button" class="pb-more" data-pb="moreTypes" aria-expanded="${this._allTypes}">${this._allTypes ? 'Hide the types not offered' : `+${off.length} not offered`}</button>` : '';
    return `${row(ech === '16' ? 'Type' : `${sub} of`, chips + more)}${this._atRow(recipe)}${this._tankRow(recipe)}${this._artyRow(recipe)}${recipe.task === 'crossing' ? '' : this._engrRow(recipe)}${facts}`;
  }

  /**
   * AT grouping (a Bn defence): the ATGM Coys of an AT Bn (LAT, HAT) grouped to the Bn. An AT Bn holds no ground of its
   * own: its Coys are given out to the Bns and Bdes. Their launchers add pairs sited on the tank approaches, counted in
   * the AT cover row. None, or the AT Bn and how many of its Coys.
   */
  private _atRow(recipe: Recipe): string {
    if (!this._orbat || recipe.echelon !== '16' || recipe.task !== 'defence' || !this._atTypes.length) return '';
    const none = this._chip(!this._atId, 'None', 'atType:', 'No AT Coys grouped: the unit\'s own launchers only');
    const types = this._atTypes.map((t) => this._chip(this._atId === t.id, t.name.replace(/ Bn\b/, ''), `atType:${t.id}`,
      `${t.coys} ATGM Coys, ${t.launchersPerCoy} launchers each (${t.launchersPerCoy / 2} pairs): the ${t.name}'s printed launchers shared over its Coys`));
    const at = this._atTypes.find((t) => t.id === this._atId);
    const coys = at ? seg(Array.from({ length: at.coys }, (_, i) => ({ on: this._atCoys === i + 1, label: String(i + 1), data: `atCoys:${i + 1}`, title: `${(i + 1) * at.launchersPerCoy} launchers, ${(i + 1) * at.launchersPerCoy / 2} pairs` })), { sm: true, label: 'AT Coys' }) : '';
    return row('AT group', none + types.join('') + coys);
  }

  /**
   * Tanks in a Bn defence: 1 to 3 Sqns of the Armr Regt grouped to it (ORBAT: 14 tanks each). Their harbours stand beside the
   * reserve; they are the Bn's counter-penetration force at the tank rate, counted in the force. Their guns are not counted
   * as AT weapons: main gun ranges are not printed for the tank types.
   */
  private _tankRow(recipe: Recipe): string {
    const sq = this._tankSqn;
    if (!sq || (recipe.echelon !== '16' && recipe.echelon !== '15') || recipe.task !== 'defence') return '';
    const tp = recipe.echelon === '15', each = tp ? sq.tpTanks : sq.tanks;
    const chips = [0, 1, 2, 3].map((n) => this._chip(this._defTanks === n, n ? `${n} ${tp ? 'Tp' : 'Sqn'}${n > 1 ? 's' : ''}` : 'None', `defTanks:${n}`,
      n ? `${n * each} tanks: harbours beside the reserve, the C Pen force at the tank rate; their guns count as AT at 2.5 km (E: the range is printed only for the Al-Zarrar)` : `No tanks grouped to the ${tp ? 'Coy' : 'Bn'}`)).join('');
    return row('Tanks', chips);
  }

  /**
   * Artillery with a Bn plan (ORBAT, Sec 2): None, or a Regt / Bty with its gun. Its gun area is laid behind the plan in
   * the band the Gun Deployment tool holds it to; Arty reach and, on the ground, Gun area judge it.
   */
  private _artyRow(recipe: Recipe): string {
    if (!this._orbat || recipe.echelon !== '16' || (recipe.task !== 'defence' && recipe.task !== 'attack')) return '';
    const types = this._artyTypes;
    if (!types.length) return '';
    const chips = [this._chip(!this._artyId, 'None', 'arty:', 'No artillery drawn')]
      .concat(types.map((t) => this._chip(this._artyId === t.id, t.name, `arty:${t.id}`, `${t.guns} x ${t.weapon.name}, planning range ${(t.weapon.planM / 1000).toFixed(1)} km${t.weapon.sp ? ', SP' : ''} (${t.src})`))).join('');
    return row('Arty', chips);
  }

  /**
   * Engineers (ORBAT, Sec 4): on a defence they lay the protective minefield (Mines in time), on a crossing they bridge
   * and breach (Engr bridging, Mech breach). Doctrine: one Fd Coy for the minefield, Annex Q for the crossing.
   */
  private _engrRow(recipe: Recipe): string {
    const forDef = recipe.task === 'defence' && (recipe.echelon === '16' || recipe.echelon === '15');
    if (!this._orbat || !(forDef || recipe.task === 'crossing') || !this._engrTypes.length) return '';
    const chips = [this._chip(!this._engrId, 'Doctrine', 'engr:', forDef ? 'One Engr Fd Coy lays the minefield (the figure before the ORBAT)' : 'The Div\'s M2 bridge and hand breaching (IBB Annex Q)')]
      .concat(this._engrTypes.map((e) => this._chip(this._engrId === e.id, e.name.replace(/ \((IFCE|IMCE)\)$/, ' ($1)'), `engr:${e.id}`, `${engrText(e)} (${e.src})`))).join('');
    return row('Engrs', chips);
  }

  /** The kind of ground: Auto (read where the plan rests; what it read is ringed) or set. */
  private _groundRow(): string {
    const det = this._mode === 'check' ? this._check?.terrain : this._lastFit?.terrain;
    const picked = this._ground === 'auto' && det && (det.source === 'auto' || det.source === 'symbols') ? det.kind : null;
    const tip = this._terrain ? 'Read off the terrain where the plan rests: 400 m of rise within 5 km = mountains, a canal or bund in front = obstacle, dunes or sand = desert' : 'Needs terrain data: plains assumed';
    return row('Ground', seg(TERRAIN_KINDS.map((k) => ({ on: this._ground === k, label: terrainLabel(this._doc, k), data: `ground:${k}`, picked: picked === k })),
      { auto: { on: this._ground === 'auto', label: 'Auto', data: 'ground:auto', title: det?.why ? `${tip}. Here: ${det.why}` : tip }, label: 'Ground' }));
  }

  /** Mark, move or clear the threat marker; while armed, the button says to click the map. */
  private _threatButtons(o: { sm?: boolean; mark?: string; clear?: string; title?: string } = {}): string {
    if (this._arming) return `${btn('Click the map where he comes from', 'threat', { armed: true, sm: o.sm })}<span class="pb-keyhint"><kbd>Esc</kbd> stops</span>`;
    const t = this._threat;
    return btn(t ? 'Move the threat' : o.mark ?? 'Mark the threat on the map', 'threat', { icon: 'aim', sm: o.sm, title: o.title })
      + (t ? btn(o.clear ?? 'Clear', 'clearThreat', { kind: 'ghost', sm: o.sm }) : '');
  }

  /** The verdicts at a glance: the heading (with the score when there is one), a bar and the counts. */
  private _tally(rows: { st: CheckState }[], title: string, score: number | null): string {
    const n = (s: CheckState) => rows.filter((r) => r.st === s).length;
    const order: CheckState[] = ['pass', 'warn', 'fail', 'unchecked'];
    const words: Record<CheckState, string> = { pass: 'pass', warn: 'warn', fail: 'fail', unchecked: 'not checked' };
    return `<div class="pb-tallyhead"><div class="pb-sum">${title}</div>${score !== null ? `<div class="pb-score">Score<b>${score}</b></div>` : ''}</div>
      <div class="pb-tally" role="img" aria-label="${order.map((s) => `${n(s)} ${words[s]}`).join(', ')}">${order.map((s) => (n(s) ? `<span class="s-${s}" style="flex:${n(s)}"></span>` : '')).join('')}</div>
      <div class="pb-tl">${order.filter((s) => n(s)).map((s) => `<span class="c-${s}">${icon(VERDICT_ICON[s], 'pb-ic-sm')}<b>${n(s)}</b>${words[s]}</span>`).join('')}</div>`;
  }

  private _checkMyPlanView(): string {
    const scope = seg((['selected', 'last', 'all'] as const).map((s) => ({ on: this._checkScope === s, label: s === 'selected' ? 'Selected symbols' : s === 'last' ? 'Last placement' : 'All on the map', data: `checkScope:${s}` })), { label: 'Read' });
    const head = `
      <p class="pb-p pb-dim">Check a plan on the map: read as drawn, nothing moved; the same rules the build uses.</p>
      ${row('Read', scope)}
      ${this._check && [...SMALL_TASKS, 'crossing'].includes(this._check.task as string) ? '' : `${this._enemyRows(this._check?.task ?? 'defence', null)}${this._groundRow()}`}
      ${row('Threat', this._threatButtons({ sm: true, mark: 'Mark the threat', title: 'Sets the front; without it the front is read from the enemy symbols, then a DCB or minefield in front' }))}`;
    const r = this._check;
    if (!r) return `${head}<div class="pb-empty">${icon('scan', 'pb-ic-lg')}<p>Select the plan's symbols (or place one from Templates), then <b>Read and check</b>.</p><p>Own and enemy symbols are both read: the enemy's give his force, his axes and his FUP.</p></div>`;
    const pill = pillHtml;
    const top = `${this._tally(r.rows, `${esc(r.title)} <span class="pb-dim">${esc(this._checkNote)}</span>`, null)}
      <div class="pb-actions">${btn('Copy as Text', 'checkCopy', { sm: true, icon: 'copy' })}${btn('Clear', 'checkClear', { sm: true, kind: 'ghost' })}</div>`;
    const rows = ckList(r.rows);
    const posns = r.task === 'defence' && r.posns.length ? `<div class="pb-sum">Posns <span class="pb-dim">(click a role to change it)</span></div><table class="pb-t">${r.posns.map((p) => {
      const s = r.slots.find((x) => x.role === p.id);
      const role = ROLE_CYCLE.includes(p.kind) || this._checkKinds[p.id]
        ? `<button type="button" class="pb-chip pb-role" data-pb="role:${esc(p.id)}" title="${esc(p.kindWhy)}">${esc(ROLE_LABEL[p.kind])}</button>`
        : `<span class="pb-dim" title="${esc(p.kindWhy)}">${esc(ROLE_LABEL[p.kind])}</span>`;
      return `<tr><td>${esc(p.label)}<div class="pb-dim">${esc(echelonLabel(this._doc, p.ech))}${p.planned ? ', planned' : ''}</div></td><td>${role}</td><td>${s ? pill(s.st) : ''}</td><td class="pb-why">${s ? esc(s.checks.map((c) => `${c.name}: ${c.st === 'unchecked' ? 'not checked' : c.reason}`).join(' · ')) : esc(p.kindWhy)}</td></tr>`;
    }).join('')}</table>` : '';
    const groups = r.groups.length ? `<div class="pb-sum">Axes</div><ul class="pb-checks">${r.groups.map((g) => ckRow(g.st, `${g.label} → ${g.obj?.label ?? '?'}`,
      whyHtml(g.rows.filter((c) => c.st !== 'pass').map((c) => `${c.name}: ${c.st === 'unchecked' ? 'not checked' : c.reason}`).join(' · ') || 'all pass'))).join('')}</ul>` : '';
    return `${head}${top}
      <ul class="pb-read">${r.read.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${r.unclear.length ? `<div class="pb-hint">To confirm: ${r.unclear.map(esc).join('; ')}</div>` : ''}
      ${rows}${posns}${groups}${r.whatIf?.triggers.length ? `<div class="pb-sum">Trigger table <span class="pb-dim">(own moves against the enemy's ${esc(r.whatIf.mover)})</span></div><table class="pb-t">${r.whatIf.triggers.map((t) => `<tr><td>${esc(t.trigger)}</td><td>${esc(t.who)} → ${esc(t.to)}</td><td>${t.min ?? '—'} / ${t.enemyMin ?? '—'} min</td><td>${pill(t.st)}</td></tr>`).join('')}</table>` : ''}`;
  }

  // ── copy ─────────────────────────────────────────────────────────────────────────────────────────────────────
  private async _copy(): Promise<void> {
    if (!this._result) return;
    const text = planText(this._result, this._unitLine(), this._triggerText());
    try {
      await navigator.clipboard.writeText(text);
      this._msg = 'Copied to the clipboard.';
    } catch {
      this._msg = 'The clipboard is not available here: select the text below and copy it.';
    }
    this._render();
  }

  private _unitLine(): string {
    const r = this._result?.recipe;
    const u = this._unit(r);
    if (u && r) {
      const kind = this._lastFit?.terrain?.kind ?? (this._ground === 'auto' ? null : this._ground);
      const en = this._enUnit(r, kind);
      const ar = r.arty ? `\nArty: ${r.arty.name}, ${r.arty.guns} x ${r.arty.weapon.name} (planning range ${(r.arty.weapon.planM / 1000).toFixed(1)} km; ${r.arty.src}).` : '';
      const sq = r.tanks ? this._tankSqn : null;
      return `Unit: ${unitLine(u)}.${sq ? `\nTanks: A Sqn, ${tankSqnText(sq)} (${sq.src}); ${r.tanks === 'close' ? `Close sp sends ${sq.tanks - sq.tpTanks}, a Tp of ${sq.tpTanks} on the BOF's flank` : 'Fire sp'}.` : ''}${ar}${en ? `\nEnemy: ${unitLine(en)}.` : ''}`;
    }
    const fam = this._families.find((f) => f.id === this._familyId);
    return fam?.unit ? `Unit: ${fam.name} (ORBAT ${fam.unit}, not loaded).` : '';
  }

  // ── view ─────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The terrain status in the footer: a dot and a word, the bundle's dates under it, the whole line on hover. */
  private _statusHtml(): string {
    switch (this._probeState) {
      case 'ready': {
        const d = this._probe?.dataLine() ?? '';
        return `<div class="pb-status" title="${esc(`Terrain: fitted at rest · ${d}`)}"><i></i><span class="t">Terrain ready</span><span class="d">Fitted at rest${d ? ` · ${esc(d)}` : ''}</span></div>`;
      }
      case 'loading': return '<div class="pb-status is-loading"><i></i><span class="t">Terrain loading…</span><span class="d">Geometry until it is in</span></div>';
      case 'missing': return '<div class="pb-status is-off" title="No terrain bundle: geometry only, ground not checked"><i></i><span class="t">Geometry only</span><span class="d">No terrain bundle: ground not checked</span></div>';
      default: return '<div class="pb-status is-off"><i></i><span class="t">Geometry only</span><span class="d">Ground not checked</span></div>';
    }
  }

  /** What each step holds, under its name in the stepper: the unit and layout, the enemy, the symbols, the verdicts. */
  private _stepSubs(): string[] {
    const res = this._result;
    if (!res) return ['', '', '', '', ''];
    const rec = res.recipe;
    const fam = this._families.find((f) => f.id === this._familyId);
    const task = `${fam?.name ?? rec.name} · ${this._auto ? 'Auto' : LAYOUT_LABEL[rec.layout] ?? rec.layout}`;
    let enemy: string;
    if (rec.task === 'ambush') enemy = `Target: ${MOVER_LABEL[this._mover]}`;
    else if (rec.task === 'crossing') enemy = `${this._light === 'moon' ? 'Moonlight' : this._light === 'dark' ? 'Dark night' : 'Day'}${this._mf ? ' · his mines' : ''}`;
    else if (SMALL_TASKS.includes(rec.task)) enemy = this._threat ? 'Threat marked' : 'Aim on the map';
    else {
      const e = this._enemyFor(rec, this._ground === 'auto' ? null : this._ground);
      enemy = `${echelonLabel(this._doc, e.echelon)} · ${String((planDoctrine as any).enemy?.types?.[e.type]?.label ?? e.type)}`;
    }
    const n = (s: CheckState) => res.rows.filter((c) => c.st === s).length;
    const verdicts = [n('fail') ? `<span class="t-fail">${n('fail')} fail</span>` : '', n('warn') ? `<span class="t-warn">${n('warn')} warn</span>` : ''].filter(Boolean);
    if (!verdicts.length) verdicts.push(`${n('pass')} pass`);
    if (n('unchecked')) verdicts.push(`${n('unchecked')} not checked`);
    return [esc(task), esc(enemy), `${res.items.length} symbols`, verdicts.join(' · '), 'Copy as Text'];
  }

  /** The five steps: a dot, the name, what is chosen there; a track that fills up to the step open. Free to jump. */
  private _stepper(): string {
    const subs = this._stepSubs();
    return `<nav class="pb-stepper" aria-label="Steps">${STEPS.map((s, i) => {
      const n = i + 1, at = n === this._step ? ' is-cur' : n < this._step ? ' is-past' : '';
      return `<button type="button" class="pb-st${at}" data-pb="step:${n}"${at === ' is-cur' ? ' aria-current="step"' : ''}><span class="pb-st-dot">${n}</span><span class="pb-st-name">${s}</span><span class="pb-st-sub">${subs[i]}</span></button>`;
    }).join('')}</nav>`;
  }

  private _render(): void {
    if (this._destroyed) return;
    const modes = seg([
      { on: this._mode === 'build', label: 'Build a plan', data: 'mode:build' },
      { on: this._mode === 'check', label: 'Check my plan', data: 'mode:check', title: 'Read a plan drawn on the map and check it against the same rules' },
    ], { sm: true, label: 'Mode' });
    if (this._aside) this._aside.innerHTML = modes;
    const head = `${this._aside ? '' : `<div class="pb-modes">${modes}</div>`}${this._mode === 'check' ? '' : this._stepper()}`;
    let body = '';
    if (this._mode === 'check') body = this._checkMyPlanView();
    else if (this._loadState === 'loading' || this._loadState === 'idle') body = '<div class="pb-note">Loading recipes…</div>';
    else if (this._loadState === 'failed') body = `<div class="pb-note pb-bad">Recipes not loaded: ${esc(this._loadError)}</div>${btn('Retry', 'retry', { sm: true })}`;
    else if (!this._result) body = '<div class="pb-note">No recipe for this choice.</div>';
    else body = [this._stepTask, this._stepEnemy, this._stepPlace, this._stepCheck, this._stepCreate][this._step - 1].call(this);
    const msg = this._msg ? `<div class="pb-msg" role="status">${esc(this._msg)}</div>` : '';
    const next = this._step < STEPS.length ? btn(`Next: ${STEPS[this._step]}`, `step:${this._step + 1}`, { icon: 'next', after: true }) : '';
    const foot = this._mode === 'check'
      ? `<div class="pb-foot">${this._statusHtml()}${btn('Read and check', 'checkRun', { kind: 'primary', icon: 'scan' })}</div>`
      : this._result
        ? `<div class="pb-foot">${this._statusHtml()}${next}${btn('Place on Map', 'place', { kind: 'primary', icon: 'pin' })}</div>`
        : '';
    this._box.innerHTML = `${head}<div class="pb-body">${msg}${body}</div>${foot}`;
  }

  private _chip(on: boolean, label: string, data: string, title = '', disabled = false): string {
    return `<button type="button" class="pb-chip${disabled ? ' pb-later' : ''}" data-pb="${esc(data)}" aria-pressed="${on}"${disabled ? ' aria-disabled="true"' : ''}${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</button>`;
  }

  private _stepTask(): string {
    const res = this._result!;
    const fams = this._families.filter((f) => f.task === this._task);
    const fam = this._families.find((f) => f.id === this._familyId);
    const layouts = this._famIds(fam).map((id) => this._recipes.get(id)!).filter(Boolean);
    const tasks = seg(TASKS.map((t) => ({ on: t.id === this._task, label: t.label, data: `task:${t.id}`, title: t.later, disabled: !!t.later && !this._families.some((f) => f.task === t.id) })), { label: 'Operation' });
    const units = seg(fams.map((f) => ({ on: f.id === this._familyId, label: f.name, data: `family:${f.id}` })), { label: 'Unit' });
    const isBn = res.recipe.echelon === '16' && res.recipe.task === 'defence';
    // Auto leads the layouts; the layout it took where the plan last rested is ringed
    const picked = this._auto && this._lastFit ? baseId(this._lastFit.recipe.id) : null;
    const auto = layouts.length > 1
      ? { on: this._auto, label: 'Auto', data: 'auto', title: this._terrain ? 'Fit every layout where the plan rests and take the best' : 'Ranks the layouts on the ground: needs terrain data', disabled: !this._terrain }
      : undefined;
    const layout = seg(layouts.map((r) => ({ on: !this._auto && r.id === this._recipeId, label: LAYOUT_LABEL[r.layout] ?? r.layout, data: `layout:${r.id}`, title: r.name, picked: r.id === picked })), { auto, label: 'Layout' });
    const attack = res.recipe.task === 'attack'
      ? row('Time', seg([
        { on: !this._night, label: 'Day', data: 'night:off', title: 'SL crossed between first and last light (OOW2 s6 para 17)' },
        { on: this._night, label: 'Night', data: 'night:on', title: 'Night rates (IBB p 18), the Night March chart from the Assy Area to the FUP, his night and thermal sights' }]))
        + row('Phases', seg([
          { on: this._phases === 1, label: '1', data: 'phases:1', title: 'One phase: the assault Coys onto the Obj, a reserve kept' },
          { on: this._phases === 2, label: '2', data: 'phases:2', title: 'Obj 1, then the follow-up Coys round it onto Obj 2 behind, from a new direction (IBB p186); Obj 2 on a hostile posn drawn behind Obj 1, else his high ground' }]) + keyHint('P'))
        + (this._phases === 2 ? row('Ph 2 by', seg([
          { on: this._coys === 2, label: 'C, D Coys', data: 'ph2Coys:2', title: 'Both follow-up Coys onto Obj 2; the BOF is the Spt Coy weapons; no Bn reserve is left: tell Bde (IBB p186 i). R flips it while placing.' },
          { on: this._coys === 1, label: 'C Coy, D res', data: 'ph2Coys:1', title: 'C Coy onto Obj 2, D Coy kept as the Bn reserve (IBB p186 h(3): commit only what the task needs); the BOF is the Spt Coy weapons. R flips it while placing.' }]) + keyHint('R')) : '')
        + row('Tanks', seg([
          { on: this._tanks === 'none', label: 'None', data: 'tanks:none', title: 'No tanks with the Bn' },
          { on: this._tanks === 'fire', label: 'Fire sp', data: 'tanks:fire', title: 'Infantry heavy: A Sqn from FUP (Tks) 2.5-3 km out to fire posns by the BOF, there as the infantry come as close to the Obj (IBB p214)' },
          { on: this._tanks === 'close', label: 'Close sp', data: 'tanks:close', title: 'Armour heavy: A Sqn less a troop from FUP (Tks) on its own axis converging on the Obj, rushing it from the assault line of the infantry; a troop covering from a flank (IBB pp 186-188)' }]) + keyHint('T'))
      : '';
    const sq = this._tankSqn;
    const tankFacts = res.recipe.task === 'attack' && this._tanks !== 'none' && sq
      ? `<div class="pb-hint"><b>A Sqn</b> ${esc(tankSqnText(sq))}${this._tanks === 'close' && sq.tpTanks ? `; Close sp sends ${sq.tanks - sq.tpTanks} and leaves a Tp of ${sq.tpTanks} on the BOF's flank` : ''} · ${esc(sq.src)} · main gun ranges are not printed for the tank types (only the Al-Zarrar's), so the doctrine's night 800 / 1600 m stands</div>`
      : '';
    const draw = isBn ? row('Draw', seg([{ on: this._detail === 'coy', label: 'Coy posns', data: 'detail:coy' }, { on: this._detail === 'pl', label: '+ Pl posns', data: 'detail:pl' }])) : '';
    const alts = res.recipe.alternates?.length ? row('Alternates', seg([
      { on: this._alternates === 'hidden', label: 'Created, hidden', data: 'alt:hidden' }, { on: this._alternates === 'visible', label: 'Shown', data: 'alt:visible' }, { on: this._alternates === 'none', label: 'None', data: 'alt:none' }])) : '';
    return `
      <div class="pb-group">${row('Operation', tasks)}${row('Unit', units)}${this._unitTypeRow(res.recipe)}</div>
      <div class="pb-group">${row('Layout', layout)}${this._isSmall || this._isCrossing ? this._smallRows(res.recipe.task) : this._groundRow()}${this._isCrossing ? this._engrRow(res.recipe) : ''}${attack}${tankFacts}${draw}${alts}</div>
      <div class="pb-plan">
        <div class="pb-sum">${esc(this._auto ? `${fam?.name ?? ''}: Auto (best layout where it rests)` : res.recipe.name)} <span class="pb-dim">${fmtM(res.frontageM)} × ${fmtM(res.depthM)} · ${res.items.length} symbols${fam?.unit ? ` · ${esc(fam.name)} (ORBAT)` : ''}</span></div>
        ${this._preview(res)}
        ${res.recipe.note ? `<p class="pb-p pb-dim">${esc(res.recipe.note)}</p>` : ''}
      </div>`;
  }

  /** The Task step's own rows for a crossing (light, his mines), an ambush (its target) and a patrol (by day or night). */
  private _smallRows(task: string): string {
    if (task === 'crossing') return row('Light', seg([
      { on: this._light === 'day', label: 'Day', data: 'light:day', title: 'Annex Q day column; a crossing by day: the far bank sees every boat' },
      { on: this._light === 'moon', label: 'Moonlight', data: 'light:moon' },
      { on: this._light === 'dark', label: 'Dark night', data: 'light:dark', title: 'Night assault preferable (IBB S46 para 18 p237)' }]))
      + row('His mines', seg([
        { on: !this._mf, label: 'None known', data: 'mf:off' },
        { on: this._mf, label: 'Assumed (S47)', data: 'mf:on', title: 'IBB S47 para 6: 900-1000 m of mixed mines and wire in front of a defended obstacle: the FUPs drawn back behind it, a Breach lane to each crossing place, timed from Annex Q para 4' }]));
    if (task === 'ambush') return row('Target', seg(MOVERS.map((m) => ({ on: this._mover === m, label: MOVER_LABEL[m], data: `mover:${m}`,
      title: m === 'wheeled' ? 'Soft-skinned vehicles: a canal, embankment, cutting or close country beside the Rd holds them on it' : m === 'tracked' ? 'Tanks: only the ground NO-GO for tracks holds them on the Rd' : 'Men on foot: they leave a Rd almost anywhere' }))) + keyHint('M'));
    if (task === 'patrol') return row('Time', seg([
      { on: !this._night, label: 'Day', data: 'night:off' },
      { on: this._night, label: 'Night', data: 'night:on', title: 'Night routes also keep off wood edges (and villages, tracks, skylines: day and night); times at night rates' }]));
    return '';
  }

  private _stepEnemy(): string {
    const rec = this._result!.recipe;
    const attack = rec.task === 'attack';
    // the two clicks of a placement, as numbered steps
    const howTo = (first: string, second: string) => `<ol class="pb-howto"><li>Press <b>Place on Map</b> and ${first}</li><li>${second}</li></ol>`;
    if (rec.task === 'crossing') {
      return `<div class="pb-sum">Where you cross</div>
        ${howTo('click <b>H</b> on the water where the first wave is to enter it (IBB S46 para 25 p240)', 'Move the cursor <b>across to the far bank</b> and click')}
        <p class="pb-p">The whole plan is laid along the obstacle: the start line on the home bank, the objectives and phase lines on the far bank, square to the water where it bends.</p>
        <p class="pb-p pb-dim">${this._terrain ? 'When the mouse rests the obstacle is read (its type, width, depth, banks, the crossings on it), the bridge site moved to the narrowest, firmest place near it, the ground on the far side that sees the crossing places found (the BH line reaches out to take it), and the boats, rafts, bridge and tanks timed from IBB Annex Q for the light chosen.' : 'Without terrain data the obstacle is assumed straight and square to the aim; every ground check stays grey.'}</p>`;
    }
    if (SMALL_TASKS.includes(rec.task)) {
      const t = this._threat;
      const how = rec.task === 'ambush'
        ? `${howTo('click the <b>KZ on the road</b> he will use', 'Move the cursor <b>up the road toward where he comes from</b> and click')}
          <p class="pb-p">The stops go at each end of the KZ, Stop 1 on his side.${rec.layout === 'area' ? ' An area ambush adds an outlying ambush on his way in (up the Rd) and on his way out (down it), each at the best stretch 400-1200 m from the central KZ (IC s44 p152).' : ''}</p>`
        : rec.task === 'patrol'
          ? howTo('click the <b>SP</b> (where the patrol leaves the own posns)', 'Move the cursor to the <b>Obj</b> and click: the Obj, the FRV and the routes follow the cursor')
          : rec.layout === 'screen'
            ? howTo('click the <b>Wdr RV</b> in the main posn (where the screen withdraws to)', 'Move the cursor out to the <b>ground in front</b> he would watch the main posn from and click: the posts go between, laterally with intervals (IC s73 p378)')
            : howTo('click the <b>SP</b> (where the recce party leaves)', 'Move the cursor to the <b>area to watch</b> and click: the NAI goes there, the OPs between');
      const threat = rec.task === 'patrol'
        ? `<div class="pb-actions">${this._threatButtons({ mark: 'Mark where he watches from' })}</div><p class="pb-p pb-dim">${t ? 'The routes keep out of the view from the threat marked.' : 'No threat marked: the routes keep out of the view from the Obj.'}</p>`
        : '';
      return `<div class="pb-sum">${rec.task === 'ambush' ? 'Where he comes from' : rec.task === 'patrol' ? 'Where the patrol goes' : 'What to watch'}</div>${how}${threat}
        <p class="pb-p pb-dim">${this._terrain
          ? (rec.task === 'ambush' ? 'When the mouse rests the road is read toward him: whether his vehicles can leave it, the bend or crest that hides the KZ, cover beside it, the KZ in view, the stops\' view, the withdrawal to the RV, posts and villages near; better sites along the road show as blue rings.'
            : rec.task === 'patrol' ? 'When the mouse rests the routes out and in are found on foot (round NO-GO, away from roads, villages and skylines), and the patrol card is read: legs, bounds, the FRV, times, the stretches seen and hidden.'
              : rec.layout === 'screen'
                ? 'When the mouse rests the ground in front is kept to the points that see the main posn (where he would watch it from); the posts go where they see most of that between them, no further forward than needed, on high ground or in cover, and the ways back keep in dead ground.'
                : 'When the mouse rests the OPs go where they see most of the NAI between them (high ground, cover), and the routes to them keep in dead ground.')
          : 'Without terrain data the layout is the rule\'s spacing; every ground check stays grey.'}</p>`;
    }
    const force = `
      <div class="pb-sum">${attack ? 'Who holds the objective' : 'Who attacks'}</div>
      ${this._enemyRows(rec.task, rec.echelon)}
      ${(() => { const en = this._enUnit(rec, this._ground === 'auto' ? null : this._ground); return en ? unitFacts(en) : ''; })()}
      <p class="pb-p pb-dim">${attack
        ? 'His echelon sets the force ratio (MW p 80: more than 3 : 1).'
        : 'His echelon sizes the approaches (he attacks on the corridors of the level below him: an en Bde on 1.5 km, IPB p 7) and the force ratio; his type sets his going (Inf on foot, Mech / Armd tracked), how fast he comes and where he forms up (1-1.2 km for infantry, 2.5-3 km for tanks, IBB pp 201, 214).'}</p>`;
    if (attack) return `${force}
      <div class="pb-sum">Where you attack from</div>
      ${howTo('click the <b>objective</b>', 'Move the cursor toward <b>your own side</b> (where the attack comes from) and click: the FUP, start line and axis are laid back along that line, the BOF on the right flank')}
      ${this._terrain ? '<p class="pb-p pb-dim">While you aim, rest the mouse: the FUP, the going, the start line and the BOF\'s view are read from the ground.</p>' : ''}`;
    const t = this._threat;
    return `${force}
      <div class="pb-sum">Where the enemy comes from</div>
      <div class="pb-actions">${this._threatButtons({ clear: 'Clear: aim by bearing' })}</div>
      ${t
        ? '<p class="pb-p">The threat is marked: the plan turns to face it as it follows the cursor, and <b>one click</b> places it.</p>'
        : `<p class="pb-p pb-dim">No threat marked:</p>${howTo('click where the <b>HQ</b> goes', 'Click toward the <b>enemy</b>')}`}
      <p class="pb-p pb-dim">${this._terrain
        ? `When the mouse rests, his approaches are found (for his going, as wide as his corridors) from ${t ? 'the threat' : 'out along the front (assumed)'} to the plan and drawn in red; each is checked for direct fire from the forward posns, and the killing ground goes on the main one.`
        : 'Without terrain data the threat is a bearing: the approaches need the terrain bundle.'}</p>`;
  }

  private _stepPlace(): string {
    const res = this._result!;
    const count = (pred: (i: SolveResult['items'][number]) => boolean) => res.items.filter(pred).length;
    const posns = count((i) => i.key === '25151200' && !i.planned);
    const alt = count((i) => !!i.planned);
    // the mouse and the keys while placing, one to a line
    const key = (k: string, what: string, mouse = false) => `<span>${k.split('+').map((x) => `<kbd${mouse ? ' class="m"' : ''}>${esc(x)}</kbd>`).join(' ')}</span><span>${what}</span>`;
    const how = this._isSmall || this._isCrossing
      ? (this._terrain
        ? key('Click', 'Sets the first point.', true) + key('Move', 'Aims it.', true) + key('Rest', 'It is fitted to the ground there; the card at the cursor shows the result.', true) + key('Click', 'Places the fitted plan.', true)
        : key('Click', 'Sets the first point.', true) + key('Click', 'Where it is aimed.', true))
      : this._terrain
        ? key('Move', 'The ghost is the quick layout.', true) + key('Rest', 'The plan is fitted to the ground there: posns slide out of NO-GO; the ghost and the card at the cursor show the result.', true) + key('Click', 'Places the fitted plan.', true)
        : key('Click', 'Sets it down.', true) + key('Click', 'Aims it.', true);
    return `
      <div class="pb-sum">${esc(res.recipe.name)} <span class="pb-dim">${res.items.length} symbols as one placement</span></div>
      <dl class="pb-dl">
        ${posns ? `<dt>Battle Posns</dt><dd>${posns}</dd>` : ''}
        ${alt ? `<dt>Alternates (planned, dashed)</dt><dd>${alt}${this._alternates === 'hidden' ? '<span>hidden</span>' : ''}</dd>` : ''}
        <dt>Units, HQ, weapons</dt><dd>${count((i) => i.geo === 'FPoint')}</dd>
        <dt>Lines (FEBA, wire, SL, LOE …)</dt><dd>${count((i) => i.geo === 'Line' || ['fdl', 'wire', 'sl', 'loe'].includes(i.role))}</dd>
        <dt>Points (LP, DF Tgt, OP)</dt><dd>${count((i) => i.geo === 'Point')}</dd>
      </dl>
      ${res.dropped.length ? `<div class="pb-callout pb-callout--warn">${icon('warn')}<span>Not placed without the ground: <b>${res.dropped.map((d) => esc(d.label)).join(', ')}</b>.</span></div>` : ''}
      <div class="pb-sum">Press Place on Map, then</div>
      <div class="pb-keys">${how}${key('Esc', 'Cancels.')}${key('Ctrl+Z', 'Takes the whole plan back.')}</div>
      <p class="pb-p pb-dim">The Templates tab's <b>Last placement</b> moves or removes it.</p>`;
  }

  private _stepCheck(): string {
    const fam = this._families.find((f) => f.id === this._familyId);
    const toggle = this._famIds(fam).length > 1
      ? `<div class="pb-subtabs">${seg([{ on: this._checkView === 'plan', label: 'This plan', data: 'checkView:plan' }, { on: this._checkView === 'compare', label: 'Compare layouts', data: 'checkView:compare' }], { sm: true })}</div>`
      : '';
    return toggle + (this._checkView === 'compare' && toggle ? this._compareView() : this._planChecks());
  }

  /** Every layout of the family side by side at the same spot: the score card's rows, the score, a preview each. */
  private _compareView(): string {
    const pill = (st: CheckState | null) => (st ? pillHtml(st) : '<span class="pb-dim">—</span>');
    if (!this._terrain) return '<p class="pb-p pb-dim">Compare fits every layout to the same ground: it needs terrain data.</p>';
    const list = this._compare;
    if (!list || !list.length) return `<div class="pb-empty">${icon('layers', 'pb-ic-lg')}<p>Compare fits every layout where the plan was.</p><p>Place the plan once, or rest it on the map while placing.</p>${btn('Compare here', 'compareRun', { sm: true })}</div>`;
    const W = ((planDoctrine as any).scoreWeights ?? {}) as Record<string, number>;
    const attack = list[0].recipe.task === 'attack';
    const fpill = (v: number) => `<span class="pb-pill pb-${v >= 0.75 ? 'pass' : v >= 0.4 ? 'warn' : 'fail'}">${Math.round(v * 100)}</span>`;
    const head = list.map((f, i) => `<th>${i === 0 ? '★ ' : ''}${esc(LAYOUT_LABEL[f.recipe.layout] ?? f.recipe.layout)}</th>`).join('');
    const small = SMALL_TASKS.includes(list[0].recipe.task) || list[0].recipe.task === 'crossing';
    // an ambush, patrol or recce: its own rows side by side (hover a cell for its reason)
    const smallRows = () => [...new Set(list.flatMap((f) => f.res.rows.map((r) => r.name)))].map((name) => `<tr><td>${esc(name)}</td>${list.map((f) => { const r = f.res.rows.find((x) => x.name === name); return r ? `<td title="${esc(r.reason)}">${pill(r.st)}</td>` : '<td>—</td>'; }).join('')}</tr>`).join('');
    const rows = small ? smallRows() : attack
      ? (list[0].fit.attack?.factors ?? []).map((fa) => `<tr><td>${esc(fa.label)} <span class="pb-dim">×${fa.w}</span></td>${list.map((f) => { const x = f.fit.attack?.factors.find((y) => y.key === fa.key); return x ? `<td title="${esc(x.reason)}">${fpill(x.v)}</td>` : '<td>—</td>'; }).join('')}</tr>`).join('')
      : SCORE_ROWS.map((s) => `<tr><td>${esc(s.label)} <span class="pb-dim">${W[s.key] != null ? `×${W[s.key]}` : ''}</span></td>${list.map((f) => `<td>${pill(scoreRowState(f.res.rows, s.rows))}</td>`).join('')}</tr>`).join('');
    const score = `<tr><td><b>Score</b></td>${list.map((f) => `<td><b>${f.fit.score}</b></td>`).join('')}</tr>`;
    const fw = `<tr><td>Fail · warn</td>${list.map((f) => `<td>${f.fit.fails} · ${f.fit.warns}</td>`).join('')}</tr>`;
    const pv = `<tr><td></td>${list.map((f) => `<td class="pb-cmp-pv">${this._preview(f.res, 110)}</td>`).join('')}</tr>`;
    const use = `<tr><td></td>${list.map((f) => `<td>${this._chip(baseId(f.recipe.id) === this._recipeId && !this._auto, 'Use', `useLayout:${baseId(f.recipe.id)}`)}</td>`).join('')}</tr>`;
    return `
      <div class="pb-sum">${attack ? 'Left against right, frontal for reference' : 'Every layout fitted at the same spot'} <span class="pb-dim">(ranked: fewest fails, then warnings, then score; ${small ? 'hover a cell for its reason' : `weights E, PlanDoctrine.${attack ? 'attack.compareWeights; hover a cell for its reason' : 'scoreWeights'}`})</span></div>
      <div class="pb-cmp"><table class="pb-t"><tr><th></th>${head}</tr>${pv}${rows}${score}${fw}${use}</table></div>
      <div class="pb-actions">${btn('Compare again', 'compareRun', { sm: true })}</div>`;
  }

  private _planChecks(): string {
    const res = this._result!;
    const fitted = (res as any).mode === 'terrain';
    const fit = this._lastFit;
    const title = `Checks ${fitted
      ? `<span class="pb-dim">fitted where it was placed${fit?.fit.pending ? ' (some ground was still loading)' : ''}</span>`
      : `<span class="pb-dim">(grey: needs ${this._terrain ? 'a placement: the ground is read where the plan lands' : 'terrain data'}, never counted as a pass)</span>`}`;
    return `
      ${this._tally(res.rows, title, fitted && fit ? fit.fit.score : null)}
      ${fitted && fit && fit.fit.slides.length ? `<p class="pb-p pb-dim">${fit.fit.slides.map((s) => slideWord(s)).join(', ')}.</p>` : ''}
      ${ckList(res.rows)}
      ${res.slots.length ? `<div class="pb-sum">Posns</div><ul class="pb-checks">${res.slots.map((s: SlotResult) => ckRow(s.st, s.label, whyHtml(s.checks.map((c) => `${c.name}: ${c.st === 'unchecked' ? 'not checked' : c.reason}`).join(' · ')))).join('')}</ul>` : ''}
      ${this._triggerTable()}
      ${this._attackSection()}
      ${!this._lastFit?.whatIf?.triggers.length && res.alternates.length ? `<div class="pb-sum">Triggers</div><table class="pb-t">${res.alternates.map((a) => `<tr><td>Heavy shelling on ${esc(a.ofLabel)}</td><td>${esc(a.ofLabel)} → ${esc(a.label)}</td><td>${a.min} min</td></tr>`).join('')}</table>` : ''}`;
  }

  private _stepCreate(): string {
    const res = this._result!;
    return `
      <p class="pb-p pb-dim">Create on Map is <b>Place on Map</b>: ordinary symbols, one undo step, each tagged with its role.</p>
      <div class="pb-code"><div class="pb-code-h"><span>Plan as text</span>${btn('Copy as Text', 'copy', { kind: 'ghost', sm: true, icon: 'copy' })}</div>
        <pre class="pb-text">${esc(planText(res, this._unitLine(), this._triggerText()))}</pre></div>`;
  }

  // ── what-if: the trigger table and the routes ────────────────────────────────────────────────────────────────
  private _triggerText(): string[] | null {
    const w = this._lastFit?.whatIf;
    const a = this._lastFit?.fit.attack;
    const sm = this._lastFit?.fit.small;
    if (sm && this._result === this._lastFit?.res) return smallLines(sm, gmaOf(this._settings.gmaDeg));
    const cx = this._lastFit?.fit.crossing;
    if (cx && this._result === this._lastFit?.res) return crossLines(cx);
    if (a && this._result === this._lastFit?.res) {
      const L: string[] = [];
      if (a.hSum) {
        for (const st of a.hSum.steps) L.push(`  ${hRelText(st.at).padEnd(10)} ${st.label}${st.distM ? `, ${st.distM} m` : ''}, ${st.min} min`);
        L.push(`  Fire lifts (IC s66 p305): ${a.hSum.lifts.map((l) => `${l.label} ${l.rM} m ${hRelText(l.at)}`).join(', ')}`);
        const p2 = a.hSum.phase2;
        if (p2) L.push(`  Phase 2: Obj 1 taken ${hRelText(p2.obj1At)}, H2 ${hRelText(p2.h2At)} (${p2.gapMin} min after), fire lifts on Obj 2 ${p2.lifts.map((l) => `${l.label} ${l.rM} m ${hRelText(l.at)}`).join(', ')}, on Obj 2 ${hRelText(p2.obj2At)}`);
      }
      if (a.night) for (const l of a.night.legs) L.push(`  Night leg ${l.i}: ${brgText(l.bearingDeg, gmaOf(this._settings.gmaDeg))}, ${l.distM} m, ${l.paces} paces, ${l.min} min`);
      if (a.choke) L.push(`  En MSR choke: ${a.choke.kind} (${a.choke.label}) behind the Obj`);
      for (const f of a.factors) L.push(`  ${f.label}: ${Math.round(f.v * 100)} (x${f.w}) ${f.reason}`);
      return L;
    }
    return w && w.triggers.length && this._result === this._lastFit?.res ? triggerLines(w) : null;
  }

  /** The attack's own reading in the Check step: the H-hour sum, the fire lifts, the night march, the factors. */
  private _attackSection(): string {
    const f = this._lastFit, a = f?.fit.attack;
    const sm = f?.fit.small;
    const cr = f?.fit.crossing;
    if (f && cr && this._result === f.res) {
      return `<div class="pb-sum">Timeline <span class="pb-dim">(IBB Annex Q ${esc(this._light === 'day' ? 'day' : this._light === 'moon' ? 'moonlight' : 'dark night')} column; engineers start at H)</span></div><table class="pb-t">${cr.times.map((t) => `<tr><td>${esc(hClock(t.atMin))}</td><td>${esc(t.label)}</td></tr>`).join('')}</table>${cr.bridges.length ? `<div class="pb-sum">Bridge site</div><table class="pb-t">${cr.bridges.map((b) => `<tr><td class="pb-why">${esc(b.why)}${b.movedM >= 100 ? ` <span class="pb-dim">(moved ${fmtM(b.movedM)})</span>` : ''}</td></tr>`).join('')}</table>` : ''}`;
    }
    if (f && sm && this._result === f.res) {
      // a patrol's route card, an ambush's site, the recce's OPs
      if (sm.task === 'patrol' && sm.legs?.length) return `<div class="pb-sum">Route card <span class="pb-dim">(${this._brgNote()}; 120 paces a 100 m; legs end on a feature where one is near)</span></div><table class="pb-t">${sm.legs.map((l) => `<tr><td>${l.way} ${l.i}</td><td>${this._brgCell(l.bearingDeg)}</td><td>${fmtM(l.distM)}</td><td>${l.paces} paces</td><td>${l.minDay} / ${l.minNight} min</td><td class="pb-dim">${esc(l.feature ?? '')}</td></tr>`).join('')}</table><div class="pb-dim">min by day / by night</div>`;
      if (sm.task === 'recce' && sm.ops?.length) return `<div class="pb-sum">${sm.screen ? 'Posts' : 'OPs'}</div><table class="pb-t">${sm.ops.map((o) => `<tr><td>${esc(o.label)}</td><td>sees ${o.seenPct} %</td><td>${o.riseM === 0 ? 'level with' : o.riseM > 0 ? `${o.riseM} m above` : `${-o.riseM} m below`} ${sm.screen ? 'the ground in front' : 'the NAI'}</td><td>${o.cover ? 'in cover' : 'in the open'}</td></tr>`).join('')}</table>`;
      return '';
    }
    if (!f || !a || this._result !== f.res) return '';
    const h = a.hSum;
    const steps = h ? `<div class="pb-sum">H-hour sum <span class="pb-dim">(H = crossing the SL${h.night ? '; night rates' : ''})</span></div><table class="pb-t">${h.steps.map((s) => `<tr><td>${esc(hRelText(s.at))}</td><td>${esc(s.label)}</td><td>${s.distM ? fmtM(s.distM) : ''}</td><td>${s.min} min</td></tr>`).join('')}${[...h.lifts.map((l) => ({ ...l, tag: '' })), ...(h.phase2?.lifts ?? []).map((l) => ({ ...l, tag: 'Obj 2: ' }))].sort((x, y) => x.at - y.at).map((l) => `<tr><td>${esc(hRelText(l.at))}</td><td>Fire lifts: ${esc(l.tag + l.label)}</td><td>${l.rM} m</td><td class="pb-dim">IC s66</td></tr>`).join('')}</table>${h.phase2 ? `<div class="pb-dim">Phase 2: H2 ${esc(hRelText(h.phase2.h2At))}, ${h.phase2.gapMin} min after Obj 1 falls (IBB p176 c: at once)</div>` : ''}` : '';
    const night = a.night ? `<div class="pb-sum">Night march, Assy Area to the FUP <span class="pb-dim">(Night March chart; ${this._brgNote()}, 120 paces a 100 m)</span></div><table class="pb-t">${a.night.legs.map((l) => `<tr><td>Leg ${l.i}</td><td>${this._brgCell(l.bearingDeg)}</td><td>${fmtM(l.distM)}</td><td>${l.paces} paces</td><td>${l.min} min</td><td class="pb-dim">${esc(l.sight === 'none' ? '' : l.sight + ' sights')}</td></tr>`).join('')}</table>` : '';
    const fac = `<div class="pb-sum">Weighed factors <span class="pb-dim">(score ${f.fit.score}; Compare sets left against right)</span></div><table class="pb-t">${a.factors.map((x) => `<tr><td>${esc(x.label)} <span class="pb-dim">×${x.w}</span></td><td><span class="pb-pill pb-${x.v >= 0.75 ? 'pass' : x.v >= 0.4 ? 'warn' : 'fail'}">${Math.round(x.v * 100)}</span></td><td class="pb-why">${esc(x.reason)}</td></tr>`).join('')}</table>`;
    return steps + night + fac;
  }

  private _triggerTable(): string {
    const f = this._lastFit, w = f?.whatIf;
    if (!f || !w || !w.triggers.length || this._result !== f.res) return '';
    const route = (t: (typeof w.triggers)[number]) => {
      const r = t.route;
      if (!r) return '—';
      if (r.blocked) return 'no route on foot';
      return `${fmtM(r.lengthM)}${r.detour ? ' round NO-GO' : ''}${r.coveredPct !== null ? ` · ${r.coveredPct} % hidden` : ''}${r.slowPct ? ` · ${r.slowPct} % SLOW-GO` : ''}`;
    };
    return `
      <div class="pb-sum">Trigger table <span class="pb-dim">(own move on foot against the enemy's ${w.mover}${w.enemyToFdlMin !== null ? `: ${w.enemyToFdlMin} min to the FDL on the main approach` : ''}, from ${esc(enemyStartWords(w))}${w.enemyStartAssumed ? ': mark the threat where he starts for a real time' : ''})</span></div>
      <ul class="pb-checks">${w.triggers.map((t) => ckRow(t.st, t.trigger,
        `<div class="pb-det-head">${esc(t.who)} → ${esc(t.to)} · own ${t.min ?? '—'} min, his ${t.enemyMin ?? '—'} min</div>`
        + whyHtml(`${route(t)}. ${t.reason}${t.coveredBy ? `. Covered by ${t.coveredBy}` : ''}`))).join('')}</ul>
      <div class="pb-actions">${btn(this._routesShown ? 'Hide the routes' : 'Show the routes on the map', 'routes', { sm: true })}</div>`;
  }

  /** Each trigger's route as a dashed line with its time, and the move's verdict. */
  private _routeGraphics(f: Fitted): Graphic[] {
    const gs: Graphic[] = [];
    for (const t of f.whatIf?.triggers ?? []) {
      const r = t.route;
      if (!r || r.pts.length < 2) continue;
      const path = r.pts.map((p) => { const w = toWorld(f.frame, p); return [w.x, w.y]; });
      gs.push(new Graphic({ geometry: new Polyline({ paths: [path], spatialReference: MERC }), symbol: new SimpleLineSymbol({ color: r.blocked ? [229, 72, 77, 0.9] : [142, 193, 234, 0.95], width: 2, style: 'short-dash' }), attributes: { kind: 'route' } }));
      const m = path[Math.floor(path.length / 2)] ?? path[0];
      const mid = path.length === 2 ? [(path[0][0] + path[1][0]) / 2, (path[0][1] + path[1][1]) / 2] : m;
      gs.push(new Graphic({ geometry: new Point({ x: mid[0], y: mid[1], spatialReference: MERC }), symbol: new TextSymbol({ text: r.blocked ? 'no route' : `${t.min} min`, color: RGB[t.st], haloColor: [20, 24, 29], haloSize: 1.5, font: { size: 9, weight: 'bold' } }), attributes: { kind: 'route' } }));
    }
    return gs;
  }

  private _toggleRoutes(): void {
    this._routesShown = !this._routesShown;
    const layer = this._layerOn();
    if (!layer) return;
    layer.graphics.removeMany(layer.graphics.filter((g) => g.attributes?.kind === 'route').toArray());
    if (this._routesShown && this._lastFit) layer.addMany(this._routeGraphics(this._lastFit));
  }

  /** The plan from above, front up (as the recipe draws it, before it is aimed), centred on a 500 m grid. */
  private _preview(res: SolveResult, W = 300): string {
    const pts = res.items.flatMap((i) => i.pts);
    if (!pts.length) return '';
    const pad = 150;
    const x0 = Math.min(...pts.map((p) => p.x)) - pad, x1 = Math.max(...pts.map((p) => p.x)) + pad;
    const y0 = Math.min(...pts.map((p) => p.y)) - pad, y1 = Math.max(...pts.map((p) => p.y)) + pad;
    const H = Math.max(W * 0.4, Math.min(W * 0.87, (W * (y1 - y0)) / (x1 - x0)));
    const k = Math.min(W / (x1 - x0), H / (y1 - y0));
    // centred in the frame: k fits the longer side, the other gets the space left over split on both sides
    const ox = (W - (x1 - x0) * k) / 2, oy = (H - (y1 - y0) * k) / 2;
    const X = (x: number) => ((x - x0) * k + ox).toFixed(1), Y = (y: number) => (H - (y - y0) * k - oy).toFixed(1);
    const g = 500 * k, gid = `pbGrid${++previewSeq}`;
    const grid = g >= 6 ? `<defs><pattern id="${gid}" width="${g.toFixed(2)}" height="${g.toFixed(2)}" patternUnits="userSpaceOnUse"><path class="pb-pv-grid" d="M${g.toFixed(2)} 0H0V${g.toFixed(2)}"/></pattern></defs><rect width="${W}" height="${H.toFixed(1)}" fill="url(#${gid})"/>` : '';
    const shapes = res.items.map((i) => {
      // points are dots; every line and area is an outline (an Obj or minefield is never drawn filled)
      const cls = i.planned ? 'pb-pv-alt' : i.key === '25151200' ? 'pb-pv-posn' : i.geo === 'Point' || i.geo === 'FPoint' ? 'pb-pv-pt' : 'pb-pv-line';
      if (i.geo === 'Point' || i.geo === 'FPoint') return `<circle class="${cls}" cx="${X(i.pts[0].x)}" cy="${Y(i.pts[0].y)}" r="${i.geo === 'FPoint' ? 3.2 : 2.2}"/>`;
      const d = i.pts.map((p, n) => `${n ? 'L' : 'M'}${X(p.x)} ${Y(p.y)}`).join(' ') + (i.geo === 'Area' && i.key !== '25151200' && !i.planned ? ' Z' : '');
      return `<path class="${cls}" d="${d}"/>`;
    }).join('');
    const sc = 1000 * k;
    return `<svg class="pb-preview" viewBox="0 0 ${W} ${H}" role="img" aria-label="The plan from above, front up">${grid}${shapes}
      <line class="pb-pv-scale" x1="8" y1="${H - 8}" x2="${(8 + sc).toFixed(1)}" y2="${H - 8}"/><text x="${(10 + sc).toFixed(1)}" y="${H - 5}" class="pb-pv-txt">1 km</text>
      <text x="${W - 6}" y="12" text-anchor="end" class="pb-pv-txt">${({ attack: 'Obj ↑', ambush: 'He comes ↑', patrol: 'Obj ↑', recce: 'NAI ↑', crossing: 'Far bank ↑' } as Record<string, string>)[res.recipe.task] ?? 'Front ↑'}</text></svg>`;
  }
}

export default PlanBuildTab;
