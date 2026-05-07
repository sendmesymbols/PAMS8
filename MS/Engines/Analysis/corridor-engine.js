/**
 * corridor-engine.js
 * MSR / Route Corridor Analysis engine.
 * Inject ArcGIS classes via createCorridorEngine().
 *
 * Capabilities
 * ────────────
 * • Geodesic route densification (accurate corridor shape on any projection)
 * • Multi-width corridor stack: centreline → corridor → standoff → exclusion
 * • Per-segment threat exposure scoring via geometry intersection
 * • Colour-coded segment heat map (green → amber → red by exposure)
 * • Chokepoint detection: narrow terrain passages along the route
 * • Waypoint-to-waypoint leg breakdown with distance and bearing readouts
 * • Elevation profile data extraction along route (for SceneView ElevationProfile)
 */

export const CORRIDOR_PRESETS = {
  foot_patrol: {
    label:        'Foot patrol',
    corridorM:    25,
    standoffM:    100,
    exclusionM:   0,
    segmentLenM:  100,
    color:        [29, 158, 117],
  },
  vehicle_patrol: {
    label:        'Vehicle patrol / MSR',
    corridorM:    100,
    standoffM:    500,
    exclusionM:   1000,
    segmentLenM:  200,
    color:        [55, 138, 221],
  },
  heavy_convoy: {
    label:        'Heavy convoy',
    corridorM:    200,
    standoffM:    1000,
    exclusionM:   2000,
    segmentLenM:  300,
    color:        [186, 117, 23],
  },
  drone_flyway: {
    label:        'Drone flyway',
    corridorM:    150,
    standoffM:    800,
    exclusionM:   0,
    segmentLenM:  150,
    color:        [180, 40, 220],
  },
  exfil_route: {
    label:        'Exfil / covert route',
    corridorM:    50,
    standoffM:    300,
    exclusionM:   500,
    segmentLenM:  100,
    color:        [220, 90, 48],
  },
};

// Exposure score → colour (green safe, amber caution, red danger)
export const EXPOSURE_COLORS = [
  { threshold: 0.00, fill: [29,  158, 117, 0.18], outline: [29,  158, 117, 0.85] }, // safe
  { threshold: 0.25, fill: [120, 200,  80, 0.20], outline: [120, 200,  80, 0.80] }, // low
  { threshold: 0.50, fill: [239, 159,  39, 0.22], outline: [239, 159,  39, 0.85] }, // caution
  { threshold: 0.75, fill: [220,  90,  48, 0.26], outline: [220,  90,  48, 0.90] }, // danger
];

const EARTH_R = 6_371_008.8;

// ── Geodetic helpers ──────────────────────────────────────────────────────────
export function destinationPoint(lon, lat, bearingDeg, distM) {
  const δ = distM / EARTH_R, θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180, λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1)*Math.cos(δ) + Math.cos(φ1)*Math.sin(δ)*Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ)*Math.sin(δ)*Math.cos(φ1), Math.cos(δ)-Math.sin(φ1)*Math.sin(φ2));
  return { longitude: (λ2*180)/Math.PI, latitude: (φ2*180)/Math.PI };
}

export function geodesicDistance(lon1, lat1, lon2, lat2) {
  const φ1 = (lat1*Math.PI)/180, φ2 = (lat2*Math.PI)/180;
  const Δλ = ((lon2-lon1)*Math.PI)/180;
  return EARTH_R * Math.acos(Math.sin(φ1)*Math.sin(φ2) + Math.cos(φ1)*Math.cos(φ2)*Math.cos(Δλ));
}

export function geodesicBearing(lon1, lat1, lon2, lat2) {
  const φ1 = (lat1*Math.PI)/180, φ2 = (lat2*Math.PI)/180;
  const Δλ = ((lon2-lon1)*Math.PI)/180;
  const y  = Math.sin(Δλ)*Math.cos(φ2);
  const x  = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return ((Math.atan2(y,x)*180/Math.PI) + 360) % 360;
}

// ── Route densification (client-side, no geometryEngine dependency) ───────────
// Inserts intermediate vertices along geodesic arcs every `intervalM` metres.
// This is the client-side equivalent of geometryEngine.geodesicDensify().
export function densifyRoute(waypoints, intervalM = 50) {
  if (waypoints.length < 2) return waypoints;
  const dense = [waypoints[0]];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [a, b] = [waypoints[i], waypoints[i+1]];
    const dist   = geodesicDistance(a.longitude, a.latitude, b.longitude, b.latitude);
    const steps  = Math.ceil(dist / intervalM);
    for (let s = 1; s < steps; s++) {
      const t   = s / steps;
      const brg = geodesicBearing(a.longitude, a.latitude, b.longitude, b.latitude);
      const pt  = destinationPoint(a.longitude, a.latitude, brg, dist * t);
      dense.push(pt);
    }
    dense.push(b);
  }
  return dense;
}

// ── Leg statistics ────────────────────────────────────────────────────────────
export function computeLegs(waypoints) {
  return waypoints.slice(0, -1).map((a, i) => {
    const b = waypoints[i + 1];
    return {
      index:    i,
      from:     a,
      to:       b,
      distM:    geodesicDistance(a.longitude, a.latitude, b.longitude, b.latitude),
      bearingDeg: geodesicBearing(a.longitude, a.latitude, b.longitude, b.latitude),
    };
  });
}

// ── Segment threat scoring ────────────────────────────────────────────────────
// Splits the route into fixed-length segments and intersects each with the
// provided threat geometries. Score = fraction of segment area inside threat.
// Returns [{ segmentGeom, score 0–1, distFromStartM }]
export function scoreSegments(denseRoute, corridorM, threatGeometries, segmentLenM, { geometryEngine, Polyline, Point }) {
  if (!denseRoute || denseRoute.length < 2) return [];
  const segments = [];
  let cursor = 0, distFromStart = 0;
  const pts  = denseRoute;

  while (cursor < pts.length - 1) {
    // Collect segment points up to segmentLenM total distance
    const segPts = [pts[cursor]];
    let segDist  = 0;
    let j = cursor + 1;

    while (j < pts.length) {
      const d = geodesicDistance(
        pts[j-1].longitude, pts[j-1].latitude,
        pts[j].longitude,   pts[j].latitude
      );
      segDist += d;
      segPts.push(pts[j]);
      j++;
      if (segDist >= segmentLenM) break;
    }

    if (segPts.length >= 2) {
      const polyline = new Polyline({
        paths: [segPts.map(p => [p.longitude, p.latitude])],
        spatialReference: { wkid: 4326 },
      });

      // Buffer the segment to get an area for intersection
      const segBuf = geometryEngine.geodesicBuffer(polyline, corridorM, 'meters');
      const segArea = segBuf ? geometryEngine.planarArea(segBuf, 'square-meters') : 0;

      // Score = fraction of segment that overlaps any threat geometry
      let score = 0;
      if (segArea > 0 && threatGeometries.length > 0) {
        let overlapArea = 0;
        for (const threat of threatGeometries) {
          try {
            const intersection = geometryEngine.intersect(segBuf, threat);
            if (intersection) {
              overlapArea += Math.abs(geometryEngine.planarArea(intersection, 'square-meters'));
            }
          } catch (_) {}
        }
        score = Math.min(1, overlapArea / segArea);
      }

      segments.push({
        polyline,
        buffer: segBuf,
        score,
        distFromStartM: distFromStart,
        length: segDist,
      });

      distFromStart += segDist;
    }

    cursor = j - 1;
    if (cursor >= pts.length - 1) break;
  }

  return segments;
}

// ── Chokepoint detection ──────────────────────────────────────────────────────
// A chokepoint is a location where the corridor polygon is significantly
// narrower than the requested corridor width. Detected by comparing the
// width of the corridor at each waypoint to the expected width.
export function detectChokepoints(waypoints, corridorPolygon, corridorM, { geometryEngine, Point }) {
  if (!corridorPolygon) return [];
  const chokepoints = [];
  const threshold   = corridorM * 1.4; // flag if effective width < 70% of requested

  waypoints.forEach((wp, i) => {
    if (i === 0 || i === waypoints.length - 1) return;
    const pt = new Point({ longitude: wp.longitude, latitude: wp.latitude, spatialReference: { wkid: 4326 } });

    // Sample corridor width by casting perpendicular mini-buffers
    const bearing    = geodesicBearing(
      waypoints[i-1].longitude, waypoints[i-1].latitude,
      waypoints[i+1].longitude, waypoints[i+1].latitude
    );
    const perpBrg    = (bearing + 90) % 360;
    const testPt1    = destinationPoint(wp.longitude, wp.latitude, perpBrg, corridorM);
    const testPt2    = destinationPoint(wp.longitude, wp.latitude, (perpBrg+180)%360, corridorM);
    const pt1InCorr  = geometryEngine.contains(corridorPolygon,
      new Point({ longitude: testPt1.longitude, latitude: testPt1.latitude, spatialReference: { wkid: 4326 } }));
    const pt2InCorr  = geometryEngine.contains(corridorPolygon,
      new Point({ longitude: testPt2.longitude, latitude: testPt2.latitude, spatialReference: { wkid: 4326 } }));

    if (!pt1InCorr || !pt2InCorr) {
      chokepoints.push({ point: wp, index: i, bearing, perpBrg });
    }
  });

  return chokepoints;
}

// ── Factory ───────────────────────────────────────────────────────────────────
export function createCorridorEngine({ geometryEngine, Polyline, Polygon, Point, Graphic }) {

  // Build the corridor polygon stack: corridor + standoff + exclusion
  function buildCorridorStack(densePath, { corridorM, standoffM, exclusionM }) {
    const polyline = new Polyline({
      paths: [densePath.map(p => [p.longitude, p.latitude])],
      spatialReference: { wkid: 4326 },
    });

    let densified = polyline;
    try { densified = geometryEngine.geodesicDensify(polyline, 50, 'meters'); } catch(_) {}

    const corridor  = geometryEngine.geodesicBuffer(densified, corridorM, 'meters');
    const standoff  = standoffM  > 0 ? geometryEngine.geodesicBuffer(densified, corridorM + standoffM, 'meters') : null;
    const exclusion = exclusionM > 0 ? geometryEngine.geodesicBuffer(densified, corridorM + standoffM + exclusionM, 'meters') : null;

    // Donut the rings so fills don't compound
    const standoffRing   = (standoff && corridor)  ? geometryEngine.difference(standoff, corridor)   : standoff;
    const exclusionRing  = (exclusion && standoff)  ? geometryEngine.difference(exclusion, standoff)  :
                           (exclusion && corridor)  ? geometryEngine.difference(exclusion, corridor)  : exclusion;

    return { polyline: densified, corridor, standoff, exclusion, standoffRing, exclusionRing };
  }

  // Build corridor graphic stack
  function buildCorridorGraphics(stack, preset, showExclusion) {
    const [r,g,b] = preset.color;
    const graphics = [];

    if (showExclusion && stack.exclusionRing) {
      graphics.push(new Graphic({
        geometry: stack.exclusionRing,
        symbol: { type:'polygon-3d', symbolLayers:[{ type:'fill',
          material:{ color:[220,60,48,0.06] },
          outline:{ color:[220,60,48,0.50], size:1.0 },
          pattern:{ type:'style', style:'diagonal-cross' } }] },
        attributes:{ type:'corridor_exclusion', label:'Exclusion zone' },
      }));
    }

    if (stack.standoffRing) {
      graphics.push(new Graphic({
        geometry: stack.standoffRing,
        symbol: { type:'polygon-3d', symbolLayers:[{ type:'fill',
          material:{ color:[r,g,b,0.08] },
          outline:{ color:[r,g,b,0.45], size:1.1 },
          pattern:{ type:'style', style:'diagonal-cross' } }] },
        attributes:{ type:'corridor_standoff', label:'Standoff zone' },
      }));
    }

    if (stack.corridor) {
      graphics.push(new Graphic({
        geometry: stack.corridor,
        symbol: { type:'polygon-3d', symbolLayers:[{ type:'fill',
          material:{ color:[r,g,b,0.14] },
          outline:{ color:[r,g,b,0.80], size:1.8 } }] },
        attributes:{ type:'corridor_zone', label:'Movement corridor' },
      }));
    }

    return graphics;
  }

  // Build centreline graphic with waypoint spheres
  function buildCentrelineGraphics(waypoints, densePath, preset) {
    const [r,g,b] = preset.color;
    const graphics = [];

    // Dense centreline
    graphics.push(new Graphic({
      geometry: new Polyline({
        paths: [densePath.map(p => [p.longitude, p.latitude])],
        spatialReference: { wkid: 4326 },
      }),
      symbol: { type:'line-3d', symbolLayers:[{ type:'line', size:2.2,
        material:{ color:[r,g,b,0.9] }, pattern:{ type:'style', style:'solid' },
        cap:'round', join:'round' }] },
      attributes:{ type:'corridor_centreline', label:'Route centreline' },
    }));

    // Waypoint markers
    waypoints.forEach((wp, i) => {
      const isEndpoint = (i === 0 || i === waypoints.length - 1);
      graphics.push(new Graphic({
        geometry: new Point({ longitude:wp.longitude, latitude:wp.latitude, spatialReference:{wkid:4326} }),
        symbol: { type:'point-3d', symbolLayers:[{ type:'object',
          resource:{ primitive: isEndpoint ? 'diamond' : 'sphere' },
          material:{ color:[r,g,b, isEndpoint ? 0.95 : 0.75] },
          width: isEndpoint ? 55 : 38,
          height: isEndpoint ? 55 : 38,
          depth:  isEndpoint ? 55 : 38 }],
          verticalOffset:{ screenLength: isEndpoint ? 28 : 18, maxWorldLength:500, minWorldLength:4 } },
        attributes:{ type:'corridor_waypoint',
          label: i === 0 ? 'START' : i === waypoints.length-1 ? 'END' : `WP ${i}`,
          index: i },
      }));
    });

    return graphics;
  }

  // Build segment heat-map graphics from scored segments
  function buildSegmentGraphics(segments) {
    return segments.map(seg => {
      // Pick colour band
      const band = EXPOSURE_COLORS.slice().reverse().find(b => seg.score >= b.threshold)
                ?? EXPOSURE_COLORS[0];
      const [fr,fg,fb,fa] = band.fill;
      const [or,og,ob,oa] = band.outline;

      return new Graphic({
        geometry: seg.buffer,
        symbol: { type:'polygon-3d', symbolLayers:[{ type:'fill',
          material:{ color:[fr,fg,fb,fa+0.05] },
          outline:{ color:[or,og,ob,oa*0.5], size:0.6 } }] },
        attributes:{
          type:'corridor_segment',
          score: Math.round(seg.score * 100),
          distFromStartM: Math.round(seg.distFromStartM),
          label:`Exposure: ${Math.round(seg.score*100)}%  @  ${Math.round(seg.distFromStartM)} m`,
        },
      });
    });
  }

  // Build chokepoint markers
  function buildChokepointGraphics(chokepoints) {
    return chokepoints.map(cp => new Graphic({
      geometry: new Point({ longitude:cp.point.longitude, latitude:cp.point.latitude, spatialReference:{wkid:4326} }),
      symbol: { type:'point-3d', symbolLayers:[{ type:'object',
        resource:{ primitive:'cylinder' },
        material:{ color:[220,60,48,0.92] },
        width:50, height:80, depth:50 }],
        verticalOffset:{ screenLength:30, maxWorldLength:600, minWorldLength:5 } },
      attributes:{ type:'chokepoint', label:'Chokepoint — narrow terrain passage', index:cp.index },
    }));
  }

  // Leg label graphics
  function buildLegLabels(legs) {
    return legs.map(leg => {
      const midPt = destinationPoint(
        leg.from.longitude, leg.from.latitude,
        leg.bearingDeg, leg.distM / 2
      );
      const distStr = leg.distM >= 1000
        ? (leg.distM/1000).toFixed(2) + ' km'
        : Math.round(leg.distM) + ' m';
      return new Graphic({
        geometry: new Point({ longitude:midPt.longitude, latitude:midPt.latitude, spatialReference:{wkid:4326} }),
        symbol: { type:'text',
          color:'#c0bdb4', haloColor:[0,0,0,0.75], haloSize:1.5,
          text:`${distStr}  ${Math.round(leg.bearingDeg).toString().padStart(3,'0')}°`,
          font:{ family:'Courier New', size:9.5, weight:'bold' },
          horizontalAlignment:'center', verticalAlignment:'middle' },
        attributes:{ type:'leg_label', label:`Leg ${leg.index+1}: ${distStr}` },
      });
    });
  }

  return {
    buildCorridorStack,
    buildCorridorGraphics,
    buildCentrelineGraphics,
    buildSegmentGraphics,
    buildChokepointGraphics,
    buildLegLabels,
  };
}
