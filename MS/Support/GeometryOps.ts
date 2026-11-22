/**
 * GeometryOps — the one place PAMS8 calls the ArcGIS geometry operators.
 *
 * `@arcgis/core/geometry/geometryEngine` (deprecated 4.32) and
 * `geometry/support/geodesicUtils` (deprecated 4.33) are replaced by the
 * per-function modules under `geometry/operators/`. This module keeps the
 * old call shapes (`geodesicBuffer(g, d, "meters")`, `union([...])`, ...)
 * so the engines change only their import.
 *
 * The geodetic operators (buffer, length, area, densify, utils) need an
 * async `load()` before their synchronous `execute()` works. `loadGeometryOps()`
 * starts it (SymbolEngine calls it in its constructor, and the first geodesic
 * call starts it too); until it has finished, the geodesic helpers answer
 * from a local fallback (Vincenty on WGS84 for points and circles, the
 * cos-latitude corrected planar operator for lines and areas) so a hot path
 * such as a mouse-move never throws and never waits. Once loaded, every
 * answer is the operator's own.
 */
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import type Geometry from "@arcgis/core/geometry/Geometry";
import type { LengthUnit, AreaUnit } from "@arcgis/core/core/units";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";

import * as geodesicBufferOperator from "@arcgis/core/geometry/operators/geodesicBufferOperator";
import * as geodeticLengthOperator from "@arcgis/core/geometry/operators/geodeticLengthOperator";
import * as geodeticAreaOperator from "@arcgis/core/geometry/operators/geodeticAreaOperator";
import * as geodeticDensifyOperator from "@arcgis/core/geometry/operators/geodeticDensifyOperator";
import * as geodeticUtilsOperator from "@arcgis/core/geometry/operators/geodeticUtilsOperator";
import * as bufferOperator from "@arcgis/core/geometry/operators/bufferOperator";
import * as lengthOperator from "@arcgis/core/geometry/operators/lengthOperator";
import * as areaOperator from "@arcgis/core/geometry/operators/areaOperator";
import * as densifyOperator from "@arcgis/core/geometry/operators/densifyOperator";
import * as unionOperator from "@arcgis/core/geometry/operators/unionOperator";
import * as simplifyOperator from "@arcgis/core/geometry/operators/simplifyOperator";
import * as differenceOperator from "@arcgis/core/geometry/operators/differenceOperator";
import * as intersectionOperator from "@arcgis/core/geometry/operators/intersectionOperator";
import * as intersectsOperator from "@arcgis/core/geometry/operators/intersectsOperator";
import * as containsOperator from "@arcgis/core/geometry/operators/containsOperator";
import * as convexHullOperator from "@arcgis/core/geometry/operators/convexHullOperator";
import * as generalizeOperator from "@arcgis/core/geometry/operators/generalizeOperator";
import * as proximityOperator from "@arcgis/core/geometry/operators/proximityOperator";

/** Any geometry an operator accepts (they all take the GeometryUnion family). */
type G = any;

// ─── Loading ────────────────────────────────────────────────────────────────

const GEODETIC = [
    geodesicBufferOperator,
    geodeticLengthOperator,
    geodeticAreaOperator,
    geodeticDensifyOperator,
    geodeticUtilsOperator,
] as const;

let _loading: Promise<void> | null = null;

/** Start (once) loading the geodetic operators. Safe to call often. */
export function loadGeometryOps(): Promise<void> {
    if (geometryOpsLoaded()) return Promise.resolve();
    if (!_loading) {
        _loading = Promise.all(GEODETIC.map(op => (op.isLoaded() ? undefined : op.load())))
            .then(() => undefined)
            .catch(err => {
                _loading = null; // let a later call try again
                throw err;
            });
    }
    return _loading;
}

/** True once every geodetic operator is ready (the fallbacks are no longer used). */
export function geometryOpsLoaded(): boolean {
    return GEODETIC.every(op => op.isLoaded());
}

function ensureLoading(): boolean {
    if (geometryOpsLoaded()) return true;
    loadGeometryOps().catch(() => { /* fallbacks stay in use */ });
    return false;
}

// ─── Units and spatial references (local: GeoTools imports this module) ────

const LENGTH_M: Record<string, number> = {
    millimeters: 0.001, centimeters: 0.01, decimeters: 0.1, meters: 1, kilometers: 1000,
    inches: 0.0254, feet: 0.3048, "us-feet": 1200 / 3937, yards: 0.9144,
    miles: 1609.344, "nautical-miles": 1852,
};
const AREA_M2: Record<string, number> = {
    "square-millimeters": 1e-6, "square-centimeters": 1e-4, "square-decimeters": 0.01,
    "square-meters": 1, "square-kilometers": 1e6, "square-inches": 0.0254 ** 2,
    "square-feet": 0.3048 ** 2, "square-us-feet": (1200 / 3937) ** 2, "square-yards": 0.9144 ** 2,
    "square-miles": 1609.344 ** 2, "square-nautical-miles": 1852 ** 2,
    acres: 4046.8564224, ares: 100, hectares: 10000,
};
const toMeters = (v: number, unit: string) => v * (LENGTH_M[unit] ?? 1);
const fromMeters = (m: number, unit: string) => m / (LENGTH_M[unit] ?? 1);

function isWebMercator(sr: SpatialReference | null | undefined): boolean {
    if (!sr) return false;
    if ((sr as any).isWebMercator) return true;
    const w = sr.wkid;
    return w === 102100 || w === 3857 || w === 102113 || w === 900913;
}
function isGeographic(sr: SpatialReference | null | undefined): boolean {
    return !!sr && (!!(sr as any).isWGS84 || !!(sr as any).isGeographic || sr.wkid === 4326);
}
/** Latitude (deg) at the middle of a geometry. */
function midLatitude(g: G): number {
    const ext = g?.extent;
    const p: Point | null = g?.type === "point" ? g : ext?.center ?? null;
    if (!p) return 0;
    if (isWebMercator(p.spatialReference)) {
        return (webMercatorUtils.webMercatorToGeographic(p) as Point).y;
    }
    return p.y;
}
/** Ground meters → map units of `g`'s spatial reference at its latitude. */
function metersToMapUnitsAt(g: G, meters: number): number {
    const sr = g?.spatialReference;
    if (isWebMercator(sr)) return meters / Math.cos((midLatitude(g) * Math.PI) / 180);
    if (isGeographic(sr)) return meters / 111_320;
    return meters;
}

// ─── Fallback geodesy (WGS84 ellipsoid, used only before load() finishes) ──

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_B = WGS84_A * (1 - WGS84_F);

/** Vincenty direct problem: lon/lat (deg) + distance (m) + azimuth (deg) → lon/lat. */
function vincentyDirect(lon: number, lat: number, distM: number, azDeg: number): [number, number] {
    const a = WGS84_A, b = WGS84_B, f = WGS84_F;
    const α1 = (azDeg * Math.PI) / 180;
    const sinα1 = Math.sin(α1), cosα1 = Math.cos(α1);
    const tanU1 = (1 - f) * Math.tan((lat * Math.PI) / 180);
    const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1), sinU1 = tanU1 * cosU1;
    const σ1 = Math.atan2(tanU1, cosα1);
    const sinα = cosU1 * sinα1;
    const cosSqα = 1 - sinα * sinα;
    const uSq = (cosSqα * (a * a - b * b)) / (b * b);
    const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    let σ = distM / (b * A), σPrev = 0;
    let cos2σm = 0, sinσ = 0, cosσ = 0;
    for (let i = 0; i < 100; i++) {
        cos2σm = Math.cos(2 * σ1 + σ);
        sinσ = Math.sin(σ); cosσ = Math.cos(σ);
        const Δσ = B * sinσ * (cos2σm + (B / 4) * (cosσ * (-1 + 2 * cos2σm * cos2σm)
            - (B / 6) * cos2σm * (-3 + 4 * sinσ * sinσ) * (-3 + 4 * cos2σm * cos2σm)));
        σPrev = σ;
        σ = distM / (b * A) + Δσ;
        if (Math.abs(σ - σPrev) < 1e-12) break;
    }
    const x = sinU1 * sinσ - cosU1 * cosσ * cosα1;
    const φ2 = Math.atan2(sinU1 * cosσ + cosU1 * sinσ * cosα1, (1 - f) * Math.sqrt(sinα * sinα + x * x));
    const λ = Math.atan2(sinσ * sinα1, cosU1 * cosσ - sinU1 * sinσ * cosα1);
    const C = (f / 16) * cosSqα * (4 + f * (4 - 3 * cosSqα));
    const L = λ - (1 - C) * f * sinα * (σ + C * sinσ * (cos2σm + C * cosσ * (-1 + 2 * cos2σm * cos2σm)));
    let lon2 = lon + (L * 180) / Math.PI;
    lon2 = ((lon2 + 540) % 360) - 180;
    return [lon2, (φ2 * 180) / Math.PI];
}

/** Great-circle distance (m) on the WGS84 mean radius; within ~0.5 % of the ellipsoid. */
function haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
    const R = 6371008.8, r = Math.PI / 180;
    const dφ = (lat2 - lat1) * r, dλ = (lon2 - lon1) * r;
    const h = Math.sin(dφ / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dλ / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toGeographic(g: G): G {
    return isWebMercator(g?.spatialReference) ? webMercatorUtils.webMercatorToGeographic(g) : g;
}

function fallbackCircle(center: Point, radiusM: number, steps = 90): Polygon {
    const isWM = isWebMercator(center.spatialReference);
    const c = isWM ? (webMercatorUtils.webMercatorToGeographic(center) as Point) : center;
    const ring: number[][] = [];
    for (let i = 0; i <= steps; i++) {
        // clockwise rings (ArcGIS outer-ring order): azimuth increases clockwise
        ring.push(vincentyDirect(c.x, c.y, radiusM, (360 * (i % steps)) / steps));
    }
    let poly = new Polygon({ rings: [ring], spatialReference: SpatialReference.WGS84 });
    if (isWM) poly = webMercatorUtils.geographicToWebMercator(poly) as Polygon;
    return poly;
}

function fallbackLengthM(g: G): number {
    const geo = toGeographic(g);
    const parts: number[][][] = geo?.paths ?? geo?.rings ?? [];
    let total = 0;
    for (const path of parts) {
        for (let i = 1; i < path.length; i++) {
            total += haversineM(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
        }
    }
    return total;
}

// ─── Geodesic (operators after load, fallback before) ──────────────────────

/** Ground-true buffer (old `geometryEngine.geodesicBuffer`). */
export function geodesicBuffer(geometry: G, distance: number, unit: LengthUnit = "meters"): Polygon | null {
    if (!geometry) return null;
    if (ensureLoading()) return geodesicBufferOperator.execute(geometry, distance, { unit }) ?? null;
    const meters = toMeters(distance, unit);
    if (geometry.type === "point") return fallbackCircle(geometry as Point, meters);
    return (bufferOperator.execute(geometry, metersToMapUnitsAt(geometry, meters)) as Polygon) ?? null;
}

/** Ground length (old `geometryEngine.geodesicLength`). */
export function geodesicLength(geometry: G, unit: LengthUnit = "meters"): number {
    if (!geometry) return 0;
    if (ensureLoading()) return geodeticLengthOperator.execute(geometry, { unit });
    return fromMeters(fallbackLengthM(geometry), unit);
}

/** Ground area (old `geometryEngine.geodesicArea`). */
export function geodesicArea(geometry: G, unit: AreaUnit = "square-meters"): number {
    if (!geometry) return 0;
    if (ensureLoading()) return geodeticAreaOperator.execute(geometry, { unit });
    const wm = isGeographic(geometry.spatialReference)
        ? webMercatorUtils.geographicToWebMercator(geometry)
        : geometry;
    const k = Math.cos((midLatitude(wm) * Math.PI) / 180);
    const m2 = Math.abs(areaOperator.execute(wm)) * (isWebMercator(wm.spatialReference) ? k * k : 1);
    return m2 / (AREA_M2[unit] ?? 1);
}

/** Add vertices along geodesics (old `geometryEngine.geodesicDensify`). */
export function geodesicDensify(geometry: G, maxSegmentLength: number, unit: LengthUnit = "meters"): G | null {
    if (!geometry) return null;
    if (ensureLoading()) return geodeticDensifyOperator.execute(geometry, maxSegmentLength, { unit }) ?? null;
    return densifyOperator.execute(geometry, metersToMapUnitsAt(geometry, toMeters(maxSegmentLength, unit)));
}

/**
 * Point at a distance (m) and azimuth (deg clockwise from north) from a WGS84
 * point (old `geodesicUtils.pointFromDistance`). Returns a WGS84 point.
 */
export function pointFromDistance(point: Point, distanceM: number, azimuthDeg: number): Point {
    if (ensureLoading()) {
        const p = geodeticUtilsOperator.pointFromDistance(point, distanceM, azimuthDeg, { unit: "meters" });
        if (p) return p;
    }
    const [x, y] = vincentyDirect(point.x, point.y, distanceM, azimuthDeg);
    return new Point({ x, y, spatialReference: SpatialReference.WGS84 });
}

// ─── Planar (no load needed) ───────────────────────────────────────────────

export function buffer(geometry: G, distance: number, unit?: LengthUnit): Polygon | null {
    if (!geometry) return null;
    return bufferOperator.execute(geometry, distance, unit ? { unit } : undefined) ?? null;
}

export function planarLength(geometry: G, unit?: LengthUnit): number {
    if (!geometry) return 0;
    return lengthOperator.execute(geometry, unit ? { unit } : undefined);
}

export function planarArea(geometry: G, unit?: AreaUnit): number {
    if (!geometry) return 0;
    return areaOperator.execute(geometry, unit ? { unit } : undefined);
}

/**
 * A union input as the old engine read it. A polygon whose rings are all
 * clockwise (outer rings, no holes) is split into one polygon per ring, so
 * where rings overlap the area stays filled: MultiHeadMainAttack builds each
 * head as an overlapping shaft + head ring, which the operators otherwise read
 * as a hole (or a many-ringed, smaller shape). Anything else non-simple is
 * simplified. Intersect, difference, hull and the predicates already gave the
 * old engine's answer on such input, so only union needs this.
 */
function unionParts(g: G): G[] {
    if (g?.type === "polygon" && g.rings?.length > 1 && g.rings.every((r: number[][]) => g.isClockwise(r))) {
        return g.rings.map((r: number[][]) => new Polygon({
            rings: [r], spatialReference: g.spatialReference, hasZ: g.hasZ, hasM: g.hasM,
        }));
    }
    if (simplifyOperator.isSimple(g)) return [g];
    return [simplifyOperator.execute(g) ?? g];
}

/** Union of a list (old `geometryEngine.union(array)`); nulls are skipped. */
export function union(geometries: Array<G | null | undefined>): G | null {
    const list = (geometries ?? []).filter(Boolean) as G[];
    if (list.length === 0) return null;
    if (list.length === 1) return list[0];
    return unionOperator.executeMany(list.flatMap(unionParts)) ?? null;
}

export function difference(geometry: G, subtractor: G): G | null {
    if (!geometry) return null;
    if (!subtractor) return geometry;
    return differenceOperator.execute(geometry, subtractor) ?? null;
}

export function intersect(geometry1: G, geometry2: G): G | null {
    if (!geometry1 || !geometry2) return null;
    return intersectionOperator.execute(geometry1, geometry2) ?? null;
}

export function intersects(geometry1: G, geometry2: G): boolean {
    if (!geometry1 || !geometry2) return false;
    return intersectsOperator.execute(geometry1, geometry2);
}

export function contains(container: G, insideGeometry: G): boolean {
    if (!container || !insideGeometry) return false;
    return containsOperator.execute(container, insideGeometry);
}

export function convexHull(geometry: G): G | null {
    if (!geometry) return null;
    return convexHullOperator.execute(geometry) ?? null;
}

export function generalize(geometry: G, maxDeviation: number, removeDegenerateParts = false, unit?: LengthUnit): G | null {
    if (!geometry) return null;
    return generalizeOperator.execute(geometry, maxDeviation, unit ? { removeDegenerateParts, unit } : { removeDegenerateParts }) ?? null;
}

/** Nearest point on `geometry` to `point` (old `geometryEngine.nearestCoordinate`). */
export function nearestCoordinate(geometry: G, point: Point) {
    return proximityOperator.getNearestCoordinate(geometry, point, { calculateLeftRightSide: true });
}

/** Nearest vertex of `geometry` to `point` (old `geometryEngine.nearestVertex`). */
export function nearestVertex(geometry: G, point: Point) {
    return proximityOperator.getNearestVertex(geometry, point);
}

export type { Geometry };
