/**
 * wez-engine.js
 * Weapon Engagement Zone — pure geometry computation engine.
 * No ArcGIS CDN dependency at import time; ArcGIS classes are injected
 * via the factory function so the module stays testable and reusable.
 *
 * Usage:
 *   import { createWEZEngine } from "./wez-engine.js";
 *   const wez = createWEZEngine({ Point, Polygon, geometryEngine });
 *   const result = wez.compute(params);
 */

// ---------------------------------------------------------------------------
// Weapon presets — SIDC function code → WEZ defaults
// Extend this table to cover your full symbol library.
// ---------------------------------------------------------------------------
export const WEAPON_PRESETS = {
  direct_fire: {
    label: "Direct fire",
    minRangeM: 50,
    maxRangeM: 3000,
    azimuthSpreadDeg: 90,
    elevMinDeg: -5,
    elevMaxDeg: 10,
    extrudeHeightFactor: 0.05, // tan(~3°) — flat engagement volume
    color: [220, 90, 48],
  },
  mortar: {
    label: "Mortar",
    minRangeM: 70,
    maxRangeM: 5600,
    azimuthSpreadDeg: 360,
    elevMinDeg: 45,
    elevMaxDeg: 85,
    extrudeHeightFactor: 2.75, // tan(70°) — tall engagement volume
    color: [186, 117, 23],
  },
  artillery: {
    label: "Artillery",
    minRangeM: 3000,
    maxRangeM: 30000,
    azimuthSpreadDeg: 180,
    elevMinDeg: 15,
    elevMaxDeg: 65,
    extrudeHeightFactor: 1.43, // tan(55°)
    color: [186, 117, 23],
  },
  atgm: {
    label: "ATGM",
    minRangeM: 75,
    maxRangeM: 5500,
    azimuthSpreadDeg: 60,
    elevMinDeg: -10,
    elevMaxDeg: 20,
    extrudeHeightFactor: 0.18,
    color: [220, 90, 48],
  },
  anti_air: {
    label: "Anti-air",
    minRangeM: 200,
    maxRangeM: 8000,
    azimuthSpreadDeg: 360,
    elevMinDeg: 15,
    elevMaxDeg: 90,
    extrudeHeightFactor: 9.5, // near-vertical engagement
    color: [55, 138, 221],
  },
};

// ---------------------------------------------------------------------------
// Geodetic utility — bearing + distance → destination point (WGS-84)
// Standard Haversine forward formula.
// ---------------------------------------------------------------------------
export function destinationPoint(originLon, originLat, bearingDeg, distanceM) {
  const R = 6_371_008.8; // mean Earth radius, metres
  const δ = distanceM / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (originLat * Math.PI) / 180;
  const λ1 = (originLon * Math.PI) / 180;

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );

  return {
    longitude: (λ2 * 180) / Math.PI,
    latitude: (φ2 * 180) / Math.PI,
  };
}

// ---------------------------------------------------------------------------
// Factory — inject ArcGIS geometry classes once at app startup.
// ---------------------------------------------------------------------------
export function createWEZEngine({ Point, Polygon, geometryEngine }) {
  // -------------------------------------------------------------------------
  // Build the azimuth wedge as a WGS-84 Polygon.
  // radius is set slightly larger than maxRange so intersect() clips cleanly.
  // -------------------------------------------------------------------------
  function buildAzimuthWedge(origin, azimuthCenterDeg, azimuthSpreadDeg, radiusM) {
    const halfSpread = azimuthSpreadDeg / 2;
    const startBearing = azimuthCenterDeg - halfSpread;
    const endBearing = azimuthCenterDeg + halfSpread;

    // One vertex per degree of sweep (minimum 3 for degenerate spreads)
    const steps = Math.max(3, Math.ceil(Math.abs(azimuthSpreadDeg)));
    const ring = [[origin.longitude, origin.latitude]];

    for (let i = 0; i <= steps; i++) {
      const bearing = startBearing + (i / steps) * azimuthSpreadDeg;
      const pt = destinationPoint(origin.longitude, origin.latitude, bearing, radiusM);
      ring.push([pt.longitude, pt.latitude]);
    }
    ring.push([origin.longitude, origin.latitude]); // close

    return new Polygon({ rings: [ring], spatialReference: { wkid: 4326 } });
  }

  // -------------------------------------------------------------------------
  // Core WEZ polygon computation.
  // Returns { zone, minRing, maxRing, wedge, extrudeHeightM }
  // zone  = the engagement polygon (ready to add to GraphicsLayer)
  // -------------------------------------------------------------------------
  function compute(params) {
    const {
      observerPoint,       // esri/geometry/Point  (WGS-84, z optional)
      minRangeM,
      maxRangeM,
      azimuthCenterDeg,
      azimuthSpreadDeg,
      elevMaxDeg,
      weaponType,          // key into WEAPON_PRESETS for defaults
    } = params;

    const preset = WEAPON_PRESETS[weaponType] ?? WEAPON_PRESETS.direct_fire;

    // Clamp inputs, fall back to preset values when not supplied
    const minR   = minRangeM        ?? preset.minRangeM;
    const maxR   = maxRangeM        ?? preset.maxRangeM;
    const az     = azimuthCenterDeg ?? 0;
    const spread = azimuthSpreadDeg ?? preset.azimuthSpreadDeg;
    const elevMx = elevMaxDeg       ?? preset.elevMaxDeg;

    // 1. Buffered rings (geodesic — accounts for Earth curvature)
    const minRing = geometryEngine.geodesicBuffer(observerPoint, minR, "meters");
    const maxRing = geometryEngine.geodesicBuffer(observerPoint, maxR, "meters");

    // 2. Azimuth wedge — slightly oversized so intersect() has clean edges
    const wedge = buildAzimuthWedge(observerPoint, az, spread, maxR * 1.02);

    // 3. Clip outer ring to the azimuth sector
    const clippedOuter = spread >= 360
      ? maxRing
      : geometryEngine.intersect(maxRing, wedge);

    // 4. Punch out the dead zone (min range)
    const zone = minR > 0
      ? geometryEngine.difference(clippedOuter, minRing)
      : clippedOuter;

    // 5. Extrusion height from max elevation angle
    //    This defines the top of the weapon's engagement envelope in 3D.
    const extrudeHeightM = Math.min(
      maxR * Math.tan((elevMx * Math.PI) / 180),
      50_000 // cap at 50 km for display sanity
    );

    return { zone, minRing, maxRing, wedge, extrudeHeightM, preset };
  }

  // -------------------------------------------------------------------------
  // Terrain masking — samples the SceneView's elevation surface along radial
  // lines and returns sectors where terrain obstructs the line of sight.
  // Resolves to an array of { startBearingDeg, endBearingDeg } objects.
  //
  // Requires a live SceneView (for createElevationSampler) and an observer
  // Point with a valid z (terrain elevation + observer height).
  // -------------------------------------------------------------------------
  async function computeTerrainMask(view, observerPoint, maxRangeM, {
    numRays       = 72,    // rays per full circle (5° resolution)
    stepDistanceM = 50,    // elevation sample interval along each ray
    observerHeightM = 2,   // eye height above terrain
  } = {}) {
    // Fetch terrain elevations for the entire WEZ extent in one call
    const extentGeom = geometryEngine.geodesicBuffer(observerPoint, maxRangeM, "meters");
    const sampler = await view.createElevationSampler(extentGeom.extent, {
      noDataValue: 0,
    });

    // Get observer ground elevation from sampler
    const obsGroundZ = sampler.queryElevation(observerPoint)?.z ?? 0;
    const obsZ = obsGroundZ + observerHeightM;

    const maskedBearings = new Set();
    const numSteps = Math.ceil(maxRangeM / stepDistanceM);

    for (let rayIdx = 0; rayIdx < numRays; rayIdx++) {
      const bearing = (rayIdx / numRays) * 360;
      let maxSlopeAngleRad = -Infinity; // horizon angle seen so far along this ray

      for (let step = 1; step <= numSteps; step++) {
        const dist = step * stepDistanceM;
        const { longitude, latitude } = destinationPoint(
          observerPoint.longitude,
          observerPoint.latitude,
          bearing,
          dist
        );
        const samplePt = new Point({ longitude, latitude, spatialReference: { wkid: 4326 } });
        const terrainZ = sampler.queryElevation(samplePt)?.z ?? 0;

        // Slope angle from observer to this terrain point
        const slopeAngleRad = Math.atan2(terrainZ - obsZ, dist);

        if (slopeAngleRad >= maxSlopeAngleRad) {
          // Terrain is rising — update the horizon
          maxSlopeAngleRad = slopeAngleRad;
        } else if (maxSlopeAngleRad > 0.017) {
          // A prior terrain feature (>1°) is blocking this ray — masked
          maskedBearings.add(rayIdx);
          break;
        }
      }
    }

    // Convert masked ray indices → bearing ranges
    return bearingIndicesToRanges([...maskedBearings], numRays);
  }

  function bearingIndicesToRanges(maskedIndices, numRays) {
    if (maskedIndices.length === 0) return [];
    const degPerRay = 360 / numRays;
    const sorted = [...maskedIndices].sort((a, b) => a - b);
    const ranges = [];
    let runStart = sorted[0];
    let runEnd = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === runEnd + 1) {
        runEnd = sorted[i];
      } else {
        ranges.push({
          startBearingDeg: runStart * degPerRay,
          endBearingDeg: (runEnd + 1) * degPerRay,
        });
        runStart = runEnd = sorted[i];
      }
    }
    ranges.push({
      startBearingDeg: runStart * degPerRay,
      endBearingDeg: (runEnd + 1) * degPerRay,
    });
    return ranges;
  }

  // -------------------------------------------------------------------------
  // Build masked-sector polygons from bearing ranges.
  // These render as gray dead zones overlaid on the WEZ.
  // -------------------------------------------------------------------------
  function buildMaskedSectorPolygons(origin, maxRangeM, bearingRanges) {
    return bearingRanges.map(({ startBearingDeg, endBearingDeg }) => {
      const spread = endBearingDeg - startBearingDeg;
      const center = startBearingDeg + spread / 2;
      return buildAzimuthWedge(origin, center, spread, maxRangeM);
    });
  }

  return { compute, computeTerrainMask, buildMaskedSectorPolygons, buildAzimuthWedge };
}
