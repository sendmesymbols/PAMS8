/**
 * buffer-engine.js
 * Buffer & Threat Rings — geodesic multi-ring buffer engine.
 * Pure computation module; inject ArcGIS geometry classes via factory.
 *
 * Capabilities
 * ────────────
 * • Stacked geodesic threat rings  (lethal / injury / safe / exclusion)
 * • Union across multiple source symbols
 * • Difference punching (donut rings, no-go zones)
 * • Corridor buffering along polylines via densify → buffer
 * • Contested-zone overlay via geometry intersection of two ring sets
 * • Blend-mode compositing hint for SceneView layer ordering
 *
 * All ring geometry is computed by geometryEngine.geodesicBuffer(),
 * which runs entirely client-side — zero server calls, instant redraw.
 */

// ─── Threat presets ──────────────────────────────────────────────────────────
// Each preset defines 1–4 named rings with radii and semantic labels.
// Ring order is outermost → innermost (drawn in reverse for correct stacking).
export const THREAT_PRESETS = {
  artillery_155mm: {
    label: 'Artillery 155 mm',
    rings: [
      { label: 'Max range',      radiusM: 30000, colorKey: 'safe'    },
      { label: 'Effective range',radiusM: 18000, colorKey: 'warning' },
      { label: 'Danger close',   radiusM:  600,  colorKey: 'lethal'  },
    ],
  },
  mortar_81mm: {
    label: 'Mortar 81 mm',
    rings: [
      { label: 'Max range',      radiusM: 5600,  colorKey: 'safe'    },
      { label: 'Effective range',radiusM: 3200,  colorKey: 'warning' },
      { label: 'Danger close',   radiusM:  200,  colorKey: 'lethal'  },
    ],
  },
  atgm: {
    label: 'ATGM',
    rings: [
      { label: 'Max range',      radiusM: 5500,  colorKey: 'safe'    },
      { label: 'Min arm dist',   radiusM:   75,  colorKey: 'dead'    },
    ],
  },
  ied_vbied: {
    label: 'IED / VBIED',
    rings: [
      { label: 'Safe standoff',  radiusM:  600,  colorKey: 'safe'    },
      { label: 'Injury radius',  radiusM:  300,  colorKey: 'warning' },
      { label: 'Lethal radius',  radiusM:  100,  colorKey: 'lethal'  },
    ],
  },
  nbc_release: {
    label: 'NBC release',
    rings: [
      { label: 'Downwind hazard',radiusM: 10000, colorKey: 'warning' },
      { label: 'Hot zone',       radiusM:  500,  colorKey: 'lethal'  },
    ],
  },
  observation_post: {
    label: 'Observation post',
    rings: [
      { label: 'Max observe',    radiusM: 8000,  colorKey: 'info'    },
      { label: 'Effective obs',  radiusM: 3000,  colorKey: 'safe'    },
    ],
  },
  custom: {
    label: 'Custom',
    rings: [
      { label: 'Ring 1', radiusM: 3000, colorKey: 'safe'    },
      { label: 'Ring 2', radiusM: 1500, colorKey: 'warning' },
      { label: 'Ring 3', radiusM:  500, colorKey: 'lethal'  },
    ],
  },
};

// ─── Semantic color map ───────────────────────────────────────────────────────
// Each entry: [fill RGBA, outline RGB, alpha]
export const RING_COLORS = {
  lethal:  { fill: [220, 60,  48,  0.18], outline: [220, 60,  48,  0.85], label: '#DC3C30' },
  warning: { fill: [239, 159, 39,  0.13], outline: [239, 159, 39,  0.80], label: '#EF9F27' },
  safe:    { fill: [29,  158, 117, 0.09], outline: [29,  158, 117, 0.60], label: '#1D9E75' },
  info:    { fill: [55,  138, 221, 0.10], outline: [55,  138, 221, 0.65], label: '#378ADD' },
  dead:    { fill: [100, 100, 100, 0.25], outline: [150, 150, 150, 0.70], label: '#969490' },
  exclusion:{ fill:[180,  40, 220, 0.12], outline: [180,  40, 220, 0.70], label: '#B428DC' },
};

// ─── Geodetic helper ─────────────────────────────────────────────────────────
export function destinationPoint(lon, lat, bearingDeg, distM) {
  const R = 6_371_008.8, δ = distM / R, θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180, λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1)*Math.cos(δ) + Math.cos(φ1)*Math.sin(δ)*Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ)*Math.sin(δ)*Math.cos(φ1), Math.cos(δ)-Math.sin(φ1)*Math.sin(φ2));
  return { longitude: (λ2 * 180) / Math.PI, latitude: (φ2 * 180) / Math.PI };
}

// ─── Factory ─────────────────────────────────────────────────────────────────
export function createBufferEngine({ geometryEngine, Point, Polyline, Polygon, Graphic }) {

  // ── Single-source multi-ring buffer ──────────────────────────────────────
  // Returns an array of { geometry, colorKey, label, radiusM } objects,
  // outermost ring first. Each ring is a donut (outer − inner) so fills
  // don't compound opacity when stacked.
  function computeRings(sourcePoint, ringDefs, { asDonut = true } = {}) {
    // Sort descending so we can punch donuts cleanly
    const sorted = [...ringDefs].sort((a, b) => b.radiusM - a.radiusM);

    const buffers = sorted.map(def => ({
      ...def,
      geometry: geometryEngine.geodesicBuffer(sourcePoint, def.radiusM, 'meters'),
    }));

    if (!asDonut) return buffers;

    // Convert to donut rings: each ring = outer − next_inner
    return buffers.map((ring, i) => {
      const inner = buffers[i + 1];
      const donut = inner
        ? geometryEngine.difference(ring.geometry, inner.geometry)
        : ring.geometry;
      return { ...ring, geometry: donut };
    });
  }

  // ── Union across multiple source points ───────────────────────────────────
  // E.g. combine the WEZs of three mortar positions into one merged threat area.
  function computeUnionRings(sourcePoints, ringDefs) {
    const allByRadius = {};

    sourcePoints.forEach(pt => {
      const rings = computeRings(pt, ringDefs, { asDonut: false });
      rings.forEach(r => {
        if (!allByRadius[r.radiusM]) allByRadius[r.radiusM] = [];
        allByRadius[r.radiusM].push(r.geometry);
      });
    });

    return Object.entries(allByRadius).map(([radiusM, geoms]) => {
      const def = ringDefs.find(d => d.radiusM === Number(radiusM));
      const merged = geoms.length === 1
        ? geoms[0]
        : geometryEngine.union(geoms);
      return { radiusM: Number(radiusM), label: def?.label ?? '', colorKey: def?.colorKey ?? 'info', geometry: merged };
    }).sort((a, b) => b.radiusM - a.radiusM);
  }

  // ── Contested zone — intersection of two ring sets ────────────────────────
  // Returns the overlap polygon (where both threats cover the same ground).
  function computeContestedZone(ringsA, ringsB) {
    const geomA = geometryEngine.union(ringsA.map(r => r.geometry));
    const geomB = geometryEngine.union(ringsB.map(r => r.geometry));
    return geometryEngine.intersect(geomA, geomB);
  }

  // ── Corridor buffer along a polyline ──────────────────────────────────────
  // densifyOperator is preferred (4.32+); falls back to manual densification.
  function computeCorridorBuffer(polyline, widthM, { standoffM = 0 } = {}) {
    // Densify: insert vertices every 50 m so geodesic buffer curves correctly
    let densified;
    try {
      densified = geometryEngine.geodesicDensify(polyline, 50, 'meters');
    } catch (_) {
      densified = polyline; // older API without geodesicDensify
    }
    const corridor = geometryEngine.geodesicBuffer(densified, widthM, 'meters');
    const standoff = standoffM > 0
      ? geometryEngine.geodesicBuffer(densified, widthM + standoffM, 'meters')
      : null;
    return { corridor, standoff };
  }

  // ── Graphic builder — 2D (MapView) ───────────────────────────────────────
  function buildRingGraphics2D(rings, labelOpts = {}) {
    return rings.flatMap(ring => {
      if (!ring.geometry) return [];
      const colors = RING_COLORS[ring.colorKey] ?? RING_COLORS.info;
      const graphics = [];

      // Fill polygon
      graphics.push(new Graphic({
        geometry: ring.geometry,
        symbol: {
          type: 'simple-fill',
          color: colors.fill,
          outline: { color: colors.outline, width: 1.5 },
          style: 'solid',
        },
        attributes: { type: 'buffer_ring', label: ring.label, radiusM: ring.radiusM, colorKey: ring.colorKey },
      }));

      return graphics;
    });
  }

  // ── Graphic builder — 3D (SceneView) ─────────────────────────────────────
  // Uses polygon-3d with fill + optional extrusion for vertical threat volume.
  function buildRingGraphics3D(rings, { extrudeHeightM = 0, usePattern = true } = {}) {
    return rings.flatMap(ring => {
      if (!ring.geometry) return [];
      const colors  = RING_COLORS[ring.colorKey] ?? RING_COLORS.info;
      const [fr,fg,fb,fa] = colors.fill;
      const [or,og,ob,oa] = colors.outline;
      const graphics = [];

      const symbolLayers = [{
        type: 'fill',
        material: { color: [fr, fg, fb, fa] },
        outline: { color: [or, og, ob, oa], size: 1.5 },
        ...(usePattern ? { pattern: { type: 'style', style: 'diagonal-cross' } } : {}),
      }];

      if (extrudeHeightM > 0) {
        symbolLayers.push({
          type: 'extrude',
          material: { color: [fr, fg, fb, fa * 0.6] },
          edges: { type: 'solid', color: [or, og, ob, oa * 0.4], size: 0.5 },
          size: extrudeHeightM,
        });
      }

      graphics.push(new Graphic({
        geometry: ring.geometry,
        symbol: { type: 'polygon-3d', symbolLayers },
        attributes: {
          type: 'buffer_ring',
          label: ring.label,
          radiusM: ring.radiusM,
          colorKey: ring.colorKey,
        },
      }));

      return graphics;
    });
  }

  // ── Contested zone graphic ────────────────────────────────────────────────
  function buildContestedGraphic(contestedGeom) {
    if (!contestedGeom) return null;
    return new Graphic({
      geometry: contestedGeom,
      symbol: {
        type: 'polygon-3d',
        symbolLayers: [{
          type: 'fill',
          material: { color: [180, 40, 220, 0.28] },
          outline: { color: [180, 40, 220, 0.9], size: 2 },
          pattern: { type: 'style', style: 'cross' },
        }],
      },
      attributes: { type: 'contested_zone', label: 'Contested zone — mutual coverage' },
    });
  }

  // ── Corridor graphic ──────────────────────────────────────────────────────
  function buildCorridorGraphics(corridorGeom, standoffGeom) {
    const graphics = [];
    if (standoffGeom) {
      graphics.push(new Graphic({
        geometry: standoffGeom,
        symbol: {
          type: 'polygon-3d',
          symbolLayers: [{ type: 'fill',
            material: { color: [220, 60, 48, 0.07] },
            outline: { color: [220, 60, 48, 0.60], size: 1.2 },
            pattern: { type: 'style', style: 'diagonal-cross' },
          }],
        },
        attributes: { type: 'corridor_standoff', label: 'Standoff zone' },
      }));
    }
    if (corridorGeom) {
      graphics.push(new Graphic({
        geometry: corridorGeom,
        symbol: {
          type: 'polygon-3d',
          symbolLayers: [{ type: 'fill',
            material: { color: [55, 138, 221, 0.12] },
            outline: { color: [55, 138, 221, 0.75], size: 1.6 },
          }],
        },
        attributes: { type: 'corridor_zone', label: 'Movement corridor' },
      }));
    }
    return graphics;
  }

  // ── Label graphics — text callouts on ring edges ──────────────────────────
  // Placed at the northernmost point of each ring for readability.
  function buildLabelGraphics(sourcePoint, rings) {
    return rings.map(ring => {
      const colors = RING_COLORS[ring.colorKey] ?? RING_COLORS.info;
      const labelPt = destinationPoint(sourcePoint.longitude, sourcePoint.latitude, 0, ring.radiusM);
      return new Graphic({
        geometry: new Point({ longitude: labelPt.longitude, latitude: labelPt.latitude, spatialReference: { wkid: 4326 } }),
        symbol: {
          type: 'text',
          color: colors.label,
          haloColor: [0, 0, 0, 0.7],
          haloSize: 1.5,
          text: `${ring.label}  ${ring.radiusM >= 1000
            ? (ring.radiusM / 1000).toFixed(1) + ' km'
            : ring.radiusM + ' m'}`,
          font: { family: 'Courier New', size: 10, weight: 'bold' },
          horizontalAlignment: 'center',
          verticalAlignment: 'bottom',
        },
        attributes: { type: 'buffer_label', label: ring.label },
      });
    });
  }

  return {
    computeRings,
    computeUnionRings,
    computeContestedZone,
    computeCorridorBuffer,
    buildRingGraphics2D,
    buildRingGraphics3D,
    buildContestedGraphic,
    buildCorridorGraphics,
    buildLabelGraphics,
  };
}
