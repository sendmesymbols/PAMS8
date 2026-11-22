/**
 * The map and its two views, built before the PAMS8 library loads.
 *
 * index.html runs this module ahead of /src/main.ts. An ES module runs only once everything it imports has been
 * fetched, so while the views were built in main.ts the globe waited for all of MS/ (~350-480 modules) before it
 * started loading its services. Built here, from @arcgis/core and Settings.json alone, the views start loading while
 * MS/ is still being fetched; main.ts imports appConfig from here (the same module, already run).
 *
 * Keep MS/ code out of this module's imports (JSON data is fine), or the head start is lost.
 */
import esriConfig from '@arcgis/core/config';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Map from '@arcgis/core/map';
import MapImageLayer from '@arcgis/core/layers/MapImageLayer';
import TileLayer from '@arcgis/core/layers/TileLayer';
import type Layer from '@arcgis/core/layers/Layer';
import Basemap from '@arcgis/core/Basemap';
import ElevationLayer from '@arcgis/core/layers/ElevationLayer';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import settingsData from '../MS/Data/Settings.json';

// Serve ArcGIS runtime assets (CSS, i18n bundles, web workers, basemap defs)
// and fonts locally — no js.arcgis.com / internet dependency. The assets are
// copied from node_modules/@arcgis/core/assets into public/assets (see the
// "copy-assets" npm script, run automatically before dev/build).
esriConfig.assetsPath = '/assets';
esriConfig.fontsUrl = '/fonts';

// Define app config
let _activeView: MapView | SceneView | null = null;
let activeViewChanged: ((newView: MapView | SceneView, oldView: MapView | SceneView | null) => void) | null = null;

/** main.ts hands in its handler once SymbolEngine exists; it is told of each 2D / 3D switch. */
export function onActiveViewChange(fn: (newView: MapView | SceneView, oldView: MapView | SceneView | null) => void): void {
  activeViewChanged = fn;
}

export const appConfig = {
  // Both views are created at the foot of this module, before any other module can read them.
  mapView: null as unknown as MapView,
  sceneView: null as unknown as SceneView,
  get activeView(): MapView | SceneView {
    return _activeView as MapView | SceneView;
  },
  set activeView(view: MapView | SceneView) {
    const oldView = _activeView;
    _activeView = view;
    if (oldView !== view && activeViewChanged) {
      activeViewChanged(view, oldView);
    }
  },
  container: 'viewDiv',
};

// Initial view parameters for both 2D and 3D
const initialViewParams: {
  zoom: number;
  center: [number, number];
  container: string | null;
  map?: any;
} = {
  zoom: 7,
  center: [69.3451, 30.3753],
  container: appConfig.container,
};

// Create 3D Map (scene view) and 2D Map — offline vs online layer sourcing.
//
// `offline` (MS/Data/Settings.json) selects where the map's imagery/terrain and
// overlays come from:
//   • true  → the local ArcGIS Server (https://localhost:6443/arcgis), reached
//             via the same-origin `/arcgis` Vite dev proxy (see vite.config.ts:
//             `secure:false` accepts the self-signed cert, no CORS needed).
//   • false → Esri's online world basemap ('satellite' + 'world-elevation').
//
// It is a clean either/or swap: online mode loads ONLY the Esri basemap, offline
// mode loads ONLY the local services. Both the 2D MapView and 3D SceneView share
// this one `baseMap`, so the choice applies to 2D and 3D at once.
const offline = (settingsData as { offline?: boolean }).offline === true;

// The local services are dynamic (non-cached) MapServers — singleFusedMapCache
// false — so they are consumed as MapImageLayers (not TileLayers). Each layer
// loads with the existing "add if available" pattern: on load failure it warns
// and removes itself, so an unreachable service never breaks app startup.
const softLoad = (map: Map, layer: Layer, label: string): void => {
  layer.load().catch((error: unknown) => {
    console.warn(`[PAMS8] ${label} unavailable — removing layer.`, error);
    map.remove(layer);
  });
};

// Operational overlays join the map only once their service has answered. A layer
// in map.layers that is still loading holds the view back: on a machine that cannot
// reach the RoadNetwork server (192.168.0.15) the 3D view was ready only after the
// ~21 s connect timeout, against 1.3 s when the request failed at once (measured
// 22 Nov 2026). An empty, hidden GraphicsLayer keeps the overlay's place in the
// stack meanwhile, so the order below holds whichever service answers first and
// the overlays stay under the symbol layers added later.
const addWhenLoaded = (map: Map, layer: Layer, label: string): void => {
  const slot = new GraphicsLayer({ title: `${label} (loading)`, listMode: 'hide' });
  map.add(slot);
  layer.load().then(
    () => {
      const at = map.layers.indexOf(slot);
      map.remove(slot);
      if (at >= 0) map.add(layer, at);
      else map.add(layer);
    },
    (error: unknown) => {
      map.remove(slot);
      console.warn(`[PAMS8] ${label} unavailable — layer not added.`, error);
    },
  );
};

let baseMap: Map;
if (offline) {
  // Base imagery (bottom of the stack) → served as the map's basemap.
  const baseImagery = new MapImageLayer({
    url: '/arcgis/rest/services/PakImagery/MapServer',
    title: 'Imagery (Local)',
    listMode: 'show',
  });
  baseMap = new Map({
    basemap: new Basemap({ baseLayers: [baseImagery], title: 'Imagery (Local)' }),
  });

  // 3D ground / terrain from the same local service. If it is not an
  // elevation-capable endpoint (or is unreachable) it is removed → flat ground.
  const elevation = new ElevationLayer({
    url: '/arcgis/rest/services/PakImagery/MapServer',
  });
  baseMap.ground.layers.add(elevation);
  elevation.load().catch((error: unknown) => {
    console.warn('[PAMS8] Local elevation unavailable — using flat ground.', error);
    baseMap.ground.layers.remove(elevation);
  });

  // Operational overlays, added bottom→top: general map data (city labels at low
  // zoom) → road network → Pakistan boundary on top.
  const mapData = new MapImageLayer({
    url: '/arcgis/rest/services/Map_Data/MapServer',
    title: 'Map Data',
    listMode: 'show',
  });
  const roadNetwork = new MapImageLayer({
    url: '/arcgis/rest/services/Network_Analysis/MapServer',
    title: 'Road Network',
    listMode: 'show',
  });
  const pakistanLayer = new MapImageLayer({
    url: '/arcgis/rest/services/pakistan/MapServer',
    title: 'Pakistan',
    listMode: 'show',
  });
  softLoad(baseMap, baseImagery, 'LowResImagery_3d MapServer');
  addWhenLoaded(baseMap, mapData, 'Map_Data MapServer');
  addWhenLoaded(baseMap, roadNetwork, 'Network_Analysis MapServer');
  addWhenLoaded(baseMap, pakistanLayer, 'Pakistan MapServer');
} else {
  // Online: Esri world imagery + elevation, no local overlays.
  baseMap = new Map({
    basemap: 'satellite',
    ground: 'world-elevation',
  });
}

// Road network (RoadNetwork MapServer) — the same service the routing NAServer
// is built on, drawn as a half-opacity reference so planners can see the roads a
// route is actually following.
//
// Added in BOTH modes, unlike the overlays above: it lives on a different
// ArcGIS Server from the basemap services (`/roadnet` → 192.168.0.15:6443,
// vs `/arcgis` → localhost:6443), so it is not part of the offline/online swap.
// Same-origin proxy path rather than the raw https URL — the server ships no
// CORS headers and a self-signed cert, so a direct fetch is blocked.
//
// Sublayer 11 (`pkroads`) only: the service also carries the solver's own
// Stops / Barriers / Routes scratch layers, which must not be drawn.
// `minScale` exists to dodge one pathological case. The layer is ~2.5M edges
// with no cached tiles, so every export is rendered from scratch. Measured on an
// idle server at the resolution the 3D view actually requests (1920²):
//   40 km wide 0.3s · 80 km 1.6s · 150 km 3.7s · 600 km 4.8s · 1200 km 5.6s
//   …but the full-country extent (the startup view) jumps to 31s.
// Since the service runs on a single instance, that one request also queues the
// routing solver behind it. Hiding the layer above ~1:2 000 000 (roughly a
// 1000 km wide view) drops only that spike and keeps every practical scale.
const roadNetworkRef = new MapImageLayer({
  url: '/roadnet/arcgis/rest/services/RoadNetwork/MapServer',
  title: 'Road Network',
  listMode: 'show',
  opacity: 0.5,
  minScale: 2000000,
  sublayers: [{ id: 11, visible: true }],
});
addWhenLoaded(baseMap, roadNetworkRef, 'RoadNetwork MapServer');

// Place names (countries, provinces, cities, towns) from Esri's online
// World Boundaries and Places reference service — cached tiles, no API key.
// Added on top of the road layers and below the symbol layers (those are
// created later by GraphicsLayerManager). Needs internet: with no connection
// it is never added and the map simply has no labels.
const placeLabels = new TileLayer({
  url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer',
  title: 'Place Names (Esri)',
  listMode: 'show',
});
addWhenLoaded(baseMap, placeLabels, 'Esri World Boundaries and Places');

// Stack the bottom-right navigation widgets into a single vertical column
// (undo on top, then the zoom controls, plus compass/navigation-toggle in 3D)
// instead of ArcGIS's default horizontal row-reverse layout for that corner.
// The attribution bar is absolutely positioned, so it is unaffected.
const navStackStyle = document.createElement('style');
navStackStyle.textContent = `
  .esri-ui .esri-ui-bottom-right { flex-flow: column; align-items: flex-end; }
  .esri-ui .esri-ui-bottom-right .esri-component { margin-left: 0; }
`;
document.head.appendChild(navStackStyle);

/**
 * Relocate the default navigation widgets to the bottom-right corner.
 * MapView ships a "zoom" widget; SceneView adds "navigation-toggle" and
 * "compass" (pan/rotate). ui.move() ignores ids that aren't present.
 *
 * Must be re-run whenever a view's container is (re)assigned, not just once
 * at construction: the 2D MapView starts with `container: null` (it isn't
 * attached until the first 2D/3D switch), and ArcGIS re-establishes the
 * default UI — zoom back at its default 'top-left' — once a container is
 * actually attached, undoing an earlier move that ran against no container.
 */
export function relocateNavWidgets(view: MapView | SceneView, type: '2d' | '3d'): void {
  view.ui.move(type === '3d' ? ['zoom', 'navigation-toggle', 'compass'] : ['zoom'], 'bottom-right');
}

// Function to create the view based on the type
function createView(params: any, type: '2d' | '3d'): MapView | SceneView {
  let view: MapView | SceneView;
  if (type === '2d') {
    view = new MapView(params);
  } else {
    view = new SceneView(params);
  }

  // Suppress the SDK's built-in double-click zoom. Multi-point/area symbols use a
  // double-click to finish drawing (ArcGIS 3.x's disableDoubleClickZoom() no longer
  // exists in JS 5 — stopPropagation is the supported replacement).
  view.on('double-click', (event) => {
    event.stopPropagation();
  });

  relocateNavWidgets(view, type);

  // Small "Undo" button sitting on top of the zoom controls. Reuses the stock
  // esri-widget button styling so it matches the zoom +/- buttons in any theme.
  // index: 0 places it first in the bottom-right stack (topmost).
  const undoBtn = document.createElement('div');
  undoBtn.className = 'esri-widget esri-widget--button';
  undoBtn.setAttribute('role', 'button');
  undoBtn.setAttribute('tabindex', '0');
  undoBtn.setAttribute('aria-label', 'Undo');
  undoBtn.title = 'Undo (Ctrl+Z)';
  undoBtn.innerHTML = '<span aria-hidden="true" class="esri-icon esri-icon-undo"></span>';
  const doUndo = () => (window as any).symbolEngine?.undo?.();
  undoBtn.addEventListener('click', doUndo);
  undoBtn.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      doUndo();
    }
  });
  view.ui.add(undoBtn, { position: 'bottom-right', index: 0 });

  view
    .when(() => {})
    .catch((error) => {
      if (error.name.includes('webgl')) {
        alert(
          'WebGL Support not found. Please Enable WebGL Support to Continue',
        );
      }
    });
  return view;
}

// Create 3D view first (as we want it active on startup)
initialViewParams.map = baseMap;
appConfig.sceneView = <SceneView>createView(initialViewParams, '3d');

// Set the 3D view as the active view on startup
appConfig.activeView = appConfig.sceneView;

// Set the container for the 3D view
appConfig.sceneView.container = appConfig.container;

// Now create the 2D view but don't set it active initially
initialViewParams.container = null;
initialViewParams.map = baseMap;
appConfig.mapView = <MapView>createView(initialViewParams, '2d');
