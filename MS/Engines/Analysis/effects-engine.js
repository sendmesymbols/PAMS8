/**
 * effects-engine.js
 * Munition Effects Radius — blast overpressure, fragmentation, thermal, safe-distance.
 * Physics based on Hopkinson-Cranz scaling law and empirical NATO AASTP-4 tables.
 * Pure computation module; inject ArcGIS geometry classes via factory.
 *
 * Capabilities
 * ────────────
 * • Hopkinson-Cranz scaled distance → overpressure lookup
 * • Fragmentation lethal radius via Gurney energy model (simplified)
 * • Thermal radius from scaled fireball model
 * • Personnel / structural / vehicular categories with separate radii
 * • Building attenuation factor applied to each radius
 * • 3D animated blast-wave sphere using custom Mesh geometry
 * • Multi-munition union for simultaneous strike footprints
 * • Time-of-arrival rings for sequential detonations
 */

// ── Munition database ─────────────────────────────────────────────────────────
// TNT equivalent mass drives Hopkinson-Cranz scaling.
// fragmentVelocityMS: initial fragment velocity (Gurney approximation)
// casingMassRatio:    casing mass / explosive mass (affects frag density)
export const MUNITION_PRESETS = {
  mortar_60mm: {
    label:              'Mortar 60 mm',
    tntEquivKg:         0.23,
    fragmentVelocityMS: 1200,
    casingMassRatio:    2.8,
    detonationHeightM:  0,
    color:              [239, 159, 39],
    icon:               '⬡',
  },
  mortar_81mm: {
    label:              'Mortar 81 mm',
    tntEquivKg:         0.56,
    fragmentVelocityMS: 1350,
    casingMassRatio:    2.5,
    detonationHeightM:  0,
    color:              [239, 159, 39],
    icon:               '⬡',
  },
  artillery_105mm: {
    label:              'Artillery 105 mm HE',
    tntEquivKg:         2.18,
    fragmentVelocityMS: 1550,
    casingMassRatio:    3.1,
    detonationHeightM:  0,
    color:              [186, 117, 23],
    icon:               '◈',
  },
  artillery_155mm: {
    label:              'Artillery 155 mm HE',
    tntEquivKg:         6.62,
    fragmentVelocityMS: 1650,
    casingMassRatio:    3.3,
    detonationHeightM:  0,
    color:              [186, 117, 23],
    icon:               '◈',
  },
  ied_10kg: {
    label:              'IED 10 kg TNT',
    tntEquivKg:         10.0,
    fragmentVelocityMS: 800,
    casingMassRatio:    0.5,
    detonationHeightM:  0,
    color:              [220, 90, 48],
    icon:               '✕',
  },
  vbied_100kg: {
    label:              'VBIED 100 kg TNT',
    tntEquivKg:         100.0,
    fragmentVelocityMS: 900,
    casingMassRatio:    0.3,
    detonationHeightM:  1.2,
    color:              [220, 60, 48],
    icon:               '✕',
  },
  gbbu_500lb: {
    label:              'GBU-12 500 lb',
    tntEquivKg:         89.0,
    fragmentVelocityMS: 1800,
    casingMassRatio:    4.2,
    detonationHeightM:  0,
    color:              [55, 138, 221],
    icon:               '▽',
  },
  thermobaric: {
    label:              'Thermobaric / FAE',
    tntEquivKg:         55.0,
    fragmentVelocityMS: 600,
    casingMassRatio:    0.2,
    detonationHeightM:  15,   // burst altitude
    color:              [180, 40, 220],
    icon:               '◉',
  },
};

// ── Building / structural attenuation factors ────────────────────────────────
export const STRUCTURE_FACTORS = {
  open_area:        { label: 'Open area',          blastMult: 1.0,  fragMult: 1.0  },
  light_urban:      { label: 'Light urban (wood)',  blastMult: 0.75, fragMult: 0.60 },
  masonry:          { label: 'Masonry / brick',     blastMult: 0.55, fragMult: 0.40 },
  reinforced_concrete:{ label:'Reinforced concrete',blastMult: 0.30, fragMult: 0.20 },
  reenforced_shelter:{ label:'Field shelter / HESCO',blastMult:0.40, fragMult: 0.35 },
};

// ── Hopkinson-Cranz blast model ───────────────────────────────────────────────
// Z = R / W^(1/3)   where W = TNT equiv. (kg), R = range (m)
// Overpressure lookup from empirical free-air burst table (kPa)
const HC_TABLE = [
  // [Z (m/kg^1/3), peak overpressure (kPa)]
  [0.3, 82740], [0.4, 27580], [0.5, 12410], [0.6,  6210],
  [0.7,  3450], [0.8,  2070], [1.0,  1040], [1.2,   621],
  [1.5,   345], [2.0,   172], [2.5,   103], [3.0,    69],
  [4.0,    41], [5.0,    28], [7.0,    14], [10.0,    7],
  [15.0,   3.5],[20.0,   2.0],[30.0,   1.0],[50.0,  0.35],
];

function zToOverpressureKPa(Z) {
  if (Z <= HC_TABLE[0][0])  return HC_TABLE[0][1];
  if (Z >= HC_TABLE.at(-1)[0]) return HC_TABLE.at(-1)[1];
  for (let i = 0; i < HC_TABLE.length - 1; i++) {
    const [z0, p0] = HC_TABLE[i], [z1, p1] = HC_TABLE[i+1];
    if (Z >= z0 && Z <= z1) {
      const t = (Z - z0) / (z1 - z0);
      return Math.exp(Math.log(p0) + t * (Math.log(p1) - Math.log(p0)));
    }
  }
  return 0;
}

/** Range (m) at which overpressure drops to `targetKPa` */
function overpressureRadius(tntKg, targetKPa, heightM = 0) {
  // Binary search over scaled distance Z
  const W3 = Math.cbrt(tntKg);
  let lo = 0.1, hi = 60;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (zToOverpressureKPa(mid) > targetKPa) lo = mid; else hi = mid;
  }
  // Slant correction: hypotenuse from burst height to ground range
  const groundR = lo * W3;
  return Math.sqrt(groundR * groundR + heightM * heightM);
}

// ── Fragmentation lethal radius ───────────────────────────────────────────────
// Simplified Gurney model: v0 given by preset; lethal range where v drops to ~60 m/s
// (below which standard field gear provides protection)
// v(r) = v0 * sqrt(r0/r)^2 * exp(-r/λ), λ ≈ 200m for standard HE
function fragLethalRadius(tntKg, v0MS, casingRatio) {
  const r0     = 0.15 * Math.cbrt(tntKg);  // approx. casing radius
  const lambda = 180 + casingRatio * 15;    // attenuation length
  const vMin   = 60;                        // m/s — minimum lethal fragment velocity
  // Iterate to find r where v(r) = vMin
  let r = r0;
  for (let i = 0; i < 200; i++) {
    const v = v0MS * (r0 / r) * Math.exp(-r / lambda);
    if (v <= vMin) break;
    r += 0.5;
  }
  return r;
}

// ── Thermal radius (fireball model) ──────────────────────────────────────────
// Approximate 3rd-degree burn radius from fireball scaling
function thermalRadius(tntKg) {
  return 1.8 * Math.cbrt(tntKg) * Math.pow(tntKg, 0.17);
}

// ── Main effects computation ──────────────────────────────────────────────────
export function computeEffects(munition, structureFactor = 'open_area', detonationHeightOverride = null) {
  const m  = MUNITION_PRESETS[munition] ?? MUNITION_PRESETS.mortar_81mm;
  const sf = STRUCTURE_FACTORS[structureFactor] ?? STRUCTURE_FACTORS.open_area;
  const W  = m.tntEquivKg;
  const h  = detonationHeightOverride ?? m.detonationHeightM;

  // Blast overpressure rings (personnel thresholds from AASTP-4)
  const lethalBlastKPa    = 200;   // ~100% fatality threshold
  const injuryBlastKPa    = 35;    // lung injury / eardrum rupture
  const safeBlastKPa      = 6.9;   // nuisance / glass breakage

  const rLethalBlast  = overpressureRadius(W, lethalBlastKPa,  h) * sf.blastMult;
  const rInjuryBlast  = overpressureRadius(W, injuryBlastKPa,  h) * sf.blastMult;
  const rSafeBlast    = overpressureRadius(W, safeBlastKPa,    h) * sf.blastMult;

  // Fragmentation
  const rFragLethal   = fragLethalRadius(W, m.fragmentVelocityMS, m.casingMassRatio) * sf.fragMult;
  const rFragCasualty = rFragLethal * 1.6;   // wounding (lower velocity)

  // Thermal (thermobaric / FAE emphasis)
  const rThermal      = thermalRadius(W) * sf.blastMult;

  // Composite lethal radius = max of blast lethal and frag lethal
  const rCompositeLethal = Math.max(rLethalBlast, rFragLethal);

  // UN safe distances (IATG 06.10 simplified)
  const rQD_inhabited = 22.2 * Math.cbrt(W);   // quantity-distance inhabited buildings
  const rQD_public    = rQD_inhabited * 0.6;

  return {
    munition: m,
    structureFactor: sf,
    detonationHeightM: h,
    rings: [
      { id:'lethal_composite', label:'Lethal radius',    radiusM: rCompositeLethal, colorKey:'lethal',  opacity:0.22 },
      { id:'injury_blast',     label:'Injury — blast',   radiusM: rInjuryBlast,     colorKey:'warning', opacity:0.16 },
      { id:'frag_casualty',    label:'Frag casualty',    radiusM: rFragCasualty,     colorKey:'warning', opacity:0.12 },
      { id:'thermal',          label:'Thermal / 3° burn',radiusM: rThermal,          colorKey:'thermal', opacity:0.10 },
      { id:'safe_blast',       label:'Safe — blast',     radiusM: rSafeBlast,        colorKey:'safe',    opacity:0.08 },
      { id:'qd_inhabited',     label:'QD inhabited',     radiusM: rQD_inhabited,     colorKey:'qd',      opacity:0.06 },
    ].filter(r => r.radiusM > 0.5)
     .sort((a, b) => b.radiusM - a.radiusM),
  };
}

// ── Colour map ────────────────────────────────────────────────────────────────
export const EFFECTS_COLORS = {
  lethal:  { fill:[220,  60, 48], outline:[220, 60, 48, 0.90] },
  warning: { fill:[239, 159, 39], outline:[239,159, 39, 0.85] },
  thermal: { fill:[220, 120,  0], outline:[220,120,  0, 0.80] },
  safe:    { fill:[ 29, 158,117], outline:[ 29,158,117, 0.70] },
  qd:      { fill:[ 55, 138,221], outline:[ 55,138,221, 0.60] },
};

// ── Geodetic helpers ──────────────────────────────────────────────────────────
export function destinationPoint(lon, lat, bearingDeg, distM) {
  const R=6_371_008.8, δ=distM/R, θ=bearingDeg*Math.PI/180;
  const φ1=lat*Math.PI/180, λ1=lon*Math.PI/180;
  const φ2=Math.asin(Math.sin(φ1)*Math.cos(δ)+Math.cos(φ1)*Math.sin(δ)*Math.cos(θ));
  const λ2=λ1+Math.atan2(Math.sin(θ)*Math.sin(δ)*Math.cos(φ1),Math.cos(δ)-Math.sin(φ1)*Math.sin(φ2));
  return { longitude:(λ2*180)/Math.PI, latitude:(φ2*180)/Math.PI };
}

// ── Factory ───────────────────────────────────────────────────────────────────
export function createEffectsEngine({ Graphic, Point, Polygon, Mesh, geometryEngine }) {

  // Build donut-stacked ring graphics (3D SceneView)
  function buildRingGraphics(impactPoint, result, { asDonut = true, showLabels = true } = {}) {
    const rings   = result.rings;
    const graphics = [];

    const buffered = rings.map(ring => ({
      ...ring,
      geometry: geometryEngine.geodesicBuffer(impactPoint, ring.radiusM, 'meters'),
    }));

    buffered.forEach((ring, i) => {
      if (!ring.geometry) return;
      const c = EFFECTS_COLORS[ring.colorKey] ?? EFFECTS_COLORS.safe;
      const [r,g,b] = c.fill;
      const [or,og,ob,oa] = c.outline;

      const geom = asDonut && buffered[i+1]?.geometry
        ? geometryEngine.difference(ring.geometry, buffered[i+1].geometry)
        : ring.geometry;

      if (!geom) return;

      graphics.push(new Graphic({
        geometry: geom,
        symbol: {
          type: 'polygon-3d',
          symbolLayers: [{
            type: 'fill',
            material: { color: [r, g, b, ring.opacity] },
            outline:  { color: [or, og, ob, oa], size: 1.6 },
            pattern:  { type: 'style', style: i === 0 ? 'none' : 'diagonal-cross' },
          }],
        },
        attributes: {
          type:     `Effects — ${ring.label}`,
          label:    `${ring.label}  ${Math.round(ring.radiusM)} m`,
          radiusM:  Math.round(ring.radiusM),
          colorKey: ring.colorKey,
        },
      }));

      // Radius label at top of each ring
      if (showLabels) {
        const labelPt = destinationPoint(impactPoint.longitude, impactPoint.latitude, 0, ring.radiusM);
        const distStr = ring.radiusM >= 1000
          ? (ring.radiusM/1000).toFixed(2)+' km'
          : Math.round(ring.radiusM)+' m';
        graphics.push(new Graphic({
          geometry: new Point({ longitude: labelPt.longitude, latitude: labelPt.latitude, spatialReference: { wkid:4326 } }),
          symbol: {
            type: 'text',
            color: `rgb(${c.fill.join(',')})`,
            haloColor: [0,0,0,0.75], haloSize: 1.5,
            text: `${ring.label}  ${distStr}`,
            font: { family:'Courier New', size:9.5, weight:'bold' },
            horizontalAlignment:'center', verticalAlignment:'bottom',
          },
          attributes: { type:'effects_label', label: ring.label },
        }));
      }
    });

    return graphics;
  }

  // Build detonation point marker — bright sphere + spike
  function buildImpactMarker(impactPoint, result) {
    const [r,g,b] = result.munition.color;
    return [
      new Graphic({
        geometry: impactPoint,
        symbol: {
          type:'point-3d',
          symbolLayers:[{
            type:'object', resource:{ primitive:'sphere' },
            material:{ color:[r,g,b,0.95] },
            width:80, height:80, depth:80,
          }],
          verticalOffset:{ screenLength:20, maxWorldLength:400, minWorldLength:4 },
        },
        attributes:{ type:'Detonation point', label:`${result.munition.label} — detonation` },
      }),
    ];
  }

  // ── Animated blast wave sphere (custom Mesh) ─────────────────────────────
  // Generates a UV sphere mesh at `radiusM` centred on impactPoint.
  // The caller drives animation by updating the mesh radius each frame.
  function buildBlastSphereMesh(impactPoint, radiusM, color, alpha) {
    const [r,g,b] = color;
    const { longitude, latitude, z = 0 } = impactPoint;

    // UV sphere parameters
    const STACKS  = 20;
    const SLICES  = 36;
    const R       = radiusM;        // metres — approximate (flat-Earth at this scale)
    const degPerM = 1 / 111_320;    // rough degrees per metre

    const positions = [];
    const normals   = [];
    const uvs       = [];
    const indices   = [];

    for (let si = 0; si <= STACKS; si++) {
      const phi = (si / STACKS) * Math.PI;          // 0 → π
      for (let sl = 0; sl <= SLICES; sl++) {
        const theta = (sl / SLICES) * 2 * Math.PI;  // 0 → 2π
        const x =  R * Math.sin(phi) * Math.cos(theta);
        const y =  R * Math.sin(phi) * Math.sin(theta);
        const z_ = R * Math.cos(phi);
        // Convert ENU offset to lon/lat/z (flat-Earth approx — fine for <5km radius)
        const lon = longitude + x * degPerM / Math.cos(latitude * Math.PI/180);
        const lat_ = latitude  + y * degPerM;
        positions.push(lon, lat_, z + z_);
        normals.push(x/R, y/R, z_/R);
        uvs.push(sl/SLICES, si/STACKS);
      }
    }

    for (let si = 0; si < STACKS; si++) {
      for (let sl = 0; sl < SLICES; sl++) {
        const a = si * (SLICES+1) + sl;
        const b = a + SLICES + 1;
        indices.push(a, b, a+1, b, b+1, a+1);
      }
    }

    return new Graphic({
      geometry: new Mesh({
        vertexAttributes: {
          position: new Float64Array(positions),
          normal:   new Float32Array(normals),
          uv:       new Float32Array(uvs),
        },
        components: [{
          faces: new Uint32Array(indices),
          material: {
            color: [r, g, b, Math.round(alpha * 255)],
            doubleSided: true,
          },
        }],
        spatialReference: { wkid: 4326 },
      }),
      attributes: { type:'blast_sphere' },
    });
  }

  // ── Animation controller for blast wave ───────────────────────────────────
  // Expands the sphere from 0 → maxRadiusM over `durationMs` milliseconds,
  // fading out as it expands.
  function createBlastWaveAnimation(impactPoint, maxRadiusM, color, animLayer, durationMs = 2200) {
    let rafId = null, playing = false;
    let sphereGraphic = null;

    return {
      start() {
        if (playing) this.stop();
        playing = true;
        const startMs = performance.now();

        function frame(nowMs) {
          const t = Math.min(1, (nowMs - startMs) / durationMs);
          // Eased expansion: fast start, slow finish
          const easedT = 1 - Math.pow(1 - t, 2.5);
          const radius  = maxRadiusM * easedT;
          const alpha   = 0.35 * (1 - Math.pow(t, 0.8));  // fade out

          // Remove previous sphere graphic
          if (sphereGraphic && animLayer.graphics.includes(sphereGraphic)) {
            animLayer.remove(sphereGraphic);
          }

          if (radius > 0.5 && alpha > 0.005) {
            sphereGraphic = buildBlastSphereMesh(impactPoint, radius, color, alpha);
            animLayer.add(sphereGraphic);
          }

          if (t < 1 && playing) {
            rafId = requestAnimationFrame(frame);
          } else {
            playing = false;
            if (sphereGraphic && animLayer.graphics.includes(sphereGraphic)) {
              animLayer.remove(sphereGraphic);
            }
          }
        }

        rafId = requestAnimationFrame(frame);
      },
      stop() {
        playing = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        if (sphereGraphic && animLayer.graphics.includes(sphereGraphic)) {
          animLayer.remove(sphereGraphic);
          sphereGraphic = null;
        }
      },
      get playing() { return playing; },
    };
  }

  // ── Multi-munition union ──────────────────────────────────────────────────
  // Merges the lethal rings of multiple detonation points into one combined footprint.
  function buildUnionFootprint(impactPoints, results) {
    const lethalGeoms = impactPoints.map((pt, i) => {
      const lethalR = results[i].rings.find(r => r.id === 'lethal_composite')?.radiusM ?? 0;
      return lethalR > 0 ? geometryEngine.geodesicBuffer(pt, lethalR, 'meters') : null;
    }).filter(Boolean);

    if (lethalGeoms.length === 0) return null;
    const merged = lethalGeoms.length === 1 ? lethalGeoms[0] : geometryEngine.union(lethalGeoms);

    return new Graphic({
      geometry: merged,
      symbol: {
        type: 'polygon-3d',
        symbolLayers: [{
          type: 'fill',
          material: { color: [220, 60, 48, 0.25] },
          outline:  { color: [220, 60, 48, 0.90], size: 2.2 },
        }],
      },
      attributes: { type:'Combined lethal footprint', label:'Multi-strike lethal union' },
    });
  }

  return {
    buildRingGraphics,
    buildImpactMarker,
    buildBlastSphereMesh,
    createBlastWaveAnimation,
    buildUnionFootprint,
  };
}
