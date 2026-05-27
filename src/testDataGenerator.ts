import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import TextSymbol from "@arcgis/core/symbols/TextSymbol";
import type MapView from "@arcgis/core/views/MapView";
import type SceneView from "@arcgis/core/views/SceneView";

/**
 * Test field generator. Routes symbols through the same PAMS8 Plan path
 * a real saved plan uses (serializationEngine.loadPlanSymbolsFromData)
 * so milsymbol receives fully-formed input and the FORCE layer renders
 * proper identity colours + echelon bars.
 *
 * Drop-in reference: Features/sample.json — drawEss objects for FPoint
 * UEI symbols carry SYM_GEO_TYPE / SID / SYM_NAME / OPTIONS / GEOM (with
 * sp:"WGS1SP") / UEI:"1" / SIDC (20-char).
 */

/** Build a 20-char PAMS8 SIDC from identity + Symbols.json key + echelon. */
function buildSidc(identity: string, symbolKey: string, echelon: string): string {
  const symbolSet = symbolKey.slice(0, 2);
  const sid       = symbolKey.slice(2);
  return "10" + identity + symbolSet + "00" + echelon + sid + "0000";
}

const IDENTITY_CHAR: Record<string, string> = {
  friend:  "03",
  hostile: "06",
  neutral: "04",
};

/**
 * Curated Symbols.json keys (SymGeoType="FPoint", Class="UEISymbol") so
 * milsymbol renders something recognisable. Mix of land units and
 * equipment for visual variety.
 */
const SYMBOL_KEYS: ReadonlyArray<{ key: string; name: string }> = [
  { key: "10121100", name: "Inf" },
  { key: "10110201", name: "CivGenTpt" },
  { key: "10110208", name: "NatGuard" },
  { key: "10110209", name: "LtRadio" },
  { key: "15110100", name: "Rifle" },
  { key: "15110200", name: "MG" },
  { key: "15110203", name: "MG-Hy" },
  { key: "15110300", name: "GrenLn" },
  { key: "15110500", name: "ADGun" },
];

const NAME_PREFIXES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];
const NAME_SUFFIXES = ["Co", "Bn", "Bde", "Tm", "Plt"];

const ANNOT_LAYER_ID = "AnnotationLayer";
const FORCE_LAYER_ID = "ForceSymbolsLayer";
const TACT_PT_LAYER_ID = "TacticalPointSymbolsLayer";
const TACT_LAYER_ID = "TacticalSymbolsLayer";
const LEGACY_MIL_LAYER_ID = "milSymbols";

export interface TestFieldOptions {
  count?: number;
  stackCount?: number;
  identityMix?: ReadonlyArray<"friend" | "hostile" | "neutral">;
  echelonMix?: readonly string[];
  size?: number;
  /** Spread in degrees longitude/latitude around view centre. */
  spreadDegLon?: number;
  spreadDegLat?: number;
  withAnnotations?: boolean;
}

const DEFAULT_OPTS: Required<TestFieldOptions> = {
  count: 80,
  stackCount: 4,
  identityMix: ["friend", "friend", "friend", "hostile", "hostile", "neutral"],
  // 2525D echelon ladder: 12 Squad → 23 Army, weighted mid-tier.
  echelonMix: ["12", "14", "15", "15", "16", "16", "17", "18", "21", "23"],
  size: 32,
  spreadDegLon: 0.5,
  spreadDegLat: 0.4,
  withAnnotations: true,
};

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Marker so clearTestField can find every test graphic. */
const TEST_SOURCE_PREFIX = "test-";

/**
 * Drop a configurable field of UEI symbols around the current view
 * centre. Uses the Plan loader path so symbols render correctly and end
 * up on the FORCE layer. Returns the number successfully loaded.
 */
export function generateTestField(
  symbolEngine: any,
  view: MapView | SceneView | undefined,
  options: TestFieldOptions = {},
): number {
  const opts = { ...DEFAULT_OPTS, ...options };
  const serializationEngine = symbolEngine?.serializationEngine;
  const layerManager = symbolEngine?.layerManager;

  if (!serializationEngine?.loadPlanSymbolsFromData) {
    console.warn("[testDataGenerator] symbolEngine.serializationEngine not available");
    return 0;
  }
  if (!view || !(view as any).center) {
    console.warn("[testDataGenerator] view has no center yet — pan/zoom and try again");
    return 0;
  }

  const centerLon = (view as any).center.longitude;
  const centerLat = (view as any).center.latitude;
  if (typeof centerLon !== "number" || typeof centerLat !== "number") {
    console.warn("[testDataGenerator] view centre has no lon/lat — view spatial reference may be non-geographic");
    return 0;
  }

  // Stack centres in lat/lon, spread across the visible area.
  const stackCentres: Array<{ lon: number; lat: number }> = [];
  for (let i = 0; i < opts.stackCount; i++) {
    stackCentres.push({
      lon: centerLon + (Math.random() - 0.5) * opts.spreadDegLon,
      lat: centerLat + (Math.random() - 0.5) * opts.spreadDegLat,
    });
  }

  const tStart = Date.now();
  const planId = tStart;
  const overlayId = `test-overlay-${tStart}`;
  const stackedCount = opts.stackCount * 4;

  // Snapshot the FORCE layer's current graphic-ids so we can identify
  // the freshly-added test graphics afterwards (for annotation linking).
  const forceLayer = layerManager?.getLayer?.(FORCE_LAYER_ID);
  const idsBefore = new Set<string>();
  if (forceLayer?.graphics) {
    forceLayer.graphics.forEach((g: Graphic) => {
      const id = String(g.attributes?.id ?? "");
      if (id) idsBefore.add(id);
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Build the Plan document — one overlay, N symbols.
  // ──────────────────────────────────────────────────────────────────
  const symbols: any[] = [];
  for (let i = 0; i < opts.count; i++) {
    let lon: number;
    let lat: number;
    if (i < stackedCount) {
      const c = stackCentres[Math.floor(i / 4)];
      // Sub-meter jitter (~1e-5°) so coordinates aren't bit-identical
      lon = c.lon + (Math.random() - 0.5) * 1e-5;
      lat = c.lat + (Math.random() - 0.5) * 1e-5;
    } else {
      lon = centerLon + (Math.random() - 0.5) * opts.spreadDegLon;
      lat = centerLat + (Math.random() - 0.5) * opts.spreadDegLat;
    }

    const identityKey = pick(opts.identityMix);
    const identity = IDENTITY_CHAR[identityKey] ?? "03";
    const echelon = pick(opts.echelonMix);
    const symbolDef = pick(SYMBOL_KEYS);
    const sid = symbolDef.key.slice(2);
    const sidc = buildSidc(identity, symbolDef.key, echelon);
    const designator =
      pick(NAME_PREFIXES) + " " + pick(NAME_SUFFIXES) + " " + (i + 1);

    // drawEss matches the FPoint shape in Features/sample.json
    const drawEssObj = {
      SYM_GEO_TYPE: "FPoint",
      SID: sid,
      SYM_NAME: symbolDef.name,
      OPTIONS: {
        alphaNum: 100,
        size: String(opts.size),
        ANGLE: 0,
        symType: "FPoint",
        SIDC: sidc,
        uniqueDesignation: designator,
        uniqueDesignationID: "",
        higherFormation: "",
        hfid: "",
        staffComments: "",
        additionalInformation: "",
        ECHELON: echelon,
        opacity: 1,
        labelOptions: {},
        GEOM: { type: "point", x: lon, y: lat, sp: "WGS1SP" },
      },
      GEOM: { type: "point", x: lon, y: lat, sp: "WGS1SP" },
      AMPLIFIER: {},
      UEI: "1",
      SIDC: sidc,
      labelOptions: {},
      opacity: 1,
    };

    symbols.push({
      plnOrdrSymbolPK: {
        plnOrdrId: planId,
        plnOrdrSymbolId: `${TEST_SOURCE_PREFIX}${tStart}-${i}`,
        plnOrdrOverlayId: overlayId,
      },
      isDelete: "N",
      isShared: "N",
      creatorId: 1,
      updateSeqnr: 1,
      drawEss: JSON.stringify(drawEssObj),
    });
  }

  const planDoc = {
    poObj: {
      plnOrdrId: planId,
      catCode: "PLAN",
      creatorId: 1,
      updateSeqnr: 1,
      plns: [],
      ordrs: [],
      plnOrdrHdrCntnts: [],
      orgPoas: [],
      plnOrdrOverlay: [
        {
          plnOrdrOverlayPK: {
            plnOrdrId: planId,
            plnOrdrOverlayId: overlayId,
          },
          nameTxt: "Test Field",
          typeTxt: "Test Field",
          seqOrdr: tStart,
          hierarchyType: "Simple Overlay",
          isDelete: "N",
          isShared: "N",
          creatorId: 1,
          updateSeqnr: 1,
          plnOrdrSymbolSet: symbols,
        },
      ],
    },
  };

  // ──────────────────────────────────────────────────────────────────
  // Load through the canonical path. Returns number of placed symbols.
  // ──────────────────────────────────────────────────────────────────
  let loaded = 0;
  try {
    loaded = serializationEngine.loadPlanSymbolsFromData(planDoc);
  } catch (err) {
    console.error("[testDataGenerator] loadPlanSymbolsFromData failed", err);
    return 0;
  }
  if (loaded <= 0) return loaded < 0 ? 0 : loaded;

  // ──────────────────────────────────────────────────────────────────
  // Add separate annotation graphics so LabelPlacer + abbreviation +
  // leader lines have something to act on. UEI symbols don't generate
  // these automatically (their label is baked into the milsymbol image).
  // ──────────────────────────────────────────────────────────────────
  if (opts.withAnnotations && layerManager) {
    const annotLayer = layerManager.getOrCreateLayer?.(ANNOT_LAYER_ID);
    if (annotLayer) {
      const allLayerIds = [FORCE_LAYER_ID, TACT_PT_LAYER_ID, TACT_LAYER_ID, LEGACY_MIL_LAYER_ID];
      for (const lid of allLayerIds) {
        const layer = layerManager.getLayer?.(lid);
        if (!layer?.graphics) continue;
        layer.graphics.forEach((g: Graphic) => {
          const id = String(g.attributes?.id ?? "");
          if (!id || idsBefore.has(id)) return;
          const srcId = String(g.attributes?.sourceSymbolId ?? "");
          if (!srcId.startsWith(TEST_SOURCE_PREFIX)) return;

          const de = g.attributes?.drawEssentials;
          const designator = de?.OPTIONS?.uniqueDesignation
            || (de as any)?.uniqueDesignation
            || srcId;

          const geom = g.geometry as Point | null;
          if (!geom) return;

          annotLayer.add(new Graphic({
            geometry: geom.clone(),
            symbol: new TextSymbol({
              text: designator,
              color: [240, 240, 240, 1] as any,
              font: { size: 11, family: "Arial", weight: "bold" },
              haloColor: [0, 0, 0, 0.7] as any,
              haloSize: 1,
              yoffset: -22,
            }),
            attributes: {
              parentId: id,
              sourceSymbolId: srcId,        // matched by clearTestField
              createdAt: Date.now(),
            },
          }));
        });
      }
    }
  }

  return loaded;
}

/**
 * Cluttered preset. Same generator, same Plan path — but a much tighter
 * spread plus many small same-coordinate stacks so symbols pile on top of
 * one another. Deliberately jumbled to stress every declutter path at
 * once: label-placement collisions, disperse fans, cluster badges and the
 * echelon ladder. Tagged "test-" like the normal field, so Clear Test
 * Field removes both.
 */
export function generateClutteredField(
  symbolEngine: any,
  view: MapView | SceneView | undefined,
  options: TestFieldOptions = {},
): number {
  const count = Math.max(1, options.count ?? 150);
  // Most of the field lives in 4-symbol stacks (≈80%), so overlap is heavy.
  const stackCount = options.stackCount ?? Math.max(8, Math.floor((count * 0.8) / 4));

  return generateTestField(symbolEngine, view, {
    // Tight footprint → even the non-stacked symbols overlap on screen.
    spreadDegLon: 0.04,
    spreadDegLat: 0.03,
    ...options,
    count,
    stackCount,
  });
}

/**
 * Remove every graphic with a sourceSymbolId tagged "test-". Safe to
 * call any time — leaves user-drawn symbols alone.
 */
export function clearTestField(symbolEngine: any): number {
  const layerManager = symbolEngine?.layerManager;
  if (!layerManager) return 0;

  let removed = 0;
  const layerIds = [
    FORCE_LAYER_ID,
    TACT_PT_LAYER_ID,
    TACT_LAYER_ID,
    LEGACY_MIL_LAYER_ID,
    ANNOT_LAYER_ID,
  ];
  for (const lid of layerIds) {
    const layer = layerManager.getLayer?.(lid);
    if (!layer?.graphics) continue;
    const toRemove: Graphic[] = [];
    layer.graphics.forEach((g: Graphic) => {
      const src = String(g.attributes?.sourceSymbolId ?? "");
      const id  = String(g.attributes?.id ?? "");
      if (src.startsWith(TEST_SOURCE_PREFIX) || id.startsWith(TEST_SOURCE_PREFIX)) {
        toRemove.push(g);
      }
    });
    if (toRemove.length) {
      layer.removeMany(toRemove);
      removed += toRemove.length;
    }
  }
  return removed;
}
