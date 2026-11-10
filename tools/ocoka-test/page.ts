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
      if (!r.ok) return null;
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
  ['Karachi', 67.01, 24.86], ['Multan farmland', 71.5, 30.2],
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
let mosaic: core.Mosaic | null = null;
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
function renderBase(m: core.Mosaic): HTMLCanvasElement {
  const { w, h, elev, res } = m;
  const cls = m.layers['class'];
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
const f0 = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en') : '-');
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-');
const LEVEL = ['none', 'poor', 'fair', 'good'];
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (b: number) => COMPASS[Math.round((((b % 360) + 360) % 360) / 45) % 8];
let busy = false, again = false;

async function ensureMosaic(): Promise<void> {
  if (mosaic) {
    const [x, y] = core.mosaicXY(mosaic, st.lon, st.lat);
    const m = RADIUS / mosaic.res + 30;
    if (x > m && y > m && x < mosaic.w - m && y < mosaic.h - m) return;
  }
  mosaic = await core.loadMosaic(src, st.lon, st.lat, RADIUS + 1500, ['class', 'cc', 'bld']);
  base = renderBase(mosaic);
}

async function update(): Promise<void> {
  if (busy) { again = true; return; }
  busy = true;
  try {
    await ensureMosaic();
    const m = mosaic!;
    const [ox, oy] = core.mosaicXY(m, st.lon, st.lat);
    const [eyeM, targetM] = ($('eye').value as string).split('|').map(Number);
    const month = Number($('month').value);
    const mover = $('mover').value as string;
    const wkey = $('weapon').value as string;
    const wr = sym[wkey].Rng;
    const eff = Math.max(wr.dir?.[1] ?? 0, wr.at?.[1] ?? 0, wr.ind ? 0 : 0) || 300;
    const mode = $('mode').value as core.BlockerMode;
    const half = Number($('sector').value) / 2;
    const sec = { centreDeg: st.bearing, halfDeg: half };
    const going = core.goingTable(rules, mover);
    const blk = core.blockerTable(doctrine, mode, month);
    const opts = (b: core.Blockers, radiusM: number, trace?: Uint8Array): core.RayOpts => ({ eyeM, targetM, radiusM, noiseM: 1.0, k: 0.13, blk: b, going, effM: eff, trace });

    // the three cases for the range
    const step = core.raysFor(RADIUS, m.res);
    const all = core.bearingsFor(step);
    const t0 = performance.now();
    const steps = Math.floor(RADIUS / m.res);
    const trace = new Uint8Array(all.length * steps);
    const rMain = core.analyseRays(m, ox, oy, all, opts(blk, RADIUS, trace));
    const tFull = performance.now() - t0;
    const cases = (['none', 'mid', 'max'] as const).map((md) => core.observationOf(md === mode ? rMain : core.analyseRays(m, ox, oy, all, opts(core.blockerTable(doctrine, md, month), RADIUS))));
    const obs = core.observationOf(rMain);

    // the wedge, as it would run on every mouse move
    const wedgeR = Math.min(RADIUS, Math.max(eff, 500));
    const t1 = performance.now();
    const wedge = core.analyseRays(m, ox, oy, core.bearingsFor(core.raysFor(wedgeR, m.res), st.bearing, half * 2), opts(blk, wedgeR));
    const tWedge = performance.now() - t1;
    const fof = core.fieldOfFireOf(wedge, sec, eff);
    const obst = core.obstacleFrontOf(wedge, sec, eff);
    const t2 = performance.now();
    const gr = core.goReach(m, ox, oy, going, RADIUS, 2000);
    const tGo = performance.now() - t2;
    const dom = core.dominanceOf(m, ox, oy, 3000);
    const cover = core.coverAt(m, ox, oy, rules, doctrine, month);
    const v = core.visibilityAt(vis, st.lon, st.lat, month);
    const when = new Date(new Date(String($('when').value) + ':00Z').getTime() - 5 * 3600000);
    const light = core.lightAt(when, st.lat, st.lon);

    // ---- draw
    const W = canvas.width, S = W / m.w;
    ctx.clearRect(0, 0, W, canvas.height);
    ctx.imageSmoothingEnabled = true;
    const cvH = Math.round(m.h * S);
    canvas.height = cvH;
    ctx.drawImage(base!, 0, 0, W, cvH);
    const ov = new ImageData(m.w, m.h);
    for (let r = 0; r < all.length; r++) {
      const b = (all[r] * Math.PI) / 180, dx = Math.sin(b), dy = -Math.cos(b);
      const inWedge = Math.abs(((all[r] - st.bearing + 540) % 360) - 180) <= half;
      for (let s = 1; s <= steps; s++) {
        const f = trace[r * steps + s - 1];
        if (f === 2) break;
        const px = Math.round(ox + dx * s - 0.5), py = Math.round(oy + dy * s - 0.5);
        if (px < 0 || py < 0 || px >= m.w || py >= m.h) break;
        const o = (py * m.w + px) * 4;
        if (f === 1) { ov.data[o] = 60; ov.data[o + 1] = 230; ov.data[o + 2] = 110; ov.data[o + 3] = 95; }
        else if (inWedge && s * m.res <= eff) { ov.data[o] = 240; ov.data[o + 1] = 60; ov.data[o + 2] = 60; ov.data[o + 3] = 125; }
      }
    }
    const oc = document.createElement('canvas');
    oc.width = m.w; oc.height = m.h;
    oc.getContext('2d')!.putImageData(ov, 0, 0);
    ctx.drawImage(oc, 0, 0, W, cvH);
    const cx = ox * S, cy = oy * S, rPx = (eff / m.res) * S;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, rPx, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffd23f'; ctx.fillStyle = '#ffd23f44'; ctx.lineWidth = 2;
    const a0 = ((st.bearing - half - 90) * Math.PI) / 180, a1 = ((st.bearing + half - 90) * Math.PI) / 180;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, Math.max(rPx, 90), a0, a1); ctx.closePath(); ctx.fill(); ctx.stroke();
    handle = { x: cx + Math.sin((st.bearing * Math.PI) / 180) * Math.max(rPx, 90) * 1.0, y: cy - Math.cos((st.bearing * Math.PI) / 180) * Math.max(rPx, 90) * 1.0 };
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(handle.x, handle.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.stroke();

    // ---- readout
    const g = (x: string) => `<span class="${x}">${x}</span>`;
    const nogoName = obst.nogoClass ? rules.classes[String(obst.nogoClass)]?.label : null;
    const cautName = obst.cautionClass ? rules.classes[String(obst.cautionClass)]?.label : null;
    const countryWord: any = { open: 'open country', close: 'close country (view 400-500 m or less)', veryClose: 'very close country (view 100-200 m or less)' };
    const wname = WEAPONS.find((w) => w[0] === wkey)![1];
    const nv = wr.nv ? (wr.nv.ti ? `thermal ${wr.nv.ti} m` : `moonlight ${wr.nv.moon} m, starlight ${wr.nv.star} m`) : null;
    const nvdM = wr.nv ? (wr.nv.ti ?? wr.nv.moon) : 0;
    const nvr = nvdM ? core.nvdReach(light.level === 'starlight' && wr.nv?.star ? wr.nv.star : nvdM, !!wr.nv?.ti, doctrine, v.meanViewKm) : null;
    const dd = (x: number | null, unit = '') => (x === null ? 'no data' : `${x}${unit}`);
    const split = cover.split;
    $('out').innerHTML = `
      <div class="row"><h3>Observer <span class="tag">${f0(rMain.elev0)} m</span> <span class="tag">${compass(st.bearing)} ${st.bearing}&deg; &plusmn;${half}&deg;</span></h3>
        <p class="dim mono">${st.lat.toFixed(4)}N ${st.lon.toFixed(4)}E &middot; ${wname}: effective ${f0(eff)} m (basis ${wr.b}) &middot; ${mover} &middot; ${LEVEL[0] && ''}${light.level} now</p></div>
      <div class="row"><h3>O &nbsp;Observation <span class="tag">${obs.country === 'open' ? 'open' : obs.country === 'close' ? 'close' : 'very close'}</span></h3>
        <p>May be seen: <b class="mono">${f0(cases[0].seenPct)} %</b> of the ground within ${f0(RADIUS)} m on the bare DEM, <b class="mono">${f0(cases[1].seenPct)} %</b> central, <b class="mono">${f0(cases[2].seenPct)} %</b> with the tallest blockers.</p>
        <p>The view reaches a median <b class="mono">${f0(obs.reachMedianM)} m</b> (${countryWord[obs.country]}).
        ${obs.overlook ? `Overlooked from ground <b>${f0(obs.overlook.riseM)} m higher</b>, ${f0(obs.overlook.distM)} m to the ${compass(obs.overlook.bearingDeg)}.` : 'No higher ground in view.'}
        ${dom.aboveMaxM >= -10 ? 'Highest ground within 3 km.' : `${f0(-dom.aboveMaxM)} m below the highest ground within 3 km.`}</p></div>
      <div class="row"><h3>O &nbsp;Fields of fire <span class="tag ${fof.grade}">${fof.grade}</span></h3>
        <p>Toward ${compass(st.bearing)}: clear to the first dead ground <b class="mono">${f0(fof.medianM)} m</b> median (<span class="mono">${f0(fof.p20M)}</span> m worst fifth);
        <b class="mono">${f0(fof.ge200Pct)} %</b> of the arc has 200 m or more, <b class="mono">${f0(fof.ge270Pct)} %</b> has 270 m or more (doctrine: 200 m minimum, 270-500 m desirable).</p>
        <p>Dead ground inside the ${wname}'s ${f0(eff)} m: <b class="mono">${f0(fof.deadPct)} %</b> &mdash; ${fof.deadPct > 50 ? 'cover it with another weapon, obstacles or patrols.' : fof.deadPct > 20 ? 'some dead ground to cover.' : 'little dead ground.'}</p></div>
      <div class="row"><h3>C &nbsp;Cover and concealment <span class="tag">${cover.className}</span></h3>
        <p class="mono">direct fire ${LEVEL[split[0]]} &middot; indirect ${LEVEL[split[1]]} &middot; ground observation ${LEVEL[split[2]]} &middot; air observation ${LEVEL[split[3]]}</p>
        ${cover.note ? `<p class="dim">${cover.note}.</p>` : ''}<p class="dim">Bundle area cover: concealment ${LEVEL[cover.cc.concealment] ?? cover.cc.concealment}, cover ${LEVEL[cover.cc.cover] ?? cover.cc.cover}. Say &ldquo;may be&rdquo;: check on the ground.</p></div>
      <div class="row"><h3>O &nbsp;Obstacles</h3>
        <p>${nogoName ? `Nearest NO-GO for ${mover} toward ${compass(st.bearing)}: <b>${nogoName}</b> at <b class="mono">${f0(obst.nogoM)} m</b>${obst.covered ? ', <b class="good">seen from here: covered by fire</b>' : obst.nogoM <= eff ? ', <b class="marginal">inside range but not seen from here</b>' : ', beyond the weapon\'s range'}. ${f0(obst.blockedPct)} % of the arc meets NO-GO inside ${f0(eff)} m.` : `No NO-GO ground for ${mover} toward ${compass(st.bearing)} within ${f0(wedgeR)} m.`}
        ${cautName ? ` SLOW-GO: ${cautName} at ${f0(obst.cautionM)} m.` : ''}</p></div>
      <div class="row"><h3>K &nbsp;Key terrain</h3>
        <p>${dom.aboveMaxM >= -10 ? 'This point is the highest ground within 3 km.' : `Highest ground within 3 km is ${f0(-dom.aboveMaxM)} m above this point (${f0(dom.maxM)} m).`} <span class="dim">ITG candidates and chokepoints come from the features tiles: not part of this test.</span></p></div>
      <div class="row"><h3>A &nbsp;Avenues <span class="tag">${gr.waysOut} of 24 ways out</span></h3>
        <p>Direct ways of 2 km or more for ${mover} (a canal crossed only at a distant bridge does not count): ${gr.waysOut} of 24 sectors. ${f0(gr.reachPct)} % of the ${f0(RADIUS)} m circle is reachable directly.</p>
        <p>${Array.from(gr.sectorM).map((d, i) => `<span class="bar" title="${i * 15}&deg;: ${f0(d)} m" style="width:${Math.max(2, Math.min(100, d / 50)) * 0.1}px;height:${4 + Math.min(14, d / 350)}px"></span>`).join('')}</p></div>
      <div class="row"><h3>Weather and light</h3>
        <p>${MONTHS[month - 1]}: fog on <b class="mono">${dd(v.fogPct, ' %')}</b> of days, view 3 km or less on <b class="mono">${dd(v.hazePct, ' %')}</b>, under 2 km on <b class="mono">${dd(v.lt2kmPct, ' %')}</b>, mean view <b class="mono">${dd(v.meanViewKm, ' km')}</b>; nearest station <b class="mono">${dd(v.stationKm, ' km')}</b>${v.stationKm !== null && v.stationKm > 100 ? ' <b class="marginal">(far: a guess)</b>' : ''}.</p>
        <p>Light at ${String($('when').value).replace('T', ' ')}: <b>${light.level}</b> (sun ${f0(light.sunAltDeg)}&deg;, moon ${f0(light.moonAltDeg)}&deg;, ${f0(light.moonIllum * 100)} % lit).
        ${nvr ? ` Night sight (${nv}): ordinary day ${f0(nvr.ordinaryM)} m, haze day ${f0(nvr.hazeDayM)} m, fog day ${f0(nvr.fogDayM)} m.` : ''}</p></div>`;
    $('timing').textContent = `This run: ${f1(tWedge)} ms for the ${half * 2} deg wedge to ${f0(wedgeR)} m (the mouse-move case); ${f1(tFull)} ms for the all-round ${f0(RADIUS)} m view with the picture trace (${all.length} rays); ${f1(tGo)} ms for the going flood. Mosaic ${m.nx} x ${m.ny} tiles.`;
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
  [st.lon, st.lat] = core.pxToLonLat(mosaic.px0 + x / S, mosaic.py0 + y / S);
  void update();
});
canvas.addEventListener('pointermove', (e) => {
  if (dragging !== 'handle' || !mosaic) return;
  const [x, y] = toCanvas(e);
  const [ox, oy] = core.mosaicXY(mosaic, st.lon, st.lat), S = canvas.width / mosaic.w;
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
