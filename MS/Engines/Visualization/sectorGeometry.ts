// Pure wedge-ring geometry — NO @arcgis imports so it can run/verify under bare Node.
// All angles in degrees, distances in km, coordinates [lon, lat].

const R_EARTH_KM = 6371.0088;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Great-circle destination point from (lon,lat) at rangeKm along bearingDeg. */
export function geodesicDestination(
  lon: number, lat: number, rangeKm: number, bearingDeg: number,
): [number, number] {
  const ang = rangeKm / R_EARTH_KM;
  const brg = bearingDeg * D2R;
  const phi1 = lat * D2R;
  const lam1 = lon * D2R;
  const sinPhi2 = Math.sin(phi1) * Math.cos(ang) + Math.cos(phi1) * Math.sin(ang) * Math.cos(brg);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const y = Math.sin(brg) * Math.sin(ang) * Math.cos(phi1);
  const x = Math.cos(ang) - Math.sin(phi1) * sinPhi2;
  const lam2 = lam1 + Math.atan2(y, x);
  const lonOut = ((lam2 * R2D + 540) % 360) - 180; // normalize to [-180,180)
  return [lonOut, phi2 * R2D];
}

/**
 * Closed wedge ring [center, arc(azStart..azEnd clockwise), center].
 * Sweep is ALWAYS clockwise (increasing azimuth) from azStartDeg to azEndDeg.
 * Returns an array of [lon,lat]; first === last (closed).
 */
export function buildSectorRing(
  centerLon: number, centerLat: number, rangeKm: number,
  azStartDeg: number, azEndDeg: number, stepDeg = 2,
): [number, number][] {
  let span = (((azEndDeg - azStartDeg) % 360) + 360) % 360;
  if (span === 0) span = 360; // caller guards azStart===azEnd; full ring is the safe fallback
  const steps = Math.max(1, Math.ceil(span / stepDeg));
  const ring: [number, number][] = [[centerLon, centerLat]];
  for (let i = 0; i <= steps; i++) {
    const az = azStartDeg + (span * i) / steps;
    ring.push(geodesicDestination(centerLon, centerLat, rangeKm, az));
  }
  ring.push([centerLon, centerLat]);
  return ring;
}
