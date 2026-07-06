import esriConfig from '@arcgis/core/config';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Map from '@arcgis/core/map';
import settingsData from '../MS/Data/Settings.json';

// Serve ArcGIS runtime assets (CSS, i18n bundles, web workers, basemap defs)
// and fonts locally — no js.arcgis.com / internet dependency. The assets are
// copied from node_modules/@arcgis/core/assets into public/assets (see the
// "copy-assets" npm script, run automatically before dev/build).
esriConfig.assetsPath = '/assets';
esriConfig.fontsUrl = '/fonts';
import SymbolEngine from '@lib/Engines/SymbolEngine';
import SettingsMenu from '@lib/Support/SettingsMenu';
import VisualizationEngine from '@lib/Engines/Visualization/VisualizationEngine';
import CombatPowerEngine from '@lib/Engines/Planning/CombatPowerEngine';
//import SymbolEngine from "../dist/MS/Engines/SymbolEngine.min.js";
import type { SymbolOptions } from '../MS/ThirdParty/MilSymbols/UEITypes.ts';
import Amplifier from '@lib/Support/Amplifier';
import DrawEssentials from '@lib/Support/DrawEssentials';

// Render settings (lift / drop lines / scene quality / shadows / atmosphere)
// are owned by VisualizationEngine — see `applyRenderSettings()` below for the
// shim that delegates to it, kept so index.html can keep calling
// `window.applyRenderSettings(...)` unchanged.

//import SymbolEngine from "../dist/MS/Engines/SymbolEngine.min";
//import type { SymbolOptions } from '../dist/MS/ThirdParty/MilSymbols/UEITypes'

// Import milsymbol types
import '../MS/ThirdParty/MilSymbols/milsymbol.d.ts';
import { generateTestField, generateClutteredField, clearTestField } from './testDataGenerator';

// Define button to switch views
const switchButton: HTMLElement | null = document.getElementById('switch-btn');
const drawButton: HTMLElement | null = document.getElementById('draw-btn');
const savePlanButton = document.getElementById('savePlanButton');
const loadPlanButton = document.getElementById('loadPlanButton');
const deploymentManagerBtn = document.getElementById('deployment-manager-btn');
const analysisHubBtn = document.getElementById('analysis-hub-btn');

// ── Command palette — popover of all widgets (a "Menu" dropdown item) ─────────
// The trigger now lives inside the "Menu" dropdown, which hides on selection, so
// anchor the popover to the always-visible dropdown button instead of the item.
const settingsMenuBtn = document.getElementById('settingsMenuBtn');
const menuDropdownBtn = document.getElementById('menuBtn') ?? settingsMenuBtn;
settingsMenuBtn?.addEventListener('click', () => SettingsMenu.open(menuDropdownBtn));

// Autocomplete elements
const symbolSearchInput = document.getElementById(
  'symbolSearch',
) as HTMLInputElement;
const autocompleteList = document.getElementById(
  'autocompleteList',
) as HTMLDivElement;
const symbolDetails = document.getElementById(
  'symbolDetails',
) as HTMLDivElement;
const symbolDetailsContent = document.getElementById(
  'symbolDetailsContent',
) as HTMLDivElement;

// Define app config
let _activeView: MapView | SceneView = null;
const appConfig = {
  mapView: null,
  sceneView: null,
  get activeView() {
    return _activeView;
  },
  set activeView(view: MapView | SceneView) {
    const oldView = _activeView;
    _activeView = view;
    if (oldView !== view && onActiveViewChanged) {
      onActiveViewChanged(view, oldView);
    }
  },
  container: 'viewDiv',
};

let onActiveViewChanged:
  | ((newView: MapView | SceneView, oldView: MapView | SceneView) => void)
  | null = null;
/*
const appConfig: { mapView: any; sceneView: any; activeView: any; container: any } = {
  mapView: null,
  sceneView: null,
  activeView: null,
  container: 'viewDiv' // Use same container for both views
};
*/

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

// Create 3D Map (scene view) and 2D Map
const baseMap = new Map({
  basemap: 'satellite',
  ground: 'world-elevation',
});

// Create 3D view first (as we want it active on startup)
initialViewParams.map = baseMap;
appConfig.sceneView = <SceneView>createView(initialViewParams, '3d');
// Render settings (lift, drop lines, scene quality, shadows, atmosphere) are
// applied through VisualizationEngine. Calling it here — before SymbolEngine
// is constructed — relies on the engine being a getInstance() singleton; the
// engine will cache the SceneView and re-apply when setOptions runs later.
VisualizationEngine.getInstance().applyRenderSettings(appConfig.sceneView, settingsData);

// Set the 3D view as the active view on startup
appConfig.activeView = appConfig.sceneView;

// Set the container for the 3D view
appConfig.sceneView.container = appConfig.container;

// Now create the 2D view but don't set it active initially
initialViewParams.container = null;
initialViewParams.map = baseMap;
appConfig.mapView = <MapView>createView(initialViewParams, '2d');

const useInteractivePlacement = true;
const symbolEngine = new SymbolEngine(() => appConfig.activeView);

// Expose symbolEngine globally so the settings panel can communicate with it
(window as any).symbolEngine = symbolEngine;
// Threat Sector panel — open button in the Visualization settings panel
document.getElementById('sector-open-panel-btn')?.addEventListener('click', () => {
  (window as any).symbolEngine?.openSectorPanel?.();
});
Object.defineProperty(window as any, 'keyTerrainEngine', {
  configurable: true,
  get() {
    return symbolEngine.keyTerrainIdentificationEngine;
  },
});
Object.defineProperty(window as any, 'posDefScorerEngine', {
  configurable: true,
  get() {
    return symbolEngine.posDefScorerEngine;
  },
});
Object.defineProperty(window as any, 'opRankerEngine', {
  configurable: true,
  get() {
    return symbolEngine.opRankerEngine;
  },
});
Object.defineProperty(window as any, 'localPeaksEngine', {
  configurable: true,
  get() {
    return symbolEngine.localPeaksEngine;
  },
});
Object.defineProperty(window as any, 'ocokaEngine', {
  configurable: true,
  get() {
    return symbolEngine.ocokaEngine;
  },
});
Object.defineProperty(window as any, 'missionPlannerEngine', {
  configurable: true,
  get() {
    return symbolEngine.missionPlannerEngine;
  },
});
Object.defineProperty(window as any, 'landingZoneEngine', {
  configurable: true,
  get() {
    return symbolEngine.landingZoneEngine;
  },
});
Object.defineProperty(window as any, 'airspaceEngine', {
  configurable: true,
  get() {
    return symbolEngine.airspaceEngine;
  },
});

// Expose DrawingCueEngine singleton so index.html plain JS can call openCompassWidget() etc.
import DrawingCueEngine from '@lib/Engines/DrawingCueEngine';
(window as any).drawingCueEngine = DrawingCueEngine.getInstance();

// ── Engine log listener ───────────────────────────────────────────────────────
// Engines emit 'engine-log' events — the client application decides how to
// display them.  The log panel in index.html renders them visually; this
// listener forwards them to the browser console so they are also searchable.
import type { EngineLogEntry } from '../MS/Support/EngineLogger';
document.addEventListener('engine-log', (e: Event) => {
  const { engine, type, formatted } = (e as CustomEvent<EngineLogEntry>).detail;
  if (type === 'error') {
    console.warn(formatted);
  } else {
    console.info(formatted);
  }
});

onActiveViewChanged = (newView, oldView) => {
  console.log('View changed from', oldView?.type, 'to', newView?.type);
  symbolEngine.onViewChanged(newView); // Add this method in SymbolEngine
};

if (drawButton) {
  drawButton.addEventListener('click', () => {
    const sidcInput = document.getElementById('sidcText') as HTMLInputElement;
    const sidc = sidcInput?.value.trim();

    const options: SymbolOptions = {
      sidc,
      size: 35,
      quantity: '200',
      staffComments: 'REINFORCEMENTS',
      additionalInformation: 'SUPPORT FOR JJ',
      type: 'MACHINE GUN',
      dtg: '30140000ZSEP97',
      location: '0900000.0E570306.0N',
    };

    appConfig.activeView.when(() => {
      let amplifier = new Amplifier();
      amplifier.SIDC = sidc;
      if (useInteractivePlacement) {
        symbolEngine.drawMilSymbolInteractively(
          new DrawEssentials(),
          amplifier,
          options,
        );
      } else {
        symbolEngine.addMilSymbolAtCenter(options);
        appConfig.activeView.goTo(appConfig.activeView.center);
      }
    });
  });
}

// Initialize autocomplete functionality
console.log('Checking autocomplete elements:', {
  symbolSearchInput: !!symbolSearchInput,
  autocompleteList: !!autocompleteList,
  symbolDetails: !!symbolDetails,
  symbolDetailsContent: !!symbolDetailsContent,
});

if (
  symbolSearchInput &&
  autocompleteList &&
  symbolDetails &&
  symbolDetailsContent
) {
  console.log('Initializing autocomplete functionality...');
  initializeAutocomplete();
} else {
  console.error('Some autocomplete elements are missing!');
}

appConfig.sceneView.when(() => {
  console.log('3D Map is loaded');
});

appConfig.mapView.when(() => {
  console.log('2D Map is loaded');
  // Instantiate the PlotPoint class
  //const plotter = new PlotPoint(appConfig.mapView);
  //plotter.plotAtCenter();
});

if (switchButton) {
  switchButton.addEventListener('click', () => {
    switchView();
  });
}

// Switches the view from 2D to 3D and vice versa
function switchView() {
  const is3D = appConfig.activeView.type === '3d';
  const activeViewpoint = appConfig.activeView.viewpoint.clone();

  // Compute scale conversion factor with cosine of latitude
  const latitude = appConfig.activeView.center.latitude;
  const scaleConversionFactor = Math.cos((latitude * Math.PI) / 180.0);

  // Remove reference to container for the previous view
  appConfig.activeView.container = null;

  if (is3D) {
    activeViewpoint.scale /= scaleConversionFactor;

    // Switch to 2D view
    appConfig.mapView.viewpoint = activeViewpoint;
    appConfig.mapView.container = appConfig.container;
    appConfig.activeView = appConfig.mapView;
    (switchButton as HTMLInputElement).value = '3D';
  } else {
    activeViewpoint.scale *= scaleConversionFactor;

    // Switch to 3D view
    appConfig.sceneView.viewpoint = activeViewpoint;
    appConfig.sceneView.container = appConfig.container;
    appConfig.activeView = appConfig.sceneView;
    VisualizationEngine.getInstance().applyRenderSettings(
      appConfig.sceneView,
      (window as any).symbolEngine?.settings ?? settingsData,
    );
    (switchButton as HTMLInputElement).value = '2D';
  }
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

// Compatibility shim — `index.html` calls `window.applyRenderSettings(...)`
// whenever a render-bound setting changes. Delegate to VisualizationEngine,
// which owns the actual SceneView mutations (lift, drop lines, quality,
// shadows, atmosphere). The settings argument may be either the full settings
// tree or a bare render block — the engine normalises both.
(window as any).applyRenderSettings = (settings: any = settingsData): void => {
  if (!appConfig.sceneView) return;
  VisualizationEngine.getInstance().applyRenderSettings(appConfig.sceneView, settings);
};


// Auto-run test when page loads (optional)
window.addEventListener('load', () => {
  /*
  setTimeout(() => {
    console.log('Auto-running milsymbol.js test...');
    //testMilSymbol();
  }, 2000); // Wait 2 seconds for everything to load
  */
});

/**
 * Initialize autocomplete functionality for symbol search
 */
function initializeAutocomplete() {
  console.log('initializeAutocomplete function called');

  let allSymbols: Array<{ key: string; name: string }> = [];
  let filteredSymbols: Array<{ key: string; name: string }> = [];
  let selectedIndex = -1;

  // Get all symbols from SymbolEngine
  allSymbols = symbolEngine.getSymbolNamesForAutocomplete();
  console.log(`Loaded ${allSymbols.length} symbols for autocomplete`);

  // Handle input changes
  symbolSearchInput.addEventListener('input', (e) => {
    console.log('Input event triggered:', (e.target as HTMLInputElement).value);
    const searchTerm = (e.target as HTMLInputElement).value.toLowerCase();

    if (searchTerm.length === 0) {
      hideAutocompleteList();
      return;
    }

    // Filter symbols based on search term
    filteredSymbols = allSymbols.filter((symbol) =>
      symbol.name.toLowerCase().includes(searchTerm),
    );

    console.log('Filtered symbols:', filteredSymbols.length);
    showAutocompleteList(filteredSymbols);
  });

  // Handle keyboard navigation
  symbolSearchInput.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, filteredSymbols.length - 1);
        updateSelectedItem();
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        updateSelectedItem();
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < filteredSymbols.length) {
          selectSymbol(filteredSymbols[selectedIndex]);
        }
        break;
      case 'Escape':
        hideAutocompleteList();
        break;
    }
  });

  // Handle focus/blur
  symbolSearchInput.addEventListener('focus', () => {
    if (symbolSearchInput.value.length > 0) {
      const searchTerm = symbolSearchInput.value.toLowerCase();
      filteredSymbols = allSymbols.filter((symbol) =>
        symbol.name.toLowerCase().includes(searchTerm),
      );
      showAutocompleteList(filteredSymbols);
    }
  });

  symbolSearchInput.addEventListener('blur', (e) => {
    console.log('=== Input blur event fired ===');
    console.log('Blur event target:', e.target);
    console.log('Related target:', e.relatedTarget);

    // Check if the blur is caused by clicking on an autocomplete item
    if (
      e.relatedTarget &&
      e.relatedTarget.classList &&
      e.relatedTarget.classList.contains('autocomplete-item')
    ) {
      console.log(
        'Blur caused by clicking on autocomplete item - not hiding list',
      );
      return;
    }

    // Delay hiding to allow for clicks on autocomplete items
    setTimeout(() => {
      console.log('Hiding autocomplete list after blur timeout');
      hideAutocompleteList();
    }, 200);
  });

  function showAutocompleteList(symbols: Array<{ key: string; name: string }>) {
    console.log('=== showAutocompleteList function called ===');
    console.log('Symbols to display:', symbols);

    if (symbols.length === 0) {
      hideAutocompleteList();
      return;
    }

    autocompleteList.innerHTML = '';
    symbols.forEach((symbol, index) => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = symbol.name;
      item.dataset.key = symbol.key;
      item.dataset.index = index.toString();

      console.log(`Creating item ${index}:`, symbol.name, symbol.key);

      item.addEventListener('click', (e) => {
        console.log('=== Click event fired on autocomplete item ===');
        console.log('Event:', e);
        console.log('Target:', e.target);
        console.log('Symbol:', symbol);
        console.log('Selected symbol key:', symbol.key);
        e.preventDefault();
        e.stopPropagation();
        selectSymbol(symbol);
      });

      // Prevent blur when clicking on autocomplete items
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });

      item.addEventListener('mouseenter', () => {
        selectedIndex = index;
        updateSelectedItem();
      });

      autocompleteList.appendChild(item);
    });

    autocompleteList.style.display = 'block';
    selectedIndex = -1;
    console.log('Autocomplete list displayed with', symbols.length, 'items');
  }

  function hideAutocompleteList() {
    autocompleteList.style.display = 'none';
    selectedIndex = -1;
  }

  function updateSelectedItem() {
    const items = autocompleteList.querySelectorAll('.autocomplete-item');
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    });
  }

  function selectSymbol(symbol: { key: string; name: string }) {
    console.log('=== selectSymbol function called ===');
    console.log('Symbol object:', symbol);

    symbolSearchInput.value = symbol.name;
    hideAutocompleteList();

    // Log the selected JSON key to console
    console.log('Selected symbol key:', symbol.key);
    console.log('Selected symbol name:', symbol.name);

    // Step 1: Extract parts from the 8-character key
    const symbolSet = symbol.key.slice(0, 2); // positions 5–6
    const symbolId = symbol.key.slice(2); // becomes positions 11–16 or more

    // Step 2: Define static/default values for remaining SIDC parts
    const codingScheme = '10'; // positions 1–2 (Warfighting)
    const standardIdentity = '03'; // positions 3–4 (Friendly)
    const status = '0'; // position 7 (Present)
    const hqModifier = '0'; // position 8 (None)
    const amplifier1 = '22'; // positions 9–10 (Default)
    const modifiers = '0000'; // positions 17–20 (sector modifiers or padding)

    // Step 3: Pad symbolId to 10 digits (entity + type + subtype + modifiers)
    const paddedEntityCode = symbolId.padEnd(10, '0');

    // Step 4: Combine all into 20-character SIDC
    const fullSIDC =
      codingScheme +
      standardIdentity +
      symbolSet +
      status +
      hqModifier +
      amplifier1 +
      paddedEntityCode;

    console.log('Full SIDC:', fullSIDC);

    // Get and display symbol details
    console.log('Calling symbolEngine.getSymbolByKey with key:', symbol.key);
    const symbolData = symbolEngine.getSymbolByKey(symbol.key);
    console.log('Symbol data returned:', symbolData);

    if (symbolData) {
      console.log('Displaying symbol details...');
      displaySymbolDetails(symbol.key, symbolData);
    } else {
      console.error('No symbol data found for key:', symbol.key);
    }

    // Reflect this symbol in the per-symbol pen-paradigm override control.
    updateStylusPerSymbolUI(symbolData?.Class ?? null);

    var amplifier = new Amplifier();
    /*
    amplifier.DTG = "DDHHMMSSZMONYYYY";
    amplifier.EDTG = "DDHHMMSSZMONYYYY00";
    */
    //amplifier.UNIQUE_DESIG = "Tact";
    amplifier.UNIQUE_DESIG = 'Unique Designation';
    amplifier.HIGHER_FORM = 'Higher Formation';
    amplifier.STAFF_COM = 'Staff Comments';
    amplifier.ADDL_INFO = 'Additional Information';
    amplifier.TARGET_DESIGNATOR = 'Target Designator';
    amplifier.SIDC = fullSIDC;

    amplifier.SIZE = 60;
    //amplifier.SIZE = 10;

    var drawEssentials = new DrawEssentials();

    drawEssentials.uniqueDesignation = 'FORCE 123456';
    drawEssentials.infoFields = true;

    /*
    drawEssentials.BK_LN_DIST_RATIO = 5;
    drawEssentials.BK_LN_ANGL_RATIO = 5;
    drawEssentials.FRNT_LN_ANGL_RATIO = 5;
    drawEssentials.FRNT_LN_DIST_RATIO = 5;
    drawEssentials.IS_LINE = false;
    */
    //drawEssentials.SIZE = 150;
    //drawEssentials.ANGLE = 90;

    ///// Arrow Baseline Points Solution
    //drawEssentials.CTRL_PTS = JSON.parse('[{"type":"point","x":8819915.220430773,"y":3581686.454192736,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}]');
    //drawEssentials.BASE_LN_PTS = JSON.parse('{"startPt":{"type":"point","x":7794436.048956899,"y":3664238.4447407224,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},"endPt":{"type":"point","x":7787098.094241522,"y":3622656.7013535886,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},"midPt":{"type":"point","x":7790767.071599211,"y":3643447.5730471555,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}}');
    //drawEssentials.GEOM = JSON.parse('[[[7792031.774549957,3664521.7816224727],[7789502.368648464,3622373.3644718383]],[[7792031.774549957,3664521.7816224727],[8718265.108498363,3615112.886538937]],[[7789502.368648464,3622373.3644718383],[8715735.70259687,3572964.469388303]],[[8718265.108498363,3615112.886538937],[8721353.164441084,3673002.4699107124],[8819915.220430773,3581686.454192736],[8712647.646654148,3515074.8860165277],[8715735.70259687,3572964.469388303]]]');

    //Arc of Fire
    //drawEssentials.CTRL_PTS = JSON.parse('[{"type":"point","x":7498633.595835771,"y":2916917.768568486,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7513921.001492799,"y":2904993.592156004,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7491601.389233539,"y":2901630.362911458,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7562840.699595288,"y":2978678.8874228783,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}]');
    //drawEssentials.GEOM = JSON.parse('[[[7513921.001492799,2904993.592156004],[7513823.4725035215,2904167.9919094937],[7513667.035801823,2903351.5023326157],[7513452.49563683,2902548.3210402587],[7513180.954970558,2901762.5772287343],[7512853.809807533,2900998.3104473697],[7512472.742017854,2900259.4498309763],[7512039.710690618,2899549.793899965],[7511556.942062137,2898872.991031958],[7511026.918070748,2898232.5207052906],[7510452.363597039,2897631.6756108375],[7509836.232455093,2897073.5447241156],[7509181.692206785,2896560.9974247054],[7508492.107877179,2896096.6687446213],[7507771.024654761,2895682.9458214766],[7507022.149665446,2895321.9556260873],[7506249.332914052,2895015.5540276053],[7505456.5474912245,2894765.316252399],[7504647.869147576,2894572.5287857344],[7503827.455340044,2894438.1827578885],[7502999.523858186,2894362.9688486964],[7502168.3311403105,2894347.273736732],[7501338.15039091,2894391.1781113725],[7500513.249611893,2894494.4562579705],[7499697.869660568,2894656.577218266],[7498896.202447183,2894876.7075200677],[7498112.369384091,2895153.715462178],[7497350.400197364,2895486.1769325268],[7496614.212209761,2895872.382729604],[7495907.59020157,2896310.3473495534],[7495234.16695286,2896797.8191937506],[7494597.404567171,2897332.2921443847],[7494000.576672661,2897911.018448542],[7493446.751592217,2898531.022844542],[7492938.776569047,2899189.1178579126],[7492479.263128859,2899881.920188361],[7492070.57365387,2900605.868103491],[7491714.80923768,2901357.239749856],[7491413.798883443,2902132.172287197],[7491169.090100861,2902926.6817475026],[7490981.940950367,2903736.6835167953],[7490853.313575363,2904558.01333434],[7490783.869255797,2905386.4487013225],[7490773.965008485,2906217.730588936],[7490823.651751673,2907047.585334261],[7490932.674043258,2907871.746611394],[7491100.471394036,2908685.977364842],[7491326.181149201,2909486.091592444],[7491608.642923297,2910267.975865826],[7491946.404565826,2911027.6104777446],[7492337.729626818,2911761.09010761],[7492780.60628402,2912464.6438989397],[7493272.757685768,2913134.654845525],[7493811.653656409,2913767.6783866477],[7494394.523704054,2914360.4601157405],[7495018.371263824,2914909.9525114624],[7495679.989103347,2915413.3306051595],[7496375.975811296,2915868.006504175],[7497102.75328423,2916271.6426963387],[7497856.585121797,2916622.164067238],[7498633.595835771,2916917.7685684855],[7498633.595835771,2916917.7685684855],[7562840.699595288,2978678.8874228783],[7513921.001492799,2904993.592156004],[7513921.001492799,2904993.592156004]]]');

    //Contain
    //drawEssentials.BASE_LN_PTS = JSON.parse('{"startPt":{"type":"point","x":7794436.048956899,"y":3664238.4447407224,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},"endPt":{"type":"point","x":7787098.094241522,"y":3622656.7013535886,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},"midPt":{"type":"point","x":7790767.071599211,"y":3643447.5730471555,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}}');
    //drawEssentials.CTRL_PTS = JSON.parse('[{"type":"point","x":8073239.969971516,"y":3742974.669378808,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":8070029.614783538,"y":3712246.9840081553,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":8134848.214769392,"y":3718056.1981578306,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":8012396.095456493,"y":3728298.7599480483,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7964240.767636813,"y":3762083.926450109,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}]');

    //LINE GEOM AND CTRL PTS -------------------------------------------------------------------------------------------------------------------------------------------

    /*
    drawEssentials.GEOM = new Polyline(JSON.parse('[[[7459705.494615135,3528604.534230706],[8132962.839750933,3978054.26054752],[8272995.475569369,3706549.9360785875]]]'));

    drawEssentials.CTRL_PTS = JSON.parse('[' +
        '{"type":"point","x":7459705.494615135,"y":3528604.534230706,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},' +
        '{"type":"point","x":8132962.839750933,"y":3978054.26054752,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},' +
        '{"type":"point","x":8272995.475569369,"y":3706549.9360785875,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}' +
        ']');
  */

    //Delay
    //drawEssentials.CTRL_PTS = JSON.parse('[{"type":"point","x":7752523.350128699,"y":3631470.601367953,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7750383.113336716,"y":3587442.873075712,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7736624.44824539,"y":3588665.8655282743,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7956151.593480311,"y":3589888.8579808366,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}]');

    //Isolate
    //drawEssentials.BASE_LN_PTS = JSON.parse('{"startPt":{"type":"point","x":7794436.048956899,"y":3664238.4447407224,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},"endPt":{"type":"point","x":7787098.094241522,"y":3622656.7013535886,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},"midPt":{"type":"point","x":7790767.071599211,"y":3643447.5730471555,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}}');
    //drawEssentials.CTRL_PTS = JSON.parse('[{"type":"point","x":8073239.969971516,"y":3742974.669378808,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":8070029.614783538,"y":3712246.9840081553,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":8134848.214769392,"y":3718056.1981578306,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":8012396.095456493,"y":3728298.7599480483,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7964240.767636813,"y":3762083.926450109,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}]');

    // Step 1: Convert the hardcoded GEOM array into a proper Polyline
    const rawPath = JSON.parse(
      '[[[7459705.494615135,3528604.534230706],[8132962.839750933,3978054.26054752],[8272995.475569369,3706549.9360785875]]]',
    );
    //drawEssentials.GEOM = rawPath; // <--Working

    /*
    drawEssentials.GEOM = new Polyline({
      paths: rawPath,
      spatialReference: appConfig.activeView.spatialReference
    });
    */

    //GeoTools.displayPolyline(appConfig.activeView, drawEssentials.GEOM)

    const rawPoly = JSON.parse(`[{
    "type":"point",
    "x":7459705.494615135,
    "y":3528604.534230706,
    "spatialReference":{"wkid":102100,"latestWkid":3857}
},
{
    "type":"point",
    "x":8132962.839750933,
    "y":3978054.26054752,
    "spatialReference":{"wkid":102100,"latestWkid":3857}
},
{
    "type":"point",
    "x":8272995.475569369,
    "y":3706549.9360785875,
    "spatialReference":{"wkid":102100,"latestWkid":3857}
}]`);

    //drawEssentials.CTRL_PTS = rawPoly; // <--Working

    //AREA GEOM AND CTRL PTS -------------------------------------------------------------------------------------------------------------------------------------------

    //const rawPolygon = JSON.parse('[[[7443405.995866349,3488487.2451935397],[7431392.425586601,3485332.1799794533],[7418436.010378483,3481144.9956318866],[7404668.232745316,3475984.5944062434],[7390335.7961438615,3469960.7522655195],[7378275.247584642,3464437.997506145],[7365926.054760581,3458388.9469121625],[7353357.292186632,3451844.5448649097],[7340638.034377749,3444835.7357457215],[7327962.44684212,3437468.0866297428],[7316085.782221778,3430213.844117836],[7304252.926245097,3422638.2148442753],[7292518.871990751,3414765.834911081],[7280938.612537417,3406621.3404202736],[7269567.140963771,3398229.367473874],[7258165.451298598,3389380.476674634],[7247046.807114448,3380277.3141531926],[7236329.679966002,3370990.8392163864],[7226074.512967665,3361548.129503236],[7216341.749233844,3351976.2626527604],[7206301.598635803,3341319.6824307796],[7196715.6284093,3330168.2132922257],[7188067.8235170115,3318962.78586126],[7180448.373015765,3307743.8035278823],[7173642.99142739,3295973.632538993],[7167365.9867410315,3282235.5853009857],[7163115.42031746,3268680.019461578],[7161061.884463602,3255383.3579012225],[7161288.440958511,3242630.3732473087],[7163481.816183315,3229629.256990722],[7167493.460473816,3216115.5457974523],[7173206.329721701,3202181.4235197613],[7179992.808977921,3188836.972140784],[7186660.011529011,3177518.661611206],[7194173.881646882,3166096.4035578286],[7202478.356687263,3154614.3528773948],[7211517.374005882,3143116.6644666474],[7221234.870958467,3131647.4932223284],[7230571.580144088,3121324.70218007],[7240121.026785126,3111354.092454802],[7250076.964759283,3101501.498500587],[7260400.890359576,3091797.2458082773],[7271054.299879025,3082271.6598687246],[7281998.689610646,3072955.0661727805],[7293126.339963569,3063932.5548358466],[7304414.928856026,3055214.381997451],[7315875.94043537,3046789.403171528],[7327472.073887453,3038686.996451431],[7339166.028398126,3030936.539930515],[7350920.503153242,3023567.411702134],[7363071.364984011,3016395.536068183],[7376102.169936748,3009216.625398665],[7389063.49269572,3002619.1295738444],[7401904.590394459,2996643.013637438],[7414574.720166499,2991328.2426331635],[7427023.139145375,2986714.781604739],[7441072.9466569815,2982307.3320716294],[7455792.982042832,2978722.175000973],[7469893.698733545,2976451.2473656125],[7483275.356602679,2975573.1044146135],[7495805.738581659,2976162.1082013045],[7507935.826180548,2978179.091719678],[7520643.838084766,2981577.1273393715],[7533861.8436510535,2986286.1466104263],[7547521.91223615,2992236.081082883],[7561556.113196798,2999356.862306783],[7573934.8486007415,3006400.6415213402],[7585145.134515224,3013347.900684238],[7596471.588821363,3020882.438276048],[7607882.992491875,3028972.052793206],[7619348.126499476,3037584.5427321503],[7630835.771816882,3046687.706589316],[7642314.709416811,3056249.3428611406],[7653197.028384803,3065740.552172537],[7663407.9595034355,3075024.8973860308],[7673540.232598838,3084604.675743374],[7683571.275493597,3094456.604710976],[7693478.516010297,3104557.401755246],[7703239.381971527,3114883.7843425917],[7712831.30119987,3125412.469939422],[7722231.701517915,3136120.1760121463],[7731513.88756182,3147099.1971789175],[7740631.889298593,3158310.7424507537],[7749479.803073176,3169635.0102053634],[7758033.71816769,3181047.3372442406],[7766269.72386425,3192523.060368879],[7774163.909444977,3204037.5163807734],[7781692.364191988,3215566.0420814166],[7788831.177387401,3227083.9742723037],[7796338.640675789,3239948.294706925],[7803513.173848867,3253154.535544302],[7810060.444320678,3266238.216640954],[7815943.353408685,3279161.0718027777],[7821124.802430359,3291884.834835669],[7825567.692703165,3304371.239545525],[7829279.939836127,3316748.4451138466],[7832831.921911287,3332249.9198484328],[7834906.37232566,3347126.462323787],[7835420.014796255,3361292.175516307],[7834289.573040084,3374661.1624023905],[7831431.770774157,3387147.5259584365],[7826271.592770697,3399478.9439382553],[7818761.773533885,3411058.151588546],[7809106.90639157,3421828.3849126487],[7797555.9536395045,3431754.1998092122],[7786924.205197951,3439212.569437212],[7775238.001004265,3446173.9755105358],[7762592.88367338,3452645.924658343],[7749084.395820231,3458635.9235097924],[7735207.606361438,3464006.984839505],[7722408.690200325,3468385.876536378],[7709171.710987649,3472424.3097361554],[7695557.367732844,3476127.053462108],[7681626.359445347,3479498.876737509],[7667439.385134592,3482544.54858563],[7653388.842477357,3485209.9039607057],[7639456.281469617,3487534.3071845802],[7625452.118065462,3489571.0141550144],[7611430.061593029,3491324.2447272935],[7597443.821380454,3492798.2187567046],[7583547.106755875,3493997.156098533],[7569008.353958271,3494970.49344085],[7554392.865384245,3495657.094373501],[7540078.291302513,3496038.390881057],[7526132.271392491,3496119.6973040365],[7512622.445333591,3495906.327982957],[7498626.130901911,3495352.4259874118],[7483105.437033223,3494286.3289441518],[7468638.02980164,3492779.657064555],[7455359.639361302,3490843.0744479187],[7443405.995866349,3488487.2451935397]]]');

    //Working for Lines
    //Freehand - Arrow  -- Line solution -- Working
    //drawEssentials.GEOM = JSON.parse('[[[7440152.664026581,3387766.4129998223],[7444163.174728697,3398597.4047426144],[7448121.95234597,3409277.6888287137],[7452032.926455948,3419806.9084322993],[7455900.026636179,3430184.706727551],[7459727.182464213,3440410.7268886482],[7463518.323517601,3450484.612089772],[7467277.37937389,3460406.0055051004],[7471008.27961063,3470174.5503088143],[7475148.941752206,3480909.2617632784],[7479292.299614414,3491522.04846089],[7483416.150821622,3501939.943176853],[7487526.08949822,3512162.4379359456],[7491627.709768598,3522189.0247629476],[7495726.605757144,3532019.1956826374],[7499828.371588249,3541652.4427197943],[7504354.769439134,3552031.06194151],[7509019.9920974625,3562435.845473394],[7513711.978482167,3572586.923176649],[7518438.807870589,3582483.5614114045],[7523208.559540068,3592125.02653779],[7528029.312767945,3601510.5849159355],[7533181.704474733,3611138.323071109],[7538766.289474563,3621101.3019132065],[7544448.296312634,3630736.326249064],[7550239.287547101,3640042.346139027],[7556150.825736118,3649018.3116434393],[7562194.473437837,3657663.1728226463],[7568899.343660081,3666647.2313261996],[7575910.2488474855,3675388.487148571],[7583126.154127727,3683723.8756800313],[7590562.516958701,3691651.9933040277],[7598234.794798306,3699171.436404009],[7606393.391310585,3706481.9119689725],[7614936.109752386,3713434.7673398466],[7623786.069849716,3719939.85706383],[7632960.722351115,3725995.596523343],[7642477.518005126,3731600.401100808],[7652061.0208245255,3736652.6817867267],[7661806.575395454,3741321.5506232576],[7671773.583789642,3745647.8559025396],[7681964.313074588,3749638.0781007954],[7692381.030317785,3753298.697694249],[7703026.002586731,3756636.1951591237],[7713901.496948919,3759657.0509716435],[7724673.652503248,3762290.9968009572],[7734920.163129382,3764489.8458338073],[7745360.715703537,3766444.7408881793],[7755996.989326718,3768160.4817215344],[7766830.663099928,3769641.868091334],[7777863.41612417,3770893.69975504],[7789096.927500446,3771920.776470112],[7800532.876329761,3772727.8979940126],[7812116.321868522,3773317.518243736],[7822432.716829612,3773662.7105588936],[7832906.6788419075,3773851.140094127],[7843539.320989612,3773885.9886319414],[7854331.756356923,3773770.4379548407],[7865285.098028042,3773507.669845329],[7876400.45908717,3773100.8660859116],[7887678.952618504,3772553.2084590914],[7899121.691706248,3771867.878747374],[7910729.789434599,3771048.0587332626],[7921651.444110079,3770169.6925443974],[7931996.906841612,3769248.067577394],[7942469.29488976,3768231.8205746887],[7953069.336140344,3767123.032218383],[7963797.758479185,3765923.7831905787],[7974655.289792107,3764636.1541733774],[7985642.65796493,3763262.225848881],[7996760.590883476,3761804.0788991908],[8008009.816433567,3760263.794006408],[8019391.0625010235,3758643.451852636],[8030905.056971669,3756945.1331199743],[8041663.359459473,3755308.26224209],[8051959.187754632,3753699.550834357],[8062358.274704284,3752035.5642131628],[8072861.108382562,3750317.6975521496],[8083468.1768636,3748547.3460249603],[8094179.96822153,3746725.904805236],[8104996.970530487,3744854.7690666197],[8115919.671864601,3742935.3339827526],[8126948.560298008,3740968.9947272777],[8138084.12390484,3738957.146473837],[8149326.85075923,3736901.1843960728],[8160677.228935311,3734802.5036676265],[8171985.22480874,3732690.7410087604],[8182218.59683924,3730763.3282593554],[8192537.436117143,3728805.5765568875],[8202942.081274396,3726818.453890292],[8213432.870942939,3724802.9282485056],[8224010.143754714,3722759.9676204626],[8234674.238341666,3720690.5399951],[8245425.493335735,3718595.613361352],[8256264.247368865,3716476.1557081556],[8267190.839072999,3714333.135024446],[8278205.607080078,3712167.519299159],[8289308.890022045,3709980.276521229],[8300501.026530843,3707772.374679594],[8311782.355238414,3705544.7817631876],[8323153.214776702,3703298.4657609463]],[[8254575.380901572,3767248.330424147],[8323153.214776702,3703298.4657609463],[8249363.611897673,3645440.02647676]]]');
    //drawEssentials.CTRL_PTS = JSON.parse('[{"type":"point","x":7440152.664026581,"y":3387766.4129998223,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7644392.403604518,"y":3732650.2846224457,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":8323153.214776702,"y":3703298.4657609463,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}]');

    const rawPolygon = JSON.parse(
      '[[[4265573.298979523,3601968.7258994896],[3791052.2273852737,2814361.5864492427],[5698920.453382766,2237109.148839745],[6589258.958848262,3509021.2995047397],[4265573.298979523,3601968.7258994896]]]',
    );
    //drawEssentials.GEOM = rawPolygon;  //Working for Area

    const rawPts = JSON.parse(
      '[{"type":"point","x":7443405.995866349,"y":3488487.2451935397,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7160894.739324412,"y":3250003.716943853,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7494771.678873974,"y":2976053.407569854,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7831094.60332866,"y":3388201.864083415,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}]',
    );
    //drawEssentials.CTRL_PTS = rawPts;  //Working for Area

    //Ambush
    //drawEssentials.GEOM = JSON.parse('[[[7660068.599573985,2904076.347816583],[7660901.225935073,2905054.98740112],[7661703.837399798,2906058.390077164],[7662475.6979074385,2907085.635641937],[7663216.099598426,2908135.7820267724],[7663924.363463519,2909207.8661610666],[7664599.839966501,2910300.904855496],[7665241.909639866,2911413.8957036817],[7665849.983652917,2912545.8180014803],[7666423.504351772,2913695.6336830505],[7666961.945770784,2914862.288272847],[7667464.814114888,2916044.711852661],[7667931.648212453,2917241.820042822],[7668362.019938219,2918452.5149966655],[7668755.534605917,2919675.6864073467],[7669111.831330232,2920910.212526083],[7669430.583357766,2922154.961190892],[7669711.498366695,2923408.7908648746],[7669954.31873485,2924670.551683101],[7670158.821775983,2925939.086507127],[7670324.819943989,2927213.231986191],[7670452.161004893,2928491.8196240985],[7670540.728176469,2929773.6768508283],[7670590.440235338,2931057.6280978792],[7670601.251591453,2932342.4958763607],[7670573.1523299115,2933627.1018568473],[7670506.168220046,2934910.2679500035],[7670400.360691796,2936190.81738699],[7670255.8267793665,2937467.5757986554],[7670072.6990322415,2938739.3722925307],[7669851.145393627,2940005.040526634],[7669591.369046431,2941263.4197791005],[7669293.608226928,2942513.356012662],[7668958.13600628,2943753.7029329925],[7668585.260040102,2944983.3230399555],[7668175.322286323,2946201.088670784],[7667728.698691578,2947405.8830342414],[7667245.798846435,2948596.6012348086],[7666727.065609768,2949772.1512859664],[7666172.974702617,2950931.455111637],[7665584.034271915,2952073.4495348656],[7664960.784424474,2953197.0872528446],[7664303.796731662,2954301.3377973745],[7663613.673705227,2955385.188479888],[7662891.048244742,2956447.645320168],[7662136.583057186,2957487.7339579137],[7661350.970049186,2958504.5005463017],[7660534.929692483,2959497.012626748],[7659689.210363196,2960464.359984047],[7658814.587655509,2961405.655481113],[7657911.863670374,2962320.035872561],[7656981.866279931,2963206.6625963678],[7656025.448368272,2964064.7225429094],[7655043.4870492825,2964893.428800645],[7654036.882862252,2965692.0213777786],[7653006.558946007,2966459.767899239],[7651953.460192317,2967195.9642783236],[7650878.552379349,2967899.935362404],[7649782.821285973,2968571.0355521003],[7648667.271787719,2969208.6493933434]],[[7669851.145393627,2940005.040526634],[7865837.079717581,2978984.6355360188],[7855135.895757661,3039522.761937849]],[[7663924.363463519,2909207.8661610666],[7656850.304515758,2906879.678774651]],[[7666961.945770784,2914862.288272847],[7659887.886823023,2912534.1008864315]],[[7669111.831330232,2920910.212526083],[7662037.772382471,2918582.0251396676]],[[7670324.819943989,2927213.231986191],[7663250.760996227,2924885.0445997757]],[[7670573.1523299115,2933627.1018568473],[7663499.09338215,2931298.914470432]],[[7669851.145393627,2940005.040526634],[7662777.086445865,2937676.8531402186]],[[7668175.322286323,2946201.088670784],[7661101.263338561,2943872.9012843687]],[[7665584.034271915,2952073.4495348656],[7658509.975324154,2949745.26214845]],[[7662136.583057186,2957487.7339579137],[7655062.524109424,2955159.5465714983]],[[7657911.863670374,2962320.035872561],[7650837.804722613,2959991.8484861455]],[[7653006.558946007,2966459.767899239],[7645932.499998245,2964131.5805128235]],[[7852015.719270714,3034225.7533901706],[7855135.895757661,3039522.761937849],[7859886.4039017875,3035620.650555985]]]');
    //drawEssentials.CTRL_PTS = JSON.parse('[{"type":"point","x":7647532.926935223,"y":2969812.192141802,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7660068.599573986,"y":2904076.3478165823,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7668935.294855062,"y":2920280.997813032,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7865837.079717581,"y":2978984.6355360188,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7855135.895757661,"y":3039522.761937849,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}]');

    //Attk by Fire Posn

    //drawEssentials.GEOM = JSON.parse('[[[7310977.435454015,3207945.927911165],[7451191.905360438,3057028.0633553974]],[[7381084.670407226,3132486.9956332813],[7898410.477841162,3613123.029490342]],[[7827853.132163578,3610289.153747818],[7898410.477841162,3613123.029490342],[7890416.7197449505,3542962.715121823]],[[7310977.435454015,3207945.927911165],[7188286.832612946,3132511.7534371107]],[[7451191.905360438,3057028.0633553974],[7366952.185227933,2940207.824286628]]]');
    //drawEssentials.CTRL_PTS = JSON.parse('[{"type":"point","x":7898410.477841162,"y":3613123.029490342,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}]');
    //drawEssentials.BASE_LN_PTS = JSON.parse('{"startPt":{"type":"point","x":7311374.100611164,"y":3208312.527692156,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},"endPt":{"type":"point","x":7450795.240203288,"y":3056661.4635744067,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},"midPt":{"type":"point","x":7381084.670407226,"y":3132486.9956332813,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}}');

    //drawEssentials.GEOM = new Point(68.99174366565728 , 27.709813703606667, map.spatialReference);

    /* //Uncomment to test passive functionality
    drawEssentials.GEOM = new Point({
      longitude: appConfig.activeView.center.longitude,
      latitude: appConfig.activeView.center.latitude,
      spatialReference: appConfig.activeView.spatialReference
    });
  */

    //Clear Symbol

    //z.OPTIONS.GEOM = new Point(z.GEOM.x, z.GEOM.y, z.spatialReference);

    //drawEssentials.HEAD_RATIO = 0.17;
    //drawEssentials.TAIL_FACTOR = 0.17;

    drawEssentials.ECHELON = amplifier.getEchelon(fullSIDC);

    //drawEssentials.TEETH_SIZE = 2;

    // Set default draw type from Parameters if available
    const drawTypesSelect = document.getElementById(
      'drawTypesSelectPre',
    ) as HTMLSelectElement;
    const selectedValue = parseInt(drawTypesSelect.value);
    console.log('DRAW_TYPE updated to:', selectedValue);
    drawEssentials.DRAW_TYPE = selectedValue;

    //drawEssentials.DRAW_TYPE = 1;
    //drawEssentials.FACE_GAP = 0;
    //drawEssentials.TEETH_GAP = 5;
    //drawEssentials.TEETH_SIZE = 2;

    //drawEssentials.WIDTH = 150;
    //drawEssentials.HEIGHT = 150;

    //drawEssentials.uniqueDesignation = "JHHHH";

    //drawEssentials.size = "30";

    //drawEssentials.GEOM = map.extent.getCenter();

    /*
    drawEssentials.TEETH_GAP = 30;
    drawEssentials.TEETH_SIZE = 3;
    drawEssentials.HEAD_RATIO = 10;
    drawEssentials.TAIL_FACTOR = 10;
    */

    drawEssentials.FLAP_ANGLE = 45;

    drawEssentials.BK_LN_DIST_RATIO = 5;
    drawEssentials.BK_LN_ANGL_RATIO = 5;
    drawEssentials.FRNT_LN_ANGL_RATIO = 0.8;
    drawEssentials.FRNT_LN_DIST_RATIO = 1.5;
    drawEssentials.FLAP_DIST_RATIO = 3;

    drawEssentials.extraSettings = {
      lineWidth: 3,
      size: 20,
      textSize: 12,
      opacity: 1,
    };

    //Destroy Measurement Engine
    /*
    measurementEngine.destroy(map);
    symDrawProgressEvent.remove();
    symDrawClickEvent.remove();
    */

    drawEssentials.labelOptions = {
      haloColor: [255, 0, 0],
      haloColorSize: 5,
      color: [0, 255, 0],
      textSize: 20,
      bold: 1,
      italic: 0,
      uLine: 0,
      oLine: 0,
      tLine: 0,
    };
    //var labelOptions = {'haloColor': [255,0,0], 'haloColorSize': 5, 'color': [0,255, 0]};
    //symEngine.initialize(drawEssentials, extraSettings, labelOptions);

    symbolEngine.initialize(drawEssentials, amplifier);

    /*
    if (useInteractivePlacement) {
      symbolEngine.drawMilSymbolInteractively(drawEssentials, amplifier, attr);
    } else {
      symbolEngine.addMilSymbolAtCenter(drawEssentials, amplifier, attr);
      appConfig.activeView.goTo(appConfig.activeView.center);
    }
    */

    console.log('=== selectSymbol function completed ===');
  }

  function displaySymbolDetails(key: string, data: any) {
    console.log('=== displaySymbolDetails function called ===');
    console.log('Key:', key);
    console.log('Data:', data);
    console.log('symbolDetailsContent element:', symbolDetailsContent);
    console.log('symbolDetails element:', symbolDetails);

    try {
      // Compact toast: symbol name headline + one muted meta line. The heavy
      // Description / Parameters / Tools dump was removed (it was display-only —
      // the draw type is read from #drawTypesSelectPre, not the old toast select).
      const meta = [data.Class, data.SymGeoType]
        .filter(Boolean)
        .concat(data.isFreeHand ? ['Freehand'] : [])
        .join(' · ');
      symbolDetailsContent.innerHTML = `
        <div class="toast-title">${data.Name || key || 'Symbol'}</div>
        <div class="toast-meta">${meta || 'N/A'}</div>
      `;

      // Show the popup with slide-in animation. Clear the inline display left by
      // the auto-vanish timeout below — otherwise the toast only ever shows once
      // (inline display:none beats the .show class rule on every later selection).
      symbolDetails.style.display = '';
      symbolDetails.classList.remove('fade-out');
      symbolDetails.classList.add('show');

      // Auto-vanish after 2 seconds with slide-out animation
      setTimeout(() => {
        symbolDetails.classList.remove('show');
        symbolDetails.classList.add('fade-out');

        // Hide after animation completes
        setTimeout(() => {
          symbolDetails.classList.remove('fade-out');
          symbolDetails.style.display = 'none';
        }, 300);
      }, 2000);
    } catch (error) {
      console.error('Error displaying symbol details:', error);
    }

    console.log('=== displaySymbolDetails function completed ===');
  }

  // Demo quick-pick menu: buttons that run the EXACT selectSymbol path above,
  // as if the name had been picked from the autocomplete list. Deferred one
  // microtask so the module finishes evaluating first — DEMO_SYMBOLS (const)
  // is declared below this function and is TDZ until the module body
  // completes; initializeAutocomplete is called synchronously at module top.
  queueMicrotask(() => initDemoQuickPick(allSymbols, selectSymbol));
}

// ── Demo quick-pick symbol menu (★ Demo button in the top bar) ──────────────
// Symbols offered for one-tap demo drawing. EDIT THIS LIST to change the menu:
// label = button text, name = the exact "Name" from MS/Data/Symbols.json.
// Unknown names are skipped with a console warning, never an error.
const DEMO_SYMBOLS: Array<{ label: string; name: string }> = [
  { label: 'Infantry', name: 'Inf' },
  { label: 'Main Attack', name: 'Main Attk' },
  { label: 'Strong Pt', name: 'Strong Pt' },
  { label: 'Barbed Wire', name: 'Wire Obs - Triple Strand Concertina' },
  { label: 'Freehand Line', name: 'Freehand - Line' },
  { label: 'Freehand Arrow', name: 'Freehand - Arrow' },
  { label: 'Freehand Area', name: 'Freehand - Area' },
  { label: 'Phase Line', name: 'Phase Line' },
  { label: 'Assembly Area', name: 'Assy Area / AA' },
  { label: 'Battle Position', name: 'Battle Posn' },
  { label: 'Objective', name: 'Obj Area' },
  { label: 'Attack Position', name: 'Attack Position' },
];

function initDemoQuickPick(
  symbols: Array<{ key: string; name: string }>,
  selectSymbol: (s: { key: string; name: string }) => void,
): void {
  const btn = document.getElementById('demoMenuBtn');
  const menu = document.getElementById('demoSymbolMenu');
  if (!btn || !menu) return;

  const hide = () => {
    menu.style.display = 'none';
    btn.classList.remove('ms-btn-active');
  };

  menu.innerHTML = '';
  for (const entry of DEMO_SYMBOLS) {
    const match = symbols.find(
      (s) => s.name.toLowerCase() === entry.name.toLowerCase(),
    );
    if (!match) {
      console.warn('[DemoMenu] symbol name not found in Symbols.json:', entry.name);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'demo-symbol-btn';
    b.textContent = entry.label;
    b.title = match.name;
    b.addEventListener('click', () => {
      hide();
      selectSymbol(match); // identical code path to an autocomplete pick
    });
    menu.appendChild(b);
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.style.display === 'grid') {
      hide();
    } else {
      menu.style.display = 'grid';
      btn.classList.add('ms-btn-active');
    }
  });
  // Tap anywhere else closes the menu.
  document.addEventListener('click', (e) => {
    if (menu.style.display === 'grid' && !menu.contains(e.target as Node)) hide();
  });
}


// ── Pen Style / Pen Mode menus (✒ / ✍ buttons in the top bar) ───────────────
// "Common Symbols"-style dropdowns for the two global stylus settings. The
// backing <select> in the Settings panel is the single source of truth: each
// menu reads its current value on open (to highlight the active option) and, on
// pick, sets that select's value and dispatches a native 'change' — the exact
// same code path as changing it in the panel, so index.html's settingMappings
// publishes the change to the SymbolEngine. No settings state is duplicated here.
type StylusChoice = { label: string; sub: string; value: string };

// Options mirror the <option>s of #setting-stylusParadigm in index.html.
const PEN_STYLES: StylusChoice[] = [
  { label: 'Scrub', sub: 'freehand gesture · live preview', value: 'scrub' },
  { label: 'Native', sub: 'symbol’s own live preview', value: 'native' },
  { label: 'Freehand', sub: 'press & drag, lift to finish', value: 'freehand' },
  { label: 'Tap to place', sub: 'tap each vertex, then finish', value: 'tap' },
];

// Options mirror the <option>s of #setting-stylusMode in index.html.
const PEN_MODES: StylusChoice[] = [
  { label: 'Auto-detect', sub: 'engages on pen / touch', value: 'auto' },
  { label: 'Always on', sub: 'force for any input', value: 'on' },
  { label: 'Off', sub: 'classic click / double-click', value: 'off' },
];

function initStylusChoiceMenu(
  btnId: string,
  menuId: string,
  selectId: string,
  items: StylusChoice[],
): void {
  const btn = document.getElementById(btnId);
  const menu = document.getElementById(menuId);
  const select = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!btn || !menu || !select) return;

  const hide = () => {
    menu.style.display = 'none';
    btn.classList.remove('ms-btn-active');
  };

  const render = () => {
    const cur = select.value; // read the source of truth
    menu.innerHTML = '';
    for (const p of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'demo-symbol-btn' + (p.value === cur ? ' is-active' : '');
      b.title = p.sub;
      const name = document.createElement('span');
      name.className = 'pen-style-name';
      name.textContent = p.label;
      const sub = document.createElement('span');
      sub.className = 'pen-style-sub';
      sub.textContent = p.sub;
      b.append(name, sub);
      b.addEventListener('click', () => {
        hide();
        select.value = p.value; // update the source of truth …
        select.dispatchEvent(new Event('change', { bubbles: true })); // … same path as the panel
      });
      menu.appendChild(b);
    }
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.style.display === 'grid') {
      hide();
    } else {
      render(); // rebuild each open so the active option is highlighted
      menu.style.display = 'grid';
      btn.classList.add('ms-btn-active');
    }
  });
  document.addEventListener('click', (e) => {
    if (menu.style.display === 'grid' && !menu.contains(e.target as Node)) hide();
  });
}
initStylusChoiceMenu('penStyleBtn', 'penStyleMenu', 'setting-stylusParadigm', PEN_STYLES);
initStylusChoiceMenu('penModeBtn', 'penModeMenu', 'setting-stylusMode', PEN_MODES);


// ── Stylus / pen per-symbol paradigm override (settings panel) ──────────────────
// The global Pen Mode / Draw Paradigm selects are wired via index.html's
// settingMappings. The per-symbol override has a dynamic key (the symbol Class),
// so it's wired here and targets the most-recently-selected symbol. Writes go
// straight to the live settings object the StylusDrawController reads at draw time.
let lastSelectedSymbolClass: string | null = null;
function updateStylusPerSymbolUI(cls: string | null): void {
  lastSelectedSymbolClass = cls;
  const sel = document.getElementById(
    'setting-stylusPerSymbol',
  ) as HTMLSelectElement | null;
  const label = document.getElementById('stylus-persymbol-label');
  if (!sel) return;
  if (!cls) {
    sel.disabled = true;
    sel.value = '';
    if (label) label.textContent = 'Per-symbol (none)';
    return;
  }
  sel.disabled = false;
  const cur = (window as any).symbolEngine?.settings?.stylus?.perSymbol?.[cls];
  sel.value =
    cur === 'native' || cur === 'freehand' || cur === 'tap' || cur === 'scrub'
      ? cur
      : '';
  if (label) label.textContent = `Per-symbol (${cls})`;
}
(function initStylusPerSymbolControl() {
  const sel = document.getElementById(
    'setting-stylusPerSymbol',
  ) as HTMLSelectElement | null;
  if (!sel) return;
  sel.addEventListener('change', () => {
    const cls = lastSelectedSymbolClass;
    const st = (window as any).symbolEngine?.settings?.stylus;
    if (!cls || !st) return;
    if (!st.perSymbol) st.perSymbol = {};
    const v = sel.value;
    if (v === 'native' || v === 'freehand' || v === 'tap' || v === 'scrub')
      st.perSymbol[cls] = v;
    else delete st.perSymbol[cls];
  });
})();


// ── Measurement Panel Controller ───────────────────────────────────────────────
// The MS library emits events; all DOM work lives here, not in the library.

(function initMeasurementPanel() {
  const panel = document.getElementById('measurePanel')!;
  // Optional: the top-bar measure button was removed; measurement still toggles
  // via the M key and the API Test panel. Guard every use so its absence is fine.
  const toggleBtn = document.getElementById('measureToggleBtn');
  const dataTable = document.getElementById(
    'measureDataTable',
  ) as HTMLTableElement;
  const idleHint = document.getElementById('measureIdle')!;
  const copyBtn = document.getElementById('measureCopyBtn')!;

  // Cell references
  const cells: Record<string, HTMLElement | null> = {
    seg: document.getElementById('ms-seg'),
    bng: document.getElementById('ms-bng'),
    total: document.getElementById('ms-total'),
    height: document.getElementById('ms-height'),
    width: document.getElementById('ms-width'),
    area: document.getElementById('ms-area'),
    road: document.getElementById('ms-road'),
  };

  // Row references (hide rows with no data)
  const rows: Record<string, HTMLElement | null> = {
    seg: document.getElementById('ms-row-seg'),
    bng: document.getElementById('ms-row-bng'),
    total: document.getElementById('ms-row-total'),
    height: document.getElementById('ms-row-height'),
    width: document.getElementById('ms-row-width'),
    area: document.getElementById('ms-row-area'),
    road: document.getElementById('ms-row-road'),
  };

  let lastSnap: Record<string, string> = {};

  // ── Toggle measurement on/off ───────────────────────────────────────────

  function applyState(isEnabled: boolean) {
    panel.classList.toggle('ms-on', isEnabled);
    if (toggleBtn) {
      toggleBtn.classList.toggle('ms-btn-active', isEnabled);
      toggleBtn.title = isEnabled
        ? 'Measurements ON  — click or press M to disable'
        : 'Measurements OFF — click or press M to enable';
    }
    if (!isEnabled) resetRows();
  }

  toggleBtn?.addEventListener('click', () => {
    panel.classList.add('ms-active'); // show panel on first click
    void symbolEngine.toggleMeasurement();
  });


  // ── Keyboard shortcut M ────────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'm' || e.key === 'M') {
      panel.classList.add('ms-active');
      void symbolEngine.toggleMeasurement();
    }
  });

  // ── Library events ─────────────────────────────────────────────────────

  document.addEventListener('measurement-state-change', (e: any) => {
    applyState(e.detail.isEnabled);
  });

  document.addEventListener('measurement-hint', (e: any) => {
    const d = e.detail;
    idleHint.textContent = d.message;
    idleHint.style.display = '';
  });

  document.addEventListener('proximity-state-change', (e: any) => {
    // Could add visual indicator for proximity state if needed
  });

  document.addEventListener('proximity-hint', (e: any) => {
    const d = e.detail;
    showToast(d.message, d.phase);
  });

  document.addEventListener('measurement-update', (e: any) => {
    const d = e.detail;
    lastSnap = d;
    idleHint.style.display = 'none';
    dataTable.style.display = '';

    const set = (key: string, val: string | undefined) => {
      if (val) {
        cells[key]!.textContent = val;
        rows[key]!.style.display = '';
      } else {
        rows[key]!.style.display = 'none';
      }
    };
    set('seg', d.segmentLength);
    set('bng', d.bearing);
    set('total', d.totalLength);
    set('height', d.height);
    set('width', d.width);
    set('area', d.area);
    set('road', d.roadInfo);
  });

  // Right-click "Measure This Symbol" result
  document.addEventListener('measurement-graphic-measured', (e: any) => {
    const d = e.detail;
    lastSnap = d;
    showSnapToast(d);

    // Mirror into the panel so the user can copy it
    idleHint.style.display = 'none';
    dataTable.style.display = '';
    rows.seg!.style.display = 'none';
    rows.bng!.style.display = 'none';
    const set = (key: string, val: string | undefined) => {
      cells[key]!.textContent = val || '—';
      rows[key]!.style.display = val ? '' : 'none';
    };
    set('total', d.totalLength);
    set('height', d.height);
    set('width', d.width);
    set('area', d.area);
  });

  // ── Reset rows ─────────────────────────────────────────────────────────

  function resetRows() {
    idleHint.style.display = '';
    dataTable.style.display = 'none';
    lastSnap = {};
  }

  // ── Snap toast for "Measure This Symbol" ──────────────────────────────

  function showSnapToast(d: any) {
    const toast = document.createElement('div');
    toast.className = 'ms-snap-toast';
    const row = (label: string, val: string) =>
      val
        ? `<tr><td style="color:#7eb4e8;padding-right:8px">${label}</td>
                       <td style="color:#e8f4ff">${val}</td></tr>`
        : '';
    toast.innerHTML = `
            <div style="color:#64b4ff;font-weight:bold;border-bottom:1px solid
                        rgba(100,160,230,0.3);padding-bottom:4px;margin-bottom:6px">
                📏 Symbol Dimensions</div>
            <table style="border-spacing:0 1px">
                ${row('Width', d.width)}
                ${row('Height', d.height)}
                ${row('Area', d.area)}
                ${row('Length', d.totalLength)}
            </table>`;
    toast.style.right = '220px';
    toast.style.bottom = '30px';
    document.body.appendChild(toast);
    setTimeout(() => toast.parentNode?.removeChild(toast), 4200);
  }

  // ── Hint toast for measurement/proximity hints ────────────────────────────

  function showToast(message: string, phase?: string) {
    const toast = document.createElement('div');
    toast.className = 'ms-hint-toast';
    if (phase) {
      toast.dataset.phase = phase;
    }
    toast.textContent = message;
    toast.style.right = '220px';
    toast.style.bottom = '80px';
    document.body.appendChild(toast);
    setTimeout(() => toast.parentNode?.removeChild(toast), 3500);
  }

  // ── Unit switcher ──────────────────────────────────────────────────────

  document.querySelectorAll('#measurePanel .ms-units button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document
        .querySelectorAll('#measurePanel .ms-units button')
        .forEach((b) => b.classList.remove('ms-active-unit'));
      btn.classList.add('ms-active-unit');
      const distUnit = (btn as HTMLElement).dataset.unit as any;
      const areaUnit = (btn as HTMLElement).dataset.area as any;
      symbolEngine.measurementEngine?.setOptions({
        dist_unit: distUnit,
        area_unit: areaUnit,
      });
    });
  });

  // ── Drawing cue state change ───────────────────────────────────────────
  document.addEventListener('drawing-cue-state-change', (_e: any) => {
    // Nothing to drive in the panel right now — overlays are on-map
  });

  // ── Copy to clipboard ──────────────────────────────────────────────────

  copyBtn.addEventListener('click', () => {
    // Prefer the engine's formatter (single source of truth); fall back to the
    // panel mirror if the engine isn't available.
    let text = symbolEngine.measurementEngine?.getFormattedSnapshot() ?? '';
    if (!text) {
      const lines: string[] = [];
      const add = (label: string, key: string) => {
        if (lastSnap[key]) lines.push(`${label}: ${lastSnap[key]}`);
      };
      add('Segment', 'segmentLength');
      add('Bearing', 'bearing');
      add('Total', 'totalLength');
      add('Height', 'height');
      add('Width', 'width');
      add('Area', 'area');
      text = lines.join('\n');
    }

    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const orig = copyBtn.textContent!;
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => (copyBtn.textContent = orig), 1800);
    });
  });
})();

// ── Drawing Cues Settings Panel ────────────────────────────────────────────────
// Initialises Drawing Cues controls from SymbolEngine settings once loaded.

(function initDrawingCuesPanel() {
  if (savePlanButton) {
    savePlanButton.addEventListener('click', () => {
      symbolEngine.serializationEngine.savePlanToFile();
    });
  }

  if (loadPlanButton) {
    loadPlanButton.addEventListener('click', () => {
      symbolEngine.serializationEngine.loadPlanFromFile();
    });
  }

  // ── Test Field generator (declutter demo helper) ──────────────────────────
  const testFieldGenBtn = document.getElementById('api-testfield-generate');
  const testFieldClutterBtn = document.getElementById('api-testfield-clutter');
  const testFieldClearBtn = document.getElementById('api-testfield-clear');
  const testFieldStatus = document.getElementById('api-testfield-status');
  const testFieldCountInput = document.getElementById('api-testfield-count') as HTMLInputElement | null;
  const testFieldStacksInput = document.getElementById('api-testfield-stacks') as HTMLInputElement | null;

  // Shared handlers — bound to both the API Test panel buttons and the
  // top-bar quick-access buttons so there is a single source of truth.
  const runTestFieldGenerate = () => {
    const count = Math.max(1, parseInt(testFieldCountInput?.value ?? '80', 10) || 80);
    const stackCount = Math.max(0, parseInt(testFieldStacksInput?.value ?? '4', 10) || 0);
    const added = generateTestField(symbolEngine, appConfig.activeView, { count, stackCount });
    if (testFieldStatus) testFieldStatus.textContent = `Added ${added} test symbols`;
  };

  const runTestFieldClutter = () => {
    // Cluttered preset: reuse the Count input but let the generator
    // auto-boost stacks and tighten the spread for heavy overlap.
    const count = Math.max(1, parseInt(testFieldCountInput?.value ?? '150', 10) || 150);
    const added = generateClutteredField(symbolEngine, appConfig.activeView, { count });
    if (testFieldStatus) testFieldStatus.textContent = `Added ${added} cluttered symbols`;
  };

  testFieldGenBtn?.addEventListener('click', runTestFieldGenerate);
  testFieldClutterBtn?.addEventListener('click', runTestFieldClutter);

  // Top-bar quick-access buttons (mirror the API Test panel actions)
  document.getElementById('topbar-testfield-generate')?.addEventListener('click', runTestFieldGenerate);
  document.getElementById('topbar-testfield-clutter')?.addEventListener('click', runTestFieldClutter);

  if (testFieldClearBtn) {
    testFieldClearBtn.addEventListener('click', () => {
      const removed = clearTestField(symbolEngine);
      if (testFieldStatus) testFieldStatus.textContent = `Removed ${removed} test symbols`;
    });
  }

  if (deploymentManagerBtn) {
    deploymentManagerBtn.addEventListener('click', () => {
      const dbe = (window as any).deploymentBuilderEngine;
      if (dbe) {
        dbe.openWidget();
      } else {
        console.warn('Deployment Manager not ready yet');
      }
    });
  }

  // ── Analysis Hub ──────────────────────────────────────────────────────────
  {
    const analysisHubPanel = document.getElementById('analysisHubPanel');
    const ahStatus = document.getElementById('ah-status');
    const ahSymbolBadge = document.getElementById('ah-symbol-badge');

    function getActiveGraphic() {
      const se = (window as any).symbolEngine;
      if (!se) return null;
      const last = se.contextMenuManager?.getLastClickedGraphic?.();
      if (last) return last;
      const sel: any[] = se.selectionEngine?.selectedGraphics ?? [];
      return sel.length === 1 ? sel[0] : null;
    }

    function setAhStatus(msg: string, type: 'ok' | 'err' | '' = '') {
      if (!ahStatus) return;
      ahStatus.textContent = msg;
      ahStatus.className = 'ah-status' + (type ? ` ah-${type}` : '');
      if (type === 'ok') setTimeout(() => { if (ahStatus) ahStatus.className = 'ah-status'; }, 3000);
    }

    function updateAhBadge() {
      if (!ahSymbolBadge) return;
      const g = getActiveGraphic();
      if (g) {
        const label: string = g.attributes?.uniqueDesignation || g.attributes?.name || g.attributes?.id || 'Symbol';
        ahSymbolBadge.textContent = String(label).substring(0, 18);
        ahSymbolBadge.classList.add('has-symbol');
      } else {
        ahSymbolBadge.textContent = 'No symbol';
        ahSymbolBadge.classList.remove('has-symbol');
      }
    }

    if (analysisHubBtn && analysisHubPanel) {
      analysisHubBtn.addEventListener('click', () => {
        const visible = analysisHubPanel.classList.toggle('ah-visible');
        if (visible) updateAhBadge();
      });

      document.getElementById('ah-close-btn')?.addEventListener('click', () => {
        analysisHubPanel.classList.remove('ah-visible');
      });

      // Standalone tools — open without requiring a selected symbol
      const standaloneTools: Record<string, () => void> = {
        localPeaks:    () => { const se = (window as any).symbolEngine; se?.localPeaksEngine?.open(undefined, se.view); },
        keyTerrain:    () => { const se = (window as any).symbolEngine; se?.keyTerrainIdentificationEngine?.open(getActiveGraphic() ?? undefined, se.view); },
        deadGround:    () => { const se = (window as any).symbolEngine; se?.deadGroundMapper?.open(getActiveGraphic() ?? undefined, se.view); },
        posDefScorer:  () => { const se = (window as any).symbolEngine; se?.posDefScorerEngine?.openWidget(se.view); },
        opRanker:      () => { const se = (window as any).symbolEngine; se?.opRankerEngine?.openWidget(se.view); },
        // Combat Power — reads every unit symbol on the map (no selection needed)
        // and reports the friendly:hostile force ratio with a doctrinal verdict.
        combatPower:   () => { const se = (window as any).symbolEngine; CombatPowerEngine.getInstance().open(se?.view); },
        missionPlanner:() => { const se = (window as any).symbolEngine; se?.missionPlannerEngine?.openWidget(se.view); },
        // OCOKA opens with or without a symbol — uses the active graphic as the
        // initial centre when present, otherwise prompts to pick a location.
        ocoka:         () => { const se = (window as any).symbolEngine; se?.ocokaEngine?.open(getActiveGraphic() ?? undefined, se.view); },
        // LOS opens with or without a symbol — uses the active graphic as the
        // observer when present, otherwise place the observer by clicking the
        // map (Pick ⊕) or entering a Lat/Lon in the panel.
        los:           () => { const se = (window as any).symbolEngine; se?.losEngine?.open(getActiveGraphic() ?? undefined, se.view); },
        // WEZ / Trajectory open with or without a symbol — they use the active
        // graphic as the firing/observer point when present, otherwise prompt
        // the user to place it on the map (Pick ⊕).
        wez:           () => { const se = (window as any).symbolEngine; se?.weaponEffectEngine?.open(getActiveGraphic() ?? undefined, se.view); },
        trajectory:    () => { const se = (window as any).symbolEngine; se?.trajectoryEngine?.open(getActiveGraphic() ?? undefined, se.view); },
        // Buffer & Threat Rings opens with or without a symbol — uses the active
        // graphic as the first source when present, otherwise prompt the user to
        // place a source on the map (Pick Source).
        buffer:        () => { const se = (window as any).symbolEngine; se?.bufferEngine?.open(getActiveGraphic() ?? undefined, se.view); },
        // Weapon Effect opens with or without a symbol — uses the active graphic
        // as the first detonation point when present, otherwise click the map to
        // place it.
        effects:       () => { const se = (window as any).symbolEngine; se?.effectEngine?.open(getActiveGraphic() ?? undefined, se.view); },
        // Landing Zone Planner opens standalone in click-to-search mode.
        landingZone:   () => { const se = (window as any).symbolEngine; se?.landingZoneEngine?.openWidget(se.view); },
        // Airspace opens with or without a symbol — if a polygon is selected it
        // loads as the active footprint; otherwise the panel lets you draw one.
        airspace:      () => {
          const se = (window as any).symbolEngine;
          const g = getActiveGraphic();
          const ge = g?.geometry;
          if (ge && (ge.type === 'polygon' || (ge as any).rings)) se?.airspaceEngine?.open(g, se.view);
          else se?.airspaceEngine?.openWidget(se.view);
        },
      };

      // Context tools — require a right-clicked or selected graphic
      const contextTools: Record<string, (g: any, v: any, se: any) => void> = {
        corridor:    (g, v, se) => se.corridorEngine?.open(g, v),
        flight:      (g, v, se) => se.flightEngine?.open(g, v),
      };

      const toolNames: Record<string, string> = {
        keyTerrain: 'Key Terrain Identifier', localPeaks: 'Peak Analysis',
        deadGround: 'Dead Ground Mapper',     ocoka: 'OCOKA',
        los: 'Line of Sight',                 posDefScorer: 'Position Defensibility Scorer',
        opRanker: 'OP Ranker',                wez: 'Weapon Effect Zone',
        trajectory: 'Trajectory',             effects: 'Weapon Effect',
        buffer: 'Buffer & Rings',             corridor: 'Corridor Analysis',
        flight: 'UAV Flight Analysis',        missionPlanner: 'Mission Planner',
        combatPower: 'Combat Power',          landingZone: 'Landing Zone Planner',
        airspace: 'Airspace (ROZ / ACA)',
      };

      analysisHubPanel.querySelectorAll<HTMLButtonElement>('.ah-tool').forEach(btn => {
        btn.addEventListener('click', () => {
          const tool = btn.dataset.tool ?? '';
          const name = toolNames[tool] ?? tool;
          const se = (window as any).symbolEngine;
          if (!se) { setAhStatus('SymbolEngine not ready', 'err'); return; }

          // Trafficability — opens the full route / service-area / MSR widget.
          // Uses the active symbol as origin when one is selected, else lets the
          // user pick an origin on the map. Degrades gracefully when offline.
          if (tool === 'trafficability') {
            const te = se.trafficabilityEngine;
            if (!te) { setAhStatus('Trafficability engine not loaded', 'err'); return; }
            const graphic = getActiveGraphic();
            te.open(graphic ?? undefined, se.view);
            setAhStatus(graphic ? 'Trafficability opened' : 'Trafficability — pick an origin on the map', 'ok');
            return;
          }

          if (standaloneTools[tool]) {
            standaloneTools[tool]();
            setAhStatus(`${name} opened`, 'ok');
            return;
          }

          const graphic = getActiveGraphic();
          if (!graphic) {
            setAhStatus('Right-click or select a symbol first', 'err');
            return;
          }

          const fn = contextTools[tool];
          if (fn) {
            fn(graphic, se.view, se);
            setAhStatus(`${name} opened`, 'ok');
          }
        });
      });

      // Refresh symbol badge every second while panel is open
      setInterval(() => {
        if (analysisHubPanel.classList.contains('ah-visible')) updateAhBadge();
      }, 1000);
    }
  }

  function waitForEngine(cb: () => void) {
    if ((window as any).symbolEngine?.settings) cb();
    else setTimeout(() => waitForEngine(cb), 200);
  }

  function dispatchSetting(path: string[], value: unknown) {
    window.dispatchEvent(
      new CustomEvent('settingsChanged', {
        detail: { path, value, fullPath: path.join('.') },
      }),
    );
  }

  function hexToRgb(hex: string): [number, number, number] {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [0, 0, 0];
  }

  function rgbToHex(rgb: number[]): string {
    return '#' + rgb.map(v => String(v | 0).padStart(2, '0').replace(/^(\d)$/, '0$1')).map(v => parseInt(v).toString(16).padStart(2, '0')).join('');
  }

  function rgbArrayToHex(c: number[]): string {
    return '#' + c.map(v => (v | 0).toString(16).padStart(2, '0')).join('');
  }

  waitForEngine(() => {
    const engine = (window as any).symbolEngine;
    const dc: Record<string, any> = engine.settings?.drawingCues ?? {};

    const get = <T extends HTMLElement>(id: string) =>
      document.getElementById(id) as T | null;

    // ── Populate from current settings ──────────────────────────────────────
    const masterCb = get<HTMLInputElement>('setting-drawingCues');
    if (masterCb) masterCb.checked = dc.enabled !== false;

    const rb = dc.rubberBand ?? {};
    const rbCb = get<HTMLInputElement>('setting-rubberBand');
    if (rbCb) rbCb.checked = rb.enabled !== false;

    const rbOpEl = get<HTMLInputElement>('setting-rbOpacity');
    const rbOpDisp = get<HTMLElement>('rbOpacity-display');
    if (rbOpEl && rb.lineOpacity !== undefined) {
      rbOpEl.value = String(rb.lineOpacity);
      if (rbOpDisp) rbOpDisp.textContent = String(rb.lineOpacity);
    }

    const coordCb = get<HTMLInputElement>('setting-coordDisplay');
    if (coordCb) coordCb.checked = (dc.coordinateDisplay?.enabled) !== false;

    const guideCb = get<HTMLInputElement>('setting-angularGuides');
    if (guideCb) guideCb.checked = (dc.angularGuides?.enabled) !== false;

    const guideThreshEl = get<HTMLInputElement>('setting-guideThreshold');
    if (guideThreshEl && dc.angularGuides?.snapThresholdDeg !== undefined)
      guideThreshEl.value = String(dc.angularGuides.snapThresholdDeg);

    const guideColorEl = get<HTMLInputElement>('setting-guideColor');
    if (guideColorEl && dc.angularGuides?.lineColor)
      guideColorEl.value = rgbArrayToHex(dc.angularGuides.lineColor);

    const guideOpEl = get<HTMLInputElement>('setting-guideOpacity');
    const guideOpDisp = get<HTMLElement>('guideOpacity-display');
    if (guideOpEl && dc.angularGuides?.lineOpacity !== undefined) {
      guideOpEl.value = String(dc.angularGuides.lineOpacity);
      if (guideOpDisp) guideOpDisp.textContent = String(dc.angularGuides.lineOpacity);
    }

    const guideWidthEl = get<HTMLInputElement>('setting-guideWidth');
    if (guideWidthEl && dc.angularGuides?.lineWidth !== undefined)
      guideWidthEl.value = String(dc.angularGuides.lineWidth);

    const guideIntervalEl = get<HTMLInputElement>('setting-guideInterval');
    if (guideIntervalEl && dc.angularGuides?.snapIntervalDeg !== undefined)
      guideIntervalEl.value = String(dc.angularGuides.snapIntervalDeg);

    const guideLabelCb = get<HTMLInputElement>('setting-guideLabel');
    if (guideLabelCb) guideLabelCb.checked = dc.angularGuides?.showLabel !== false;

    const guideLabelSizeEl = get<HTMLInputElement>('setting-guideLabelSize');
    if (guideLabelSizeEl && dc.angularGuides?.fontSize !== undefined)
      guideLabelSizeEl.value = String(dc.angularGuides.fontSize);

    const guideArcCb = get<HTMLInputElement>('setting-guideArc');
    if (guideArcCb) guideArcCb.checked = dc.angularGuides?.showArc !== false;

    const guideArcRadiusEl = get<HTMLInputElement>('setting-guideArcRadius');
    if (guideArcRadiusEl && dc.angularGuides?.arcRadiusKm !== undefined)
      guideArcRadiusEl.value = String(dc.angularGuides.arcRadiusKm);

    const guideFanCb = get<HTMLInputElement>('setting-guideFan');
    if (guideFanCb) guideFanCb.checked = dc.angularGuides?.showFan !== false;

    const guideSnapPtCb = get<HTMLInputElement>('setting-guideSnapPoint');
    if (guideSnapPtCb) guideSnapPtCb.checked = dc.angularGuides?.showSnapPoint !== false;

    const guideAnchorCb = get<HTMLInputElement>('setting-guideAnchor');
    if (guideAnchorCb) guideAnchorCb.checked = dc.angularGuides?.showAnchor !== false;

    const guideRelSegCb = get<HTMLInputElement>('setting-guideRelSeg');
    if (guideRelSegCb) guideRelSegCb.checked = dc.angularGuides?.relativeSegment === true;

    const ringsCb = get<HTMLInputElement>('setting-distanceRings');
    if (ringsCb) ringsCb.checked = (dc.distanceRings?.enabled) !== false;

    const ringIntEl = get<HTMLInputElement>('setting-ringInterval');
    if (ringIntEl && dc.distanceRings?.intervalKm !== undefined)
      ringIntEl.value = String(dc.distanceRings.intervalKm);

    const ringCountEl = get<HTMLInputElement>('setting-ringCount');
    if (ringCountEl && dc.distanceRings?.ringCount !== undefined)
      ringCountEl.value = String(dc.distanceRings.ringCount);

    const ringColorEl = get<HTMLInputElement>('setting-ringColor');
    if (ringColorEl && dc.distanceRings?.lineColor)
      ringColorEl.value = rgbArrayToHex(dc.distanceRings.lineColor);

    const ringOpEl = get<HTMLInputElement>('setting-ringOpacity');
    const ringOpDisp = get<HTMLElement>('ringOpacity-display');
    if (ringOpEl && dc.distanceRings?.lineOpacity !== undefined) {
      ringOpEl.value = String(dc.distanceRings.lineOpacity);
      if (ringOpDisp) ringOpDisp.textContent = String(dc.distanceRings.lineOpacity);
    }

    const ringWidthEl = get<HTMLInputElement>('setting-ringWidth');
    if (ringWidthEl && dc.distanceRings?.lineWidth !== undefined)
      ringWidthEl.value = String(dc.distanceRings.lineWidth);

    const hlCb = get<HTMLInputElement>('setting-nearbyHighlight');
    if (hlCb) hlCb.checked = (dc.nearbyHighlight?.enabled) !== false;

    const hlRadEl = get<HTMLInputElement>('setting-hlRadius');
    if (hlRadEl && dc.nearbyHighlight?.radiusKm !== undefined)
      hlRadEl.value = String(dc.nearbyHighlight.radiusKm);

    const hlRingEl = get<HTMLInputElement>('setting-hlRingRadius');
    if (hlRingEl && dc.nearbyHighlight?.ringRadiusKm !== undefined)
      hlRingEl.value = String(dc.nearbyHighlight.ringRadiusKm);

    // ── Wire up live handlers ────────────────────────────────────────────────
    masterCb?.addEventListener('change', () =>
      dispatchSetting(['features', 'drawingCues'], masterCb.checked));

    rbCb?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'rubberBand', 'enabled'], rbCb.checked));

    rbOpEl?.addEventListener('input', () => {
      if (rbOpDisp) rbOpDisp.textContent = rbOpEl.value;
    });
    rbOpEl?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'rubberBand', 'lineOpacity'], +rbOpEl.value));

    coordCb?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'coordinateDisplay', 'enabled'], coordCb.checked));

    guideCb?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'angularGuides', 'enabled'], guideCb.checked));

    guideThreshEl?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'angularGuides', 'snapThresholdDeg'], +guideThreshEl.value));

    guideColorEl?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'angularGuides', 'lineColor'], hexToRgb(guideColorEl.value)));

    guideOpEl?.addEventListener('input', () => {
      if (guideOpDisp) guideOpDisp.textContent = guideOpEl.value;
    });
    guideOpEl?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'angularGuides', 'lineOpacity'], +guideOpEl.value));

    guideWidthEl?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'angularGuides', 'lineWidth'], +guideWidthEl.value));

    guideIntervalEl?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'angularGuides', 'snapIntervalDeg'], +guideIntervalEl.value));

    guideLabelCb?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'angularGuides', 'showLabel'], guideLabelCb.checked));

    guideLabelSizeEl?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'angularGuides', 'fontSize'], +guideLabelSizeEl.value));

    guideArcCb?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'angularGuides', 'showArc'], guideArcCb.checked));

    guideArcRadiusEl?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'angularGuides', 'arcRadiusKm'], +guideArcRadiusEl.value));

    guideFanCb?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'angularGuides', 'showFan'], guideFanCb.checked));

    guideSnapPtCb?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'angularGuides', 'showSnapPoint'], guideSnapPtCb.checked));

    guideAnchorCb?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'angularGuides', 'showAnchor'], guideAnchorCb.checked));

    guideRelSegCb?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'angularGuides', 'relativeSegment'], guideRelSegCb.checked));

    ringsCb?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'distanceRings', 'enabled'], ringsCb.checked));

    ringIntEl?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'distanceRings', 'intervalKm'], +ringIntEl.value));

    ringCountEl?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'distanceRings', 'ringCount'], +ringCountEl.value));

    ringColorEl?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'distanceRings', 'lineColor'], hexToRgb(ringColorEl.value)));

    ringOpEl?.addEventListener('input', () => {
      if (ringOpDisp) ringOpDisp.textContent = ringOpEl.value;
    });
    ringOpEl?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'distanceRings', 'lineOpacity'], +ringOpEl.value));

    ringWidthEl?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'distanceRings', 'lineWidth'], +ringWidthEl.value));

    hlCb?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'nearbyHighlight', 'enabled'], hlCb.checked));

    hlRadEl?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'nearbyHighlight', 'radiusKm'], +hlRadEl.value));

    hlRingEl?.addEventListener('change', () =>
      dispatchSetting(['drawingCues', 'nearbyHighlight', 'ringRadiusKm'], +hlRingEl.value));

    console.log('[DrawingCuesPanel] initialized');
  });
})();

// ── MGRS Settings Panel UX ───────────────────────────────────────────────────
// Keep dependent controls visually in sync (type/style sections) without
// duplicating the global settings dispatcher already defined in index.html.
(function initMGRSPanel() {
  const panel = document.getElementById('feature-panel-mgrs');
  if (!panel) return;

  const byId = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T | null;

  const showGzd = byId<HTMLInputElement>('setting-mgrsShowGZD');
  const show100k = byId<HTMLInputElement>('setting-mgrsShow100K');
  const show10k = byId<HTMLInputElement>('setting-mgrsShow10K');
  const show1k = byId<HTMLInputElement>('setting-mgrsShow1K');
  const showLabels = byId<HTMLInputElement>('setting-mgrsShowLabels');

  const gzdControls = ['setting-mgrsGzdColor', 'setting-mgrsGzdOpacity', 'setting-mgrsGzdWidth'];
  const k100Controls = ['setting-mgrs100KColor', 'setting-mgrs100KOpacity', 'setting-mgrs100KWidth'];
  const k10Controls = ['setting-mgrs10KColor', 'setting-mgrs10KOpacity', 'setting-mgrs10KWidth'];
  const k1Controls = ['setting-mgrs1KColor', 'setting-mgrs1KOpacity', 'setting-mgrs1KWidth'];
  const labelControls = ['setting-mgrsLabelSize', 'setting-mgrsLabelColor', 'setting-mgrsLabelOpacity'];

  const setDisabled = (ids: string[], disabled: boolean) => {
    for (const id of ids) {
      const el = byId<HTMLInputElement | HTMLSelectElement>(id);
      if (el) el.disabled = disabled;
    }
  };

  const sync = () => {
    setDisabled(gzdControls, !(showGzd?.checked ?? false));
    setDisabled(k100Controls, !(show100k?.checked ?? false));
    setDisabled(k10Controls, !(show10k?.checked ?? false));
    setDisabled(k1Controls, !(show1k?.checked ?? false));
    setDisabled(labelControls, !(showLabels?.checked ?? false));
  };

  showGzd?.addEventListener('change', sync);
  show100k?.addEventListener('change', sync);
  show10k?.addEventListener('change', sync);
  show1k?.addEventListener('change', sync);
  showLabels?.addEventListener('change', sync);
  sync();
})();
