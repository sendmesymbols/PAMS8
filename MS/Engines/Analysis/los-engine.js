/**
 * los-engine.js
 * Line-of-sight computation engine.
 * Pure functions — no ArcGIS dependency at import time.
 * Inject Point / Polyline via createLOSEngine({ Point, Polyline }).
 */

// ── Geodetic math ──────────────────────────────────────────────────────────
// Haversine forward: bearing + distance → destination (WGS-84)
export function destinationPoint(lon, lat, bearingDeg, distM) {
  const R = 6_371_008.8;
  const δ = distM / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat  * Math.PI) / 180;
  const λ1 = (lon  * Math.PI) / 180;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
  );
  return { longitude: (λ2 * 180) / Math.PI, latitude: (φ2 * 180) / Math.PI };
}

// Bearing (degrees, 0 = north) between two lon/lat points
export function bearingBetween(lon1, lat1, lon2, lat2) {
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ── Dome target generation ──────────────────────────────────────────────────
// Returns an array of { lon, lat, z, azDeg, elDeg } objects.
// These become LineOfSightTargets or are passed to ElevationSampler.
//
// Spherical coordinates: observer is the origin.
// Ground range = rangeM × cos(elDeg), height offset = rangeM × sin(elDeg).
//
export function generateDomeTargets(observer, {
  maxRangeM    = 3000,
  azStartDeg   = 0,
  azEndDeg     = 360,
  azStepDeg    = 5,
  elevMinDeg   = -5,
  elevMaxDeg   = 45,
  elevStepDeg  = 5,
} = {}) {
  const targets = [];
  const obsZ = observer.z ?? observer.latitude ?? 0; // fallback

  for (let az = azStartDeg; az < azEndDeg; az += azStepDeg) {
    for (let el = elevMinDeg; el <= elevMaxDeg; el += elevStepDeg) {
      const elRad = (el * Math.PI) / 180;
      const groundRange = maxRangeM * Math.cos(elRad);
      const heightOffset = maxRangeM * Math.sin(elRad);
      const dest = destinationPoint(observer.longitude, observer.latitude, az, groundRange);
      targets.push({
        lon: dest.longitude,
        lat: dest.latitude,
        z: (observer.z ?? 0) + heightOffset,
        azDeg: az,
        elDeg: el,
      });
    }
  }
  return targets;
}

// ── Terrain-based LOS (ElevationSampler) ──────────────────────────────────
// Cast a single ray from observer to a target, sampling terrain elevation.
// Returns { visible: bool, obstructionDistM: number|null, horizon: number|null }
// NOTE: terrain-only — does not account for buildings or 3D mesh objects.
// For full scene LOS use LineOfSightAnalysis targets instead.
//
export function castTerrainRay(sampler, observer, target, {
  stepDistM      = 20,      // elevation sample interval along ray
  observerHeightM = 2,      // eye height above terrain
} = {}) {
  // Equirectangular approximation: longitude degrees shrink by cos(lat), so the
  // east-west delta MUST be scaled or distance is overstated (≈1.4x at 45°, 2x at
  // 60°), which biases every intervisibility result toward "visible".
  const cosLat = Math.cos((observer.latitude * Math.PI) / 180);
  const dLon = (target.lon - observer.longitude) * cosLat;
  const dLat = target.lat - observer.latitude;
  const groundDist = Math.sqrt(dLon ** 2 + dLat ** 2) * 111_320; // deg → m

  const obsGroundZ = sampler.queryElevation(observer)?.z ?? 0;
  const obsZ = obsGroundZ + observerHeightM;
  const bearing = bearingBetween(observer.longitude, observer.latitude, target.lon, target.lat);
  const numSteps = Math.max(2, Math.ceil(groundDist / stepDistM));

  let maxSlopeRad = -Infinity;
  let obstructionDistM = null;

  for (let s = 1; s <= numSteps; s++) {
    const frac = s / numSteps;
    const dist = frac * groundDist;
    const pt = destinationPoint(observer.longitude, observer.latitude, bearing, dist);
    const terrZ = sampler.queryElevation({ longitude: pt.longitude, latitude: pt.latitude })?.z ?? 0;
    const slopeRad = Math.atan2(terrZ - obsZ, dist);

    if (slopeRad >= maxSlopeRad) {
      maxSlopeRad = slopeRad;
    } else if (maxSlopeRad > 0.017) { // > 1° horizon = obstructed
      obstructionDistM = dist;
      return { visible: false, obstructionDistM, horizon: maxSlopeRad };
    }
  }

  // Check if target elevation is below the line of sight
  const targetSlopeRad = Math.atan2((target.z ?? 0) - obsZ, groundDist);
  if (maxSlopeRad > targetSlopeRad + 0.01) {
    return { visible: false, obstructionDistM: groundDist * 0.9, horizon: maxSlopeRad };
  }

  return { visible: true, obstructionDistM: null, horizon: maxSlopeRad };
}

// ── Result aggregation ──────────────────────────────────────────────────────
export function summariseDomeResults(targets, results) {
  let visible = 0, obstructed = 0;
  const byAzimuth = {};

  targets.forEach((t, i) => {
    const r = results[i];
    if (!r) return;
    if (r.visible) visible++;
    else obstructed++;

    const az = Math.round(t.azDeg);
    if (!byAzimuth[az]) byAzimuth[az] = { rays: 0, visible: 0 };
    byAzimuth[az].rays++;
    if (r.visible) byAzimuth[az].visible++;
  });

  const total = visible + obstructed;
  return {
    total, visible, obstructed,
    pct: total > 0 ? Math.round((visible / total) * 100) : 0,
    byAzimuth,
  };
}

// ── Factory ─────────────────────────────────────────────────────────────────
// Inject ArcGIS geometry classes. Returns helpers that build ArcGIS objects.
export function createLOSEngine({ Point, Polyline }) {

  function makePoint(lon, lat, z) {
    return new Point({ longitude: lon, latitude: lat, z, spatialReference: { wkid: 4326 } });
  }

  // Build a 3D polyline from observer to target (or obstruction)
  function makeRayLine(fromPt, toPt) {
    return new Polyline({
      paths: [[[fromPt.longitude, fromPt.latitude, fromPt.z ?? 0],
               [toPt.longitude,  toPt.latitude,  toPt.z ?? 0]]],
      spatialReference: { wkid: 4326 },
      hasZ: true,
    });
  }

  return { makePoint, makeRayLine };
}
