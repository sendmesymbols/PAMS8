// page.ts -- OCOKA lens test program, interactive half. Same core as run.mjs; tiles come from /terrain-bundle (the Vite dev server).
import * as core from './ocoka-core';
import doctrine from '../../MS/Data/OcokaDoctrine.json';
import symbols from '../../MS/Data/Symbols.json';

const $ = (id: string) => document.getElementById(id) as any;
const BUNDLE = '/terrain-bundle';

// ------------------------------------------------------------------------------------------------------ data
const rules: any = await (await fetch(`${BUNDLE}/rules.json`)).json();
const visHead: any = await (await fetch(`${BUNDLE}/visibility/visibility.json`)).json();
const vis = core.parseVisibility(visHead, await (await fetch(`${BUNDLE}/visibility/visibility.bin`)).arrayBuffer());
const sym = symbols as any;

const scratch = document.createElement('canvas');
scratch.width = scratch.height = 256;
const sctx = scratch.getContext('2d', { willReadFrequently: true })!;
const tiles = new Map<string, Promise<Uint8Array | null>>();
const src: core.TileSource = (layer, x, y) => {
  const key = `${layer}/${x}/${y}`;
  let p = tiles.get(key);
  if (!p) {
    p = fetch(`${BUNDLE}/${layer}/${core.Z}/${x}/${y}.png`).then(async (r) => {
      if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) return null;
      const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none' });
      sctx.clearRect(0, 0, 256, 256);
      sctx.drawImage(bmp, 0, 0);
      const d = sctx.getImageData(0, 0, 256, 256).data;
      const out = new Uint8Array(65536);
      for (let i = 0; i < 65536; i++) out[i] = d[i * 4];
      return out;
    }).catch(() => null);
    tiles.set(key, p);
  }
  return p;
};

// ------------------------------------------------------------------------------------------------------ controls
const PLACES: Array<[string, number, number]> = [
  ['Margalla crest (highest ground of its tile)', 73.0747, 33.7901], ['Islamabad valley floor', 73.1118, 33.7313], ['Cholistan desert', 71.9, 28.2],
  ['Lahore centre', 74.3436, 31.5497], ['Lahore canal bank (canal about 100 m west)', 74.3541, 31.548], ['Skardu valley', 75.63, 35.3], ['Quetta', 67.0, 30.19],
  ['Karachi', 67.01, 24.86], ['Punjab farmland (open fields)', 72.9872, 30.7789],
];
$('place').innerHTML = PLACES.map((p, i) => `<option value="${i}">${p[0]}</option>`).join('');
const WEAPONS: Array<[string, string]> = [
  ['15110100', 'Rifle'], ['15110202', 'MG - Med'], ['15110303', 'GLHMG'], ['15110803', '106 mm RR'], ['15111200', 'ATGM (Baktar Shikan)'],
  ['15120203', 'Tank - Hy'], ['15111402', 'Mortar 81 mm'], ['15111700', 'RPG-7'],
];
$('weapon').innerHTML = WEAPONS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
$('weapon').value = '15120203';
const MOVERS = ['tracked', 'wheeled', 'dismounted'];
$('mover').innerHTML = MOVERS.map((m) => `<option>${m}</option>`).join('');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
$('month').innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
const now = new Date();
$('month').value = String(now.getMonth() + 1);
const pad = (n: number) => String(n).padStart(2, '0');
$('when').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:00`;

interface State { lon: number; lat: number; bearing: number }
const st: State = { lon: PLACES[0][1], lat: PLACES[0][2], bearing: 0 };
let mosaic: core.OcokaGrid | null = null;
let base: HTMLCanvasElement | null = null;
const canvas = $('map') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const RADIUS = 5000;

// ------------------------------------------------------------------------------------------------------ base map
const COLOUR = (c: number): [number, number, number] => {
  if ([4, 5, 20, 21, 22, 46, 6].includes(c)) return [70, 120, 190];
  if (c === 3) return [150, 150, 155];
  if ([2, 23, 48].includes(c)) return [150, 180, 110];
  if ([1, 31, 30, 29, 7].includes(c)) return [60, 120, 70];
  if ([12, 13, 14, 15, 16, 17, 0].includes(c)) return [196, 176, 130];
  if ([9, 10, 18, 19, 27].includes(c)) return [150, 120, 90];
  if ([24, 25, 26, 49, 28, 32].includes(c)) return [170, 90, 70];
  return [180, 180, 180];
};
function renderBase(m: core.OcokaGrid): HTMLCanvasElement {
  const { w, h, elev, res, cls } = m;
  const img = new ImageData(w, h);
  const sun = (315 * Math.PI) / 180, alt = (40 * Math.PI) / 180;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const dzdx = (elev[i + 1] - elev[i - 1]) / (2 * res), dzdy = (elev[i + w] - elev[i - w]) / (2 * res);
    const slope = Math.atan(Math.hypot(dzdx, dzdy) * 1.5), asp = Math.atan2(dzdy, -dzdx);
    let shade = Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(sun - asp);
    shade = Number.isFinite(shade) ? Math.max(0.15, Math.min(1.1, shade)) : 0.8;
    const [r, g, b] = COLOUR(cls[i]);
    const k = 0.45 + 0.7 * shade;
    img.data[i * 4] = Math.min(255, r * k); img.data[i * 4 + 1] = Math.min(255, g * k); img.data[i * 4 + 2] = Math.min(255, b * k); img.data[i * 4 + 3] = 255;
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

// ------------------------------------------------------------------------------------------------------ analysis
const f0 = (v: number | null) => (v !== null && Number.isFinite(v) ? Math.round(v).toLocaleString('en') : '-');
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-');
const LEVEL = ['none', 'poor', 'fair', 'good'];
const compass = core.compass8;
let busy = false, again = false;

async function ensureMosaic(): Promise<void> {
  if (mosaic) {
    const [x, y] = core.gridXY(mosaic, st.lon, st.lat);
    const m = RADIUS / mosaic.res + 30;
    if (x > m && y > m && x < mosaic.w - m && y < mosaic.h - m) return;
  }
  mosaic = await core.loadGrid(src, st.lon, st.lat, RADIUS + 1500);
  base = renderBase(mosaic);
}

async function update(): Promise<void> {
  if (busy) { again = true; return; }
  busy = true;
  try {
    await ensureMosaic();
    const m = mosaic!;
    const [ox, oy] = core.gridXY(m, st.lon, st.lat);
    const [eyeM] = ($('eye').value as string).split('|').map(Number);
    const month = Number($('month').value);
    const mover = $('mover').value as string;
    const wkey = $('weapon').value as string;
    const wp = core.weaponOf(sym[wkey].Rng);
    const eff = wp.effM;
    const useTables = $('mode').value !== 'none';
    const half = Number($('sector').value) / 2;
    const going = core.goingTable(rules, mover);
    const T = useTables ? core.sightTables(doctrine, month, m.res) : null;
    const baseOpts = { eyeM, targetM: wp.targetM, tolM: 1, tables: T, going };

    // what the cursor card would compute on every mouse move
    const t0 = performance.now();
    const quick = core.analyseSight(m, ox, oy, core.bearingsFor(2), { ...baseOpts, radiusM: RADIUS, effM: eff });
    const obs = core.observationOf(quick);
    const bands = core.newBands([0, 100, 300, 600, 1000, 2000]);
    const wedgeR = Math.min(RADIUS, Math.max(eff, 600));
    const wedge = core.analyseSight(m, ox, oy, core.bearingsFor(core.fineStep(wedgeR, m.res), st.bearing, half * 2), { ...baseOpts, radiusM: wedgeR, effM: eff, bands });
    const fire = core.fireOf(wedge, eff, bands, (doctrine as any).fieldOfFire.grade);
    const obst = core.obstacleFrontOf(wedge, eff);
    const ways = core.waysOut(m, ox, oy, going, 2000);
    const dom = core.dominanceOf(m, ox, oy, 3000);
    const tMove = performance.now() - t0;

    // the picture (the Detail's cadence)
    const t1 = performance.now();
    const all = core.bearingsFor(core.fineStep(RADIUS, m.res));
    const steps = Math.floor(RADIUS / m.res);
    const trace = new Uint8Array(all.length * steps), traceT = new Uint8Array(all.length * steps);
    core.analyseSight(m, ox, oy, all, { ...baseOpts, radiusM: RADIUS, effM: eff, trace, traceTerrain: traceT });
    const tPic = performance.now() - t1;
    const v = core.visibilityAt(vis, st.lon, st.lat, month);
    const when = new Date(new Date(String($('when').value) + ':00Z').getTime() - 5 * 3600000);
    const light = core.lightAt(when, st.lat, st.lon);
    const night = core.nightOf(when, st.lat, st.lon);
    const crops = core.cropShares(doctrine, month);

    // ---- draw: green = chance seen; inside the range toward the threat, red = dead ground (terrain), amber = screened
    const W = canvas.width, S = W / m.w;
    const cvH = Math.round(m.h * S);
    canvas.height = cvH;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(base!, 0, 0, W, cvH);
    const ov = new ImageData(m.w, m.h);
    for (let r = 0; r < all.length; r++) {
      const b = (all[r] * Math.PI) / 180, dx = Math.sin(b), dy = -Math.cos(b);
      const inWedge = core.bearingDiff(all[r], st.bearing) <= half;
      for (let s2 = 1; s2 <= steps; s2++) {
        const p = trace[r * steps + s2 - 1];
        if (p === 255) break;
        const px = Math.floor(ox + dx * s2), py = Math.floor(oy + dy * s2);
        if (px < 0 || py < 0 || px >= m.w || py >= m.h) break;
        const o = (py * m.w + px) * 4;
        if (p >= 50) { ov.data[o] = 60; ov.data[o + 1] = 230; ov.data[o + 2] = 110; ov.data[o + 3] = Math.round(30 + (p / 250) * 110); }
        else if (inWedge && s2 * m.res <= eff) {
          const terr = traceT[r * steps + s2 - 1] >= 125;
          ov.data[o] = terr ? 245 : 240; ov.data[o + 1] = terr ? 170 : 60; ov.data[o + 2] = terr ? 40 : 60; ov.data[o + 3] = 125;
        }
      }
    }
    const oc = document.createElement('canvas');
    oc.width = m.w; oc.height = m.h;
    oc.getContext('2d')!.putImageData(ov, 0, 0);
    ctx.drawImage(oc, 0, 0, W, cvH);
    const cx = ox * S, cy = oy * S, rPx = (eff / m.res) * S;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, rPx, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffd23f'; ctx.fillStyle = '#ffd23f22'; ctx.lineWidth = 2;
    const a0 = ((st.bearing - half - 90) * Math.PI) / 180, a1 = ((st.bearing + half - 90) * Math.PI) / 180;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, Math.max(rPx, 90), a0, a1); ctx.closePath(); ctx.fill(); ctx.stroke();
    handle = { x: cx + Math.sin((st.bearing * Math.PI) / 180) * Math.max(rPx, 90), y: cy - Math.cos((st.bearing * Math.PI) / 180) * Math.max(rPx, 90) };
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(handle.x, handle.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.stroke();

    // ---- readout
    const label = (c: number) => rules.classes[String(c)]?.label ?? `class ${c}`;
    const countryWord: any = { open: 'open country', close: 'close country (view 400-500 m or less)', veryClose: 'very close country (view 100-200 m or less)' };
    const wname = WEAPONS.find((w) => w[0] === wkey)![1];
    const i0 = Math.floor(oy) * m.w + Math.floor(ox);
    const cls0 = m.cls[i0];
    const split = (rules.grotbc.coverSplit.byClass[String(cls0)] ?? [0, 0, 0, 0]) as number[];
    const dd = (x: number | null, unit = '') => (x === null ? 'no data' : `${x}${unit}`);
    const nvM = wp.nv ? (wp.nv.ti ?? (night.level === 'starlight' ? wp.nv.star : wp.nv.moon) ?? 0) : 0;
    const nvr = nvM ? core.nvdReach(nvM, !!wp.nv?.ti, doctrine, v.meanViewKm) : null;
    const stops: Record<string, number> = {};
    ways.state.forEach((s2, i) => { if (s2 === 'nogo') stops[label(ways.stopClass[i])] = (stops[label(ways.stopClass[i])] ?? 0) + 1; });
    const reachTxt = obs.reachMedianM >= RADIUS - 2 * m.res ? `${f0(RADIUS)} m or more` : `${f0(obs.reachMedianM)} m`;
    const noLos = wp.channel === 'ind' || wp.channel === 'ad';
    $('out').innerHTML = `
      <div class="row"><h3>Observer <span class="tag">${f0(quick.elev0)} m</span> <span class="tag">threat ${compass(st.bearing)} ${st.bearing}&deg; &plusmn;${half}&deg;</span></h3>
        <p class="dim mono">${st.lat.toFixed(4)}N ${st.lon.toFixed(4)}E &middot; ${wname}: ${noLos ? 'no line of sight of its own' : `effective ${f0(eff)} m at a ${wp.target === 'vehicle' ? 'vehicle (2.4 m)' : 'standing man (1.7 m)'}`} (basis ${wp.basis ?? '-'}) &middot; ${mover}</p></div>
      <div class="row"><h3>O &nbsp;Observation <span class="tag">${obs.country === 'open' ? 'open' : obs.country === 'close' ? 'close' : 'very close'}</span></h3>
        <p>May be seen within ${f0(RADIUS)} m: <b class="mono">${f0(obs.seenPct)} %</b> expected (<span class="mono">${f0(obs.terrainPct)} %</span> if nothing stood on the ground, <span class="mono">${f0(obs.surePct)} %</span> sure).</p>
        <p>The view reaches <b class="mono">${reachTxt}</b> (${countryWord[obs.country]}).
        ${obs.ownScreenPct >= 30 ? `<b class="marginal">The ground cover at the point itself screens its view (${f0(obs.ownScreenPct)} %).</b>` : ''}
        ${obs.overlook ? `Overlooked from ground <b>${f0(obs.overlook.riseM)} m higher</b>, ${f0(obs.overlook.distM)} m to the ${compass(obs.overlook.bearingDeg)}; higher ground looks down from <b class="mono">${f0(obs.overlookArcPct)} %</b> of the directions.` : 'No higher ground in view.'}</p></div>
      <div class="row"><h3>O &nbsp;Fields of fire ${noLos ? '<span class="tag">indirect / air defence: needs an observer, not a line of sight</span>' : `<span class="tag ${fire.grade}">${fire.grade}</span>${fire.limitedBy ? `<span class="tag">held down by ${fire.limitedBy === 'clear' ? 'the clear distance' : 'the coverage of the range'}</span>` : ''}`}</h3>
        <p>Toward ${compass(st.bearing)}: clear to the first dead or screened ground <b class="mono">${f0(fire.clearMedianM)} m</b> (worst fifth <span class="mono">${f0(fire.clearP20M)} m</span>); ${fire.primaryOk ? 'meets' : '<b class="marginal">below</b>'} the 200 m minimum for a primary task; <span class="mono">${f0(fire.ge270Pct)} %</span> of the arc has 270 m or more.</p>
        <p>Inside the ${wname}&rsquo;s ${f0(eff)} m: <b class="mono good">${f0(fire.seenPct)} %</b> seen, <b class="mono poor">${f0(fire.deadPct)} %</b> dead ground, <b class="mono marginal">${f0(fire.screenedPct)} %</b> screened by crops, buildings or trees.</p>
        <p>${fire.bands.filter((b) => b.seenPct !== null).map((b) => `<span class="dim">${b.fromM}${b.toM ? '-' + b.toM : '+'} m</span> <span class="bar" style="width:${Math.max(2, (b.seenPct ?? 0) * 0.5)}px"></span> <span class="mono">${f0(b.seenPct)} %</span>`).join(' &nbsp; ')}</p></div>
      <div class="row"><h3>C &nbsp;Cover and concealment <span class="tag">${label(cls0)}</span></h3>
        <p class="mono">direct fire ${LEVEL[split[0]]} &middot; indirect ${LEVEL[split[1]]} &middot; ground observation ${LEVEL[split[2]]} &middot; air observation ${LEVEL[split[3]]}</p>
        <p class="dim">${MONTHS[month - 1]}: ${f0(crops.tall * 100)} % of cropland stands tall enough to hide a standing man, ${f0(crops.hides * 100)} % a crouching one. In the Ground Guide this row is the C letter&rsquo;s own reading. Check on the ground.</p></div>
      <div class="row"><h3>O &nbsp;Obstacles</h3>
        <p>${obst.nogoM !== null ? `Nearest NO-GO for ${mover} toward ${compass(st.bearing)}: <b>${label(obst.nogoClass)}</b> at <b class="mono">${f0(obst.nogoM)} m</b>, ${obst.covered ? `<b class="good">in view from here (chance ${f0(obst.seenP * 100)} %): covered by fire</b>` : obst.inRange ? `<b class="marginal">inside range but probably not seen from here (chance ${f0(obst.seenP * 100)} %)</b>` : 'beyond the range'}. It lies across <span class="mono">${f0(obst.acrossPct)} %</span> of the arc.` : `No NO-GO ground for ${mover} toward ${compass(st.bearing)} within ${f0(wedgeR)} m.`}
        ${obst.cautionM !== null ? ` Nearest SLOW-GO: ${label(obst.cautionClass)} at ${f0(obst.cautionM)} m.` : ''}</p></div>
      <div class="row"><h3>K &nbsp;Key terrain</h3>
        <p>${dom.aboveMaxM >= -5 ? 'This point is the highest ground within 3 km.' : `The highest ground within 3 km is <b>${f0(-dom.aboveMaxM)} m above</b> this point, ${f0(dom.distM)} m to the ${compass(dom.bearingDeg)} (${f0(dom.maxM)} m).`} <span class="dim">In the Ground Guide this row also lists the ITG candidates nearby and whether each is in view.</span></p></div>
      <div class="row"><h3>A &nbsp;Avenues <span class="tag">${ways.go} GO &middot; ${ways.slow} SLOW-GO &middot; ${ways.blocked} stopped</span></h3>
        <p>Straight ways out to 2 km for ${mover}, 24 directions: ${ways.state.map((s2, i) => `<span class="bar" title="${i * 15}&deg; ${s2} ${f0(ways.distM[i])} m" style="width:9px;height:${4 + Math.min(14, ways.distM[i] / 140)}px;background:${s2 === 'go' ? 'var(--ok)' : s2 === 'slow' ? 'var(--warn)' : 'var(--bad)'}"></span>`).join(' ')} <span class="dim">(north first, clockwise)</span></p>
        <p class="dim">${Object.keys(stops).length ? 'Stopped by: ' + Object.entries(stops).map(([k, n]) => `${k} (${n})`).join(', ') + '.' : 'Nothing stops a straight way out.'}</p></div>
      <div class="row"><h3>Weather and light</h3>
        <p>${MONTHS[month - 1]}: fog on <b class="mono">${dd(v.fogPct, ' %')}</b> of days, view 3 km or less on <b class="mono">${dd(v.hazePct, ' %')}</b>, under 2 km on <b class="mono">${dd(v.lt2kmPct, ' %')}</b>, mean view <b class="mono">${dd(v.meanViewKm, ' km')}</b>; nearest station <b class="mono">${dd(v.stationKm, ' km')}</b>${v.stationKm !== null && v.stationKm > 100 ? ' <b class="marginal">(far: a guess)</b>' : ''}.</p>
        <p>Now: <b>${light.level}</b> (sun ${f0(light.sunAltDeg)}&deg;, moon ${f0(light.moonAltDeg)}&deg;, ${f0(light.moonIllum * 100)} % lit). The coming night: <b>${night.level}</b> (moonlight for ${f0(night.moonlitShare * 100)} % of the dark hours).
        ${nvr ? ` Night sight reach: ordinary day ${f0(nvr.ordinaryM)} m, haze day ${f0(nvr.hazeDayM)} m, fog day ${f0(nvr.fogDayM)} m.` : ''}</p></div>`;
    $('timing').textContent = `This run: ${f1(tMove)} ms for everything the cursor card needs (observation all round, the ${half * 2} deg fire wedge to ${f0(wedgeR)} m, ways out, highest ground); ${f1(tPic)} ms for the picture (${all.length} rays, the Detail's cadence). Grid ${m.nx} x ${m.ny} tiles.`;
  } finally {
    busy = false;
    if (again) { again = false; void update(); }
  }
}

// ------------------------------------------------------------------------------------------------------ interaction
let handle = { x: 0, y: 0 };
let dragging: 'handle' | null = null;
function toCanvas(e: PointerEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height];
}
canvas.addEventListener('pointerdown', (e) => {
  const [x, y] = toCanvas(e);
  if (Math.hypot(x - handle.x, y - handle.y) < 20) { dragging = 'handle'; canvas.setPointerCapture(e.pointerId); return; }
  if (!mosaic) return;
  const S = canvas.width / mosaic.w;
  [st.lon, st.lat] = core.pxToLonLat(mosaic.px0 + x / S, mosaic.py0 + y / S, core.Z);
  void update();
});
canvas.addEventListener('pointermove', (e) => {
  if (dragging !== 'handle' || !mosaic) return;
  const [x, y] = toCanvas(e);
  const [ox, oy] = core.gridXY(mosaic, st.lon, st.lat), S = canvas.width / mosaic.w;
  st.bearing = Math.round((((Math.atan2(x - ox * S, -(y - oy * S)) * 180) / Math.PI) + 360) % 360);
  $('bearing').value = String(st.bearing);
  void update();
});
canvas.addEventListener('pointerup', () => { dragging = null; });
$('place').addEventListener('change', () => { const p = PLACES[Number($('place').value)]; [st.lon, st.lat] = [p[1], p[2]]; mosaic = null; void update(); });
for (const id of ['weapon', 'mover', 'eye', 'mode', 'month', 'when', 'sector']) $(id).addEventListener('change', () => void update());
$('bearing').addEventListener('input', () => { st.bearing = (((Number($('bearing').value) || 0) % 360) + 360) % 360; void update(); });
void update();
(window as any).ocokaTest = { core, st, update };
