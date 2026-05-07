/**
 * trajectory-engine.js
 * Ballistic projectile trajectory — physics + ArcGIS graphic builder.
 * Pure computation module; inject ArcGIS classes via factory.
 *
 * Physics model
 * ─────────────
 * • 4th-order Runge-Kutta integration (stable for long mortar / artillery arcs)
 * • Aerodynamic drag:  F = 0.5 · ρ(z) · Cd · A · v²   (exponential atmosphere)
 * • Constant wind field in ENU coords
 * • Coriolis omitted — negligible at tactical ranges (<50 km)
 *
 * Coordinate space
 * ────────────────
 * Integration runs in local ENU metres from the launch point.
 * Each waypoint is converted back to WGS-84 (lon, lat, z_MSL) for ArcGIS.
 */

// ─── Projectile presets ──────────────────────────────────────────────────────
export const PROJECTILE_PRESETS = {
  mortar_60mm: {
    label: 'Mortar 60 mm',     massKg: 1.77,  diameterM: 0.060, Cd: 0.35,
    muzzleVelMS: 213,          elevMinDeg: 40,  elevMaxDeg: 85,  elevDefaultDeg: 65,
    color: [239, 159, 39],     cepm: 35,
  },
  mortar_81mm: {
    label: 'Mortar 81 mm',     massKg: 4.15,  diameterM: 0.081, Cd: 0.33,
    muzzleVelMS: 240,          elevMinDeg: 40,  elevMaxDeg: 85,  elevDefaultDeg: 65,
    color: [239, 159, 39],     cepm: 50,
  },
  artillery_105mm: {
    label: 'Artillery 105 mm', massKg: 14.97, diameterM: 0.105, Cd: 0.25,
    muzzleVelMS: 494,          elevMinDeg: 5,   elevMaxDeg: 65,  elevDefaultDeg: 45,
    color: [186, 117, 23],     cepm: 100,
  },
  artillery_155mm: {
    label: 'Artillery 155 mm', massKg: 43.5,  diameterM: 0.155, Cd: 0.22,
    muzzleVelMS: 827,          elevMinDeg: 5,   elevMaxDeg: 65,  elevDefaultDeg: 45,
    color: [186, 117, 23],     cepm: 150,
  },
  atgm: {
    label: 'ATGM',             massKg: 11.3,  diameterM: 0.120, Cd: 0.40,
    muzzleVelMS: 320,          elevMinDeg: -10, elevMaxDeg: 20,  elevDefaultDeg: 0,
    color: [220, 90, 48],      cepm: 10,
  },
  rpg7: {
    label: 'RPG-7',            massKg: 2.25,  diameterM: 0.073, Cd: 0.45,
    muzzleVelMS: 294,          elevMinDeg: -15, elevMaxDeg: 25,  elevDefaultDeg: 0,
    color: [220, 90, 48],      cepm: 300,
  },
  drone: {
    label: 'Drone route',      massKg: 2.5,   diameterM: 0.80,  Cd: 0.80,
    muzzleVelMS: 28,           elevMinDeg: 5,  elevMaxDeg: 45,   elevDefaultDeg: 20,
    color: [55, 138, 221],     cepm: 5,
  },
};

// ─── Physical constants ──────────────────────────────────────────────────────
const G        = 9.80665;        // m/s²
const RHO_SL   = 1.225;          // kg/m³  sea-level air density
const EARTH_R  = 6_371_008.8;    // m

// ─── Geodetic helpers ────────────────────────────────────────────────────────
export function destinationPoint(lon, lat, bearingDeg, distM) {
  const δ = distM / EARTH_R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180, λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1)*Math.cos(δ) + Math.cos(φ1)*Math.sin(δ)*Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ)*Math.sin(δ)*Math.cos(φ1), Math.cos(δ)-Math.sin(φ1)*Math.sin(φ2));
  return { longitude: (λ2*180)/Math.PI, latitude: (φ2*180)/Math.PI };
}

function ENUtoWGS84(originLon, originLat, originAlt, east, north, up) {
  const gd = Math.sqrt(east*east + north*north);
  if (gd < 1e-9) return { longitude: originLon, latitude: originLat, z: originAlt + up };
  const bearing = (Math.atan2(east, north) * 180) / Math.PI;
  const { longitude, latitude } = destinationPoint(originLon, originLat, bearing, gd);
  return { longitude, latitude, z: originAlt + up };
}

// ─── Atmosphere ──────────────────────────────────────────────────────────────
function airDensity(altMSL) { return RHO_SL * Math.exp(-Math.max(0, altMSL) / 10400); }

// ─── RK4 integrator step ─────────────────────────────────────────────────────
// state = [east, north, up, vE, vN, vU]
function rk4Step(state, dt, p) {
  function deriv([e, n, u, vE, vN, vU]) {
    const v  = Math.sqrt(vE*vE + vN*vN + vU*vU);
    const ρ  = airDensity(p.launchAltM + u);
    const A  = Math.PI * (p.diameterM/2)**2;
    const Fd = 0.5 * ρ * p.Cd * A * v * v;
    const m  = p.massKg;
    const aE = v > 0.01 ? -(Fd/m)*(vE/v) + p.windE : p.windE;
    const aN = v > 0.01 ? -(Fd/m)*(vN/v) + p.windN : p.windN;
    const aU = v > 0.01 ? -(Fd/m)*(vU/v)           : 0;
    return [vE, vN, vU, aE, aN, aU - G];
  }
  const k1 = deriv(state);
  const k2 = deriv(state.map((s,i) => s + .5*dt*k1[i]));
  const k3 = deriv(state.map((s,i) => s + .5*dt*k2[i]));
  const k4 = deriv(state.map((s,i) => s +    dt*k3[i]));
  return state.map((s,i) => s + dt*(k1[i]+2*k2[i]+2*k3[i]+k4[i])/6);
}

// ─── Main trajectory computation ─────────────────────────────────────────────
export function computeTrajectory({
  originLon, originLat, launchAltM = 0,
  bearingDeg = 0, elevDeg = 45,
  muzzleVelMS, massKg, diameterM, Cd,
  windSpeedMS = 0, windBearingDeg = 270,
  dtS = 0.2, maxTimeS = 300,
}) {
  const elevR  = (elevDeg    * Math.PI) / 180;
  const bearR  = (bearingDeg * Math.PI) / 180;
  const vH     = muzzleVelMS * Math.cos(elevR);
  // Wind: "wind FROM" convention → flip 180° to get downwind velocity
  const windBR = ((windBearingDeg + 180) % 360) * Math.PI / 180;
  const windE  = windSpeedMS * Math.sin(windBR);
  const windN  = windSpeedMS * Math.cos(windBR);

  const params = { massKg, diameterM, Cd, windE, windN, launchAltM };
  let state    = [0, 0, 0, vH*Math.sin(bearR), vH*Math.cos(bearR), muzzleVelMS*Math.sin(elevR)];
  let t = 0;
  const waypoints = [];
  let phase = 'launch', apogeeIdx = -1;

  while (t < maxTimeS) {
    const [e, n, u] = state;
    const wgs = ENUtoWGS84(originLon, originLat, launchAltM, e, n, u);
    const speed = Math.sqrt(state[3]**2 + state[4]**2 + state[5]**2);

    if (phase === 'launch' && state[5] <= 0) {
      phase = 'terminal';
      apogeeIdx = waypoints.length;
    }
    waypoints.push({ ...wgs, t, phase, east: e, north: n, up: u, speed });

    if (t > 0.5 && wgs.z <= launchAltM - 5) break;   // hit ground

    state = rk4Step(state, dtS, params);
    t += dtS;
  }

  const impact  = waypoints.at(-1);
  const apogee  = waypoints[apogeeIdx] ?? waypoints[Math.floor(waypoints.length / 2)];
  const rangeM  = Math.sqrt(impact.east**2 + impact.north**2);
  const maxAltM = Math.max(...waypoints.map(w => w.z));

  return { waypoints, impact, apogee, rangeM, maxAltM, flightS: impact.t };
}

// ─── Factory — inject ArcGIS classes ─────────────────────────────────────────
export function createTrajectoryEngine(deps) {
  const { Point, Polyline, Graphic } = deps;

  // Build 3D polyline graphics — ascending (solid) and descending (dashed)
  function buildTrajectoryGraphics({ waypoints }, { color }) {
    const [r, g, b] = color;
    const seg = phase => waypoints.filter(w => w.phase === phase);

    function makeLine(pts, size, opacity, style) {
      if (pts.length < 2) return null;
      return new Graphic({
        geometry: new Polyline({
          hasZ: true,
          paths: [pts.map(p => [p.longitude, p.latitude, p.z])],
          spatialReference: { wkid: 4326 },
        }),
        symbol: {
          type: 'line-3d',
          symbolLayers: [{ type: 'line', size, material: { color: [r,g,b,opacity] },
            pattern: { type: 'style', style }, cap: 'round', join: 'round' }],
        },
        attributes: { type: 'trajectory_arc' },
      });
    }

    return [
      makeLine(seg('launch'),   2.5, 0.92, 'solid'),
      makeLine(seg('terminal'), 2.0, 0.55, 'dash'),
    ].filter(Boolean);
  }

  // Animated projectile sphere that rides the arc
  function buildProjectileMarker({ color }) {
    const [r,g,b] = color;
    return new Graphic({
      symbol: {
        type: 'point-3d',
        symbolLayers: [{ type: 'object', resource: { primitive: 'sphere' },
          material: { color: [r,g,b,0.95] }, width: 60, height: 60, depth: 60 }],
        verticalOffset: { screenLength: 0 },
      },
      attributes: { type: 'trajectory_projectile' },
    });
  }

  // Launch / apogee / impact markers
  function buildKeyMarkers({ waypoints, apogee, impact, maxAltM, rangeM }, { color }) {
    const [r,g,b] = color;
    const mk = (lon, lat, z) => new Point({ longitude: lon, latitude: lat, z, spatialReference: { wkid: 4326 } });

    const launchPt = waypoints[0];
    return [
      // Launch — diamond
      new Graphic({
        geometry: mk(launchPt.longitude, launchPt.latitude, launchPt.z),
        symbol: { type:'point-3d', symbolLayers:[{ type:'object', resource:{ primitive:'diamond' },
          material:{ color:[r,g,b,0.9] }, width:55, height:55, depth:55 }],
          verticalOffset:{ screenLength:28, maxWorldLength:500, minWorldLength:5 } },
        attributes: { type:'trajectory_launch', label:'FIRE' },
      }),
      // Apogee — cone
      new Graphic({
        geometry: mk(apogee.longitude, apogee.latitude, apogee.z),
        symbol: { type:'point-3d', symbolLayers:[{ type:'object', resource:{ primitive:'cone' },
          material:{ color:[239,159,39,0.9] }, width:45, height:45, depth:45 }],
          verticalOffset:{ screenLength:24, maxWorldLength:400, minWorldLength:4 } },
        attributes: { type:'trajectory_apogee', label:`APOGEE ${Math.round(maxAltM)} m MSL` },
      }),
      // Impact — sphere red
      new Graphic({
        geometry: mk(impact.longitude, impact.latitude, impact.z),
        symbol: { type:'point-3d', symbolLayers:[{ type:'object', resource:{ primitive:'sphere' },
          material:{ color:[220,90,48,0.9] }, width:55, height:55, depth:55 }],
          verticalOffset:{ screenLength:22, maxWorldLength:400, minWorldLength:4 } },
        attributes: { type:'trajectory_impact', label:`IMPACT  range ${Math.round(rangeM)} m` },
      }),
    ];
  }

  // CEP ring around impact point
  function buildCEPGraphic({ impact }, { color, cepm }) {
    const [r,g,b] = color;
    const ring = [];
    for (let i = 0; i <= 72; i++) {
      const bearing = (i / 72) * 360;
      const pt = destinationPoint(impact.longitude, impact.latitude, bearing, cepm);
      ring.push([pt.longitude, pt.latitude, impact.z]);
    }
    return new Graphic({
      geometry: { type:'polygon', rings:[ring], hasZ:true, spatialReference:{ wkid:4326 } },
      symbol: {
        type: 'polygon-3d',
        symbolLayers: [{ type:'fill', material:{ color:[r,g,b,0.07] },
          outline:{ color:[r,g,b,0.75], size:1.5 },
          pattern:{ type:'style', style:'diagonal-cross' } }],
      },
      attributes: { type:'trajectory_cep', cepm },
    });
  }

  // Animation controller — drives the marker graphic along the arc
  function createAnimationController(waypoints, markerGraphic, animLayer) {
    const totalTime = waypoints.at(-1).t;
    let rafId = null, playing = false, progress = 0, speedScale = 3;

    function interpolate(prog) {
      const elapsed = prog * totalTime;
      let lo = 0, hi = waypoints.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        waypoints[mid].t <= elapsed ? (lo = mid) : (hi = mid);
      }
      const [w0, w1] = [waypoints[lo], waypoints[hi]];
      const span = w1.t - w0.t, α = span < 1e-9 ? 0 : (elapsed - w0.t) / span;
      return {
        longitude: w0.longitude + α*(w1.longitude - w0.longitude),
        latitude:  w0.latitude  + α*(w1.latitude  - w0.latitude),
        z:         w0.z         + α*(w1.z         - w0.z),
        speed:     w0.speed     + α*(w1.speed     - w0.speed),
      };
    }

    function updateMarker() {
      const pt = interpolate(progress);
      markerGraphic.geometry = new Point({ longitude: pt.longitude, latitude: pt.latitude, z: pt.z, spatialReference: { wkid: 4326 } });
      if (!animLayer.graphics.includes(markerGraphic)) animLayer.add(markerGraphic);
      return pt;
    }

    function tick(lastMs, nowMs) {
      const dtSec = Math.min(0.1, (nowMs - lastMs) / 1000);
      progress = Math.min(1, progress + (dtSec * speedScale) / totalTime);
      updateMarker();
      if (progress < 1 && playing) rafId = requestAnimationFrame(tick.bind(null, nowMs));
      else { playing = false; rafId = null; }
    }

    return {
      start(scale = 3) {
        if (playing) return;
        speedScale = scale; playing = true; progress = 0;
        rafId = requestAnimationFrame(ts => tick(ts, ts));
      },
      stop() {
        playing = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      },
      seek(p) {
        progress = Math.min(1, Math.max(0, p));
        updateMarker();
      },
      setSpeed(s) { speedScale = s; },
      get playing()  { return playing; },
      get progress() { return progress; },
      get currentPt(){ return interpolate(progress); },
    };
  }

  return { buildTrajectoryGraphics, buildProjectileMarker, buildKeyMarkers,
           buildCEPGraphic, createAnimationController };
}
