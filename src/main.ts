import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Map from '@arcgis/core/map';
import PlotPoint from "../MS/PlotPoint.ts";
import SymbolEngine from "../MS/Engines/SymbolEngine.ts";
//import SymbolEngine from "../dist/MS/Engines/SymbolEngine.min.js";
import type { SymbolOptions } from '../MS/ThirdParty/MilSymbols/UEITypes.ts'
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import { watch } from "@arcgis/core/core/reactiveUtils";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Graphic from "@arcgis/core/Graphic";
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import Point from "@arcgis/core/geometry/Point";
import Amplifier from "../MS/Support/Amplifier.ts";
import DrawEssentials from "../MS/Support/DrawEssentials.ts";

//import SymbolEngine from "../dist/MS/Engines/SymbolEngine.min";
//import type { SymbolOptions } from '../dist/MS/ThirdParty/MilSymbols/UEITypes'

// Import milsymbol types
import '../MS/ThirdParty/MilSymbols/milsymbol.d.ts';
import GeoTools from "../MS/Support/GeoTools.ts";

// Define button to switch views
const switchButton: HTMLElement | null = document.getElementById('switch-btn');
const drawButton: HTMLElement | null = document.getElementById('draw-btn');
const createButton: HTMLElement | null = document.getElementById('createButton');
const drawBlockSymbolButton = document.getElementById("drawBlockSymbolButton");
const drawAmbushButton = document.getElementById("drawAmbushButton");

// Autocomplete elements
const symbolSearchInput = document.getElementById('symbolSearch') as HTMLInputElement;
const autocompleteList = document.getElementById('autocompleteList') as HTMLDivElement;
const symbolDetails = document.getElementById('symbolDetails') as HTMLDivElement;
const symbolDetailsContent = document.getElementById('symbolDetailsContent') as HTMLDivElement;


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
  container: 'viewDiv'
};

let onActiveViewChanged: ((newView: MapView | SceneView, oldView: MapView | SceneView) => void) | null = null;
/*
const appConfig: { mapView: any; sceneView: any; activeView: any; container: any } = {
  mapView: null,
  sceneView: null,
  activeView: null,
  container: 'viewDiv' // Use same container for both views
};
*/

// Initial view parameters for both 2D and 3D
const initialViewParams: { zoom: number; center: [number, number]; container: string | null, map?: any } = {
  zoom: 7,
  center: [69.3451, 30.3753],
  container: appConfig.container
};

// Create 3D Map (scene view) and 2D Map
const baseMap = new Map({
  basemap: "satellite",
  ground: "world-elevation"
});


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



const useInteractivePlacement = true;
const symbolEngine = new SymbolEngine(() => appConfig.activeView);

onActiveViewChanged = (newView, oldView) => {
  console.log("View changed from", oldView?.type, "to", newView?.type);
  symbolEngine.onViewChanged(newView); // Add this method in SymbolEngine
};

if (drawButton) {
  drawButton.addEventListener("click", () => {


    const sidcInput = document.getElementById("sidcText") as HTMLInputElement;
    const sidc = sidcInput?.value.trim();

    const options: SymbolOptions = {
      sidc,
      size: 35,
      quantity: "200",
      staffComments: "REINFORCEMENTS",
      additionalInformation: "SUPPORT FOR JJ",
      type: "MACHINE GUN",
      dtg: "30140000ZSEP97",
      location: "0900000.0E570306.0N"
    };



    appConfig.activeView.when(() => {
      let amplifier = new Amplifier();
      amplifier.SIDC = sidc;
      if (useInteractivePlacement) {
        symbolEngine.drawMilSymbolInteractively(new DrawEssentials(), amplifier, options);
      } else {
        symbolEngine.addMilSymbolAtCenter(options);
        appConfig.activeView.goTo(appConfig.activeView.center);
      }
    });
  });
}


if (createButton) {
  createButton.addEventListener("click", () => {
    console.log("----");
    const sidcInput = document.getElementById("sidcText") as HTMLInputElement;
    const sidc = sidcInput?.value.trim();

  });
}


if (drawBlockSymbolButton) {
  drawBlockSymbolButton.addEventListener("click", () => {
    const view = appConfig.activeView;

    // Create or get a graphics layer for block symbols
    let graphicsLayer = view.map.findLayerById("blockSymbolLayer") as GraphicsLayer;
    if (!graphicsLayer) {
      graphicsLayer = new GraphicsLayer({ id: "blockSymbolLayer" });
      view.map.add(graphicsLayer);
    }

    // Set up SketchViewModel for rectangle drawing
    const sketchVM = new SketchViewModel({
      view,
      layer: graphicsLayer,
      creationMode: "single"
    });

    sketchVM.create("rectangle");

    sketchVM.on("create", async (event) => {
      if (event.state === "complete") {
        // Remove the plain rectangle
        graphicsLayer.remove(event.graphic);

        // Get the geometry of the drawn rectangle
        const geometry = event.graphic.geometry;

        // Generate the block symbol SVG (replace with your actual SIDC and options)
        const sidc = "10032500003401000000"; // Example SIDC for "Block" task
        const options = {
          sidc,
          size: 60, // or calculate based on geometry
          // ...other options as needed
        };

        // Use your SymbolEngine to generate the SVG
        const symbolEngine = new SymbolEngine(() => view);
        const pictureMarkerSymbol = symbolEngine.generateForceSymbol(options, 3);

        // Place the symbol at the center of the rectangle
        const center = geometry.extent.center;

        const symbolGraphic = new Graphic({
          geometry: center,
          symbol: pictureMarkerSymbol,
          attributes: { type: "blockSymbol", sidc }
        });

        graphicsLayer.add(symbolGraphic);

        sketchVM.destroy();
      }
    });
  });
}

if (drawAmbushButton) {
  drawAmbushButton.addEventListener("click", () => {
    const view = appConfig.activeView;

    // Create or get a graphics layer for tactical graphics
    let graphicsLayer = view.map.findLayerById("tacticalGraphicsLayer") as GraphicsLayer;
    if (!graphicsLayer) {
      graphicsLayer = new GraphicsLayer({ id: "tacticalGraphicsLayer" });
      view.map.add(graphicsLayer);
    }

    // Set up SketchViewModel for line drawing
    const sketchVM = new SketchViewModel({
      view,
      layer: graphicsLayer,
      creationMode: "single"
    });

    sketchVM.create("polyline");

    sketchVM.on("create", (event) => {
      if (event.state === "complete") {
        // Remove the plain line
        graphicsLayer.remove(event.graphic);

        // Get the geometry of the drawn line
        const lineGeometry = event.graphic.geometry as __esri.Polyline;
        
        // Create ambush symbol from the line
        createAmbushSymbol(lineGeometry, graphicsLayer);
        
        sketchVM.destroy();
      }
    });
  });
}

// Initialize autocomplete functionality
console.log('Checking autocomplete elements:', {
  symbolSearchInput: !!symbolSearchInput,
  autocompleteList: !!autocompleteList,
  symbolDetails: !!symbolDetails,
  symbolDetailsContent: !!symbolDetailsContent
});

if (symbolSearchInput && autocompleteList && symbolDetails && symbolDetailsContent) {
  console.log('Initializing autocomplete functionality...');
  initializeAutocomplete();
} else {
  console.error('Some autocomplete elements are missing!');
}

function createAmbushSymbol(lineGeometry: __esri.Polyline, layer: GraphicsLayer) {
  const coords = lineGeometry.paths[0];
  if (coords.length < 2) return;

  const startPoint = coords[0];
  const endPoint = coords[coords.length - 1];
  
  // Calculate line properties
  const dx = endPoint[0] - startPoint[0];
  const dy = endPoint[1] - startPoint[1];
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  
  // Ambush symbol parameters
  const width = length * 0.3; // Width of the ambush zone
  const radius = Math.hypot(width, length);
  
  // Calculate perpendicular points for the ambush zone
  const perpAngle = angle + Math.PI / 2;
  const perpAngleNeg = angle - Math.PI / 2;
  
  // Create the ambush zone polygon
  const ambushPoints = [];
  
  // Add points along the curved ambush zone
  const numPoints = 20;
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const currentAngle = angle + (t - 0.5) * Math.PI / 2; // Curve from -45° to +45°
    
    // Calculate point on the curve
    const curveX = startPoint[0] + Math.cos(currentAngle) * radius;
    const curveY = startPoint[1] + Math.sin(currentAngle) * radius;
    
    ambushPoints.push([curveX, curveY]);
  }
  
  // Add points on the opposite side
  for (let i = numPoints; i >= 0; i--) {
    const t = i / numPoints;
    const currentAngle = angle + (0.5 - t) * Math.PI / 2;
    
    const curveX = startPoint[0] + Math.cos(currentAngle) * radius * 0.7;
    const curveY = startPoint[1] + Math.sin(currentAngle) * radius * 0.7;
    
    ambushPoints.push([curveX, curveY]);
  }
  
  // Close the polygon
  ambushPoints.push(ambushPoints[0]);
  
  // Create the ambush zone polygon
  const ambushPolygon = new Polygon({
    rings: [ambushPoints],
    spatialReference: lineGeometry.spatialReference
  });
  
  // Create parallel lines within the ambush zone
  const parallelLines = [];
  const numLines = 8;
  for (let i = 1; i <= numLines; i++) {
    const offset = (width * 0.7 / (numLines + 1)) * i;
    
    const line1 = [
      [startPoint[0] + Math.cos(perpAngle) * offset, startPoint[1] + Math.sin(perpAngle) * offset],
      [endPoint[0] + Math.cos(perpAngle) * offset, endPoint[1] + Math.sin(perpAngle) * offset]
    ];
    
    const line2 = [
      [startPoint[0] + Math.cos(perpAngleNeg) * offset, startPoint[1] + Math.sin(perpAngleNeg) * offset],
      [endPoint[0] + Math.cos(perpAngleNeg) * offset, endPoint[1] + Math.sin(perpAngleNeg) * offset]
    ];
    
    parallelLines.push(new Polyline({
      paths: [line1],
      spatialReference: lineGeometry.spatialReference
    }));
    
    parallelLines.push(new Polyline({
      paths: [line2],
      spatialReference: lineGeometry.spatialReference
    }));
  }
  
  // Create arrow at the end
  const arrowLength = length * 0.2;
  const arrowWidth = arrowLength * 0.3;
  
  const arrowPoints = [
    [endPoint[0], endPoint[1]],
    [endPoint[0] - Math.cos(angle) * arrowLength, endPoint[1] - Math.sin(angle) * arrowLength],
    [endPoint[0] - Math.cos(angle) * arrowLength + Math.cos(perpAngle) * arrowWidth, 
     endPoint[1] - Math.sin(angle) * arrowLength + Math.sin(perpAngle) * arrowWidth],
    [endPoint[0] - Math.cos(angle) * arrowLength - Math.cos(perpAngle) * arrowWidth, 
     endPoint[1] - Math.sin(angle) * arrowLength - Math.sin(perpAngle) * arrowWidth],
    [endPoint[0], endPoint[1]]
  ];
  
  const arrowPolygon = new Polygon({
    rings: [arrowPoints],
    spatialReference: lineGeometry.spatialReference
  });
  
  // Add graphics to the layer
  const ambushZoneGraphic = new Graphic({
    geometry: ambushPolygon,
    symbol: new SimpleFillSymbol({
      color: [255, 0, 0, 0.2], // Semi-transparent red
      outline: new SimpleLineSymbol({
        color: [255, 0, 0, 1],
        width: 2
      })
    }),
    attributes: { type: "ambush", symbolType: "tacticalGraphic" }
  });
  
  layer.add(ambushZoneGraphic);
  
  // Add parallel lines
  parallelLines.forEach(line => {
    const lineGraphic = new Graphic({
      geometry: line,
      symbol: new SimpleLineSymbol({
        color: [255, 0, 0, 0.8],
        width: 1
      }),
      attributes: { type: "ambush", symbolType: "tacticalGraphic" }
    });
    layer.add(lineGraphic);
  });
  
  // Add arrow
  const arrowGraphic = new Graphic({
    geometry: arrowPolygon,
    symbol: new SimpleFillSymbol({
      color: [255, 0, 0, 1], // Solid red
      outline: new SimpleLineSymbol({
        color: [255, 0, 0, 1],
        width: 1
      })
    }),
    attributes: { type: "ambush", symbolType: "tacticalGraphic" }
  });
  
  layer.add(arrowGraphic);
}

appConfig.sceneView.when(() => {
  console.log("3D Map is loaded");

});

appConfig.mapView.when(() => {
  console.log("2D Map is loaded");
  // Instantiate the PlotPoint class
  const plotter = new PlotPoint(appConfig.mapView);
  plotter.plotAtCenter();
});

if (switchButton) {
  switchButton.addEventListener("click", () => {
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

  reactiveUtils.watch(
      () => appConfig.activeView?.type,
      (newType: string| undefined, oldType: string| undefined) => { // Use lowercase 'string' for primitive type
        console.log("SymbolEngine ---0000000--- TYPE watcher FIRED. New:", newType, "Old:", oldType);
        // Potentially re-initialize or update SymbolEngine based on new view type
      },
      { initial: true } // This makes it fire once on setup
  );

  if (is3D) {
    console.log("Clicked")

    activeViewpoint.scale /= scaleConversionFactor;

    // Switch to 2D view
    appConfig.mapView.viewpoint = activeViewpoint;
    appConfig.mapView.container = appConfig.container;
    appConfig.activeView = appConfig.mapView;
    (switchButton as HTMLInputElement).value = '3D';

    appConfig.mapView.on("click", (event:MouseEvent) => {
      console.log("---00---");
      if (event.button === 2) { // Right-click
        console.log("------");
      }
    });


  } else {
    activeViewpoint.scale *= scaleConversionFactor;

    // Switch to 3D view
    appConfig.sceneView.viewpoint = activeViewpoint;
    appConfig.sceneView.container = appConfig.container;
    appConfig.activeView = appConfig.sceneView;
    (switchButton as HTMLInputElement).value = '2D';

    appConfig.sceneView.on("click", (event:MouseEvent) => {
      console.log("---SS---");
      if (event.button === 2) { // Right-click
        console.log("---SS---");
      }
    });
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

  view
      .when(() => {

      })
      .catch((error) => {
        if (error.name.includes("webgl")) {
          alert("WebGL Support not found. Please Enable WebGL Support to Continue")
        }
      });
  return view;
}

// Test function to demonstrate milsymbol.js integration using SymbolEngine
function testMilSymbol() {
  console.log("Testing milsymbol.js integration via SymbolEngine...");
  
  try {
    // Use the SymbolEngine's test method
    symbolEngine.testMilSymbol();
  } catch (error) {
    console.error("Error testing milsymbol.js via SymbolEngine:", error);
  }
}

// Add a button to test milsymbol.js functionality
const testMilSymbolButton = document.createElement("button");
testMilSymbolButton.textContent = "Test MilSymbol";
testMilSymbolButton.className = "esri-component esri-widget--button esri-widget esri-interactive";
testMilSymbolButton.addEventListener("click", testMilSymbol);

// Add the test button to the info div
const infoDiv = document.getElementById("infoDiv");
if (infoDiv) {
  infoDiv.appendChild(testMilSymbolButton);
}

// Auto-run test when page loads (optional)
window.addEventListener("load", () => {
  setTimeout(() => {
    console.log("Auto-running milsymbol.js test...");
    testMilSymbol();
  }, 2000); // Wait 2 seconds for everything to load
});

/**
 * Initialize autocomplete functionality for symbol search
 */
function initializeAutocomplete() {
  console.log('initializeAutocomplete function called');
  
  let allSymbols: Array<{key: string, name: string}> = [];
  let filteredSymbols: Array<{key: string, name: string}> = [];
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
    filteredSymbols = allSymbols.filter(symbol => 
      symbol.name.toLowerCase().includes(searchTerm)
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
      filteredSymbols = allSymbols.filter(symbol => 
        symbol.name.toLowerCase().includes(searchTerm)
      );
      showAutocompleteList(filteredSymbols);
    }
  });

  symbolSearchInput.addEventListener('blur', (e) => {
    console.log('=== Input blur event fired ===');
    console.log('Blur event target:', e.target);
    console.log('Related target:', e.relatedTarget);
    
    // Check if the blur is caused by clicking on an autocomplete item
    if (e.relatedTarget && e.relatedTarget.classList && e.relatedTarget.classList.contains('autocomplete-item')) {
      console.log('Blur caused by clicking on autocomplete item - not hiding list');
      return;
    }
    
    // Delay hiding to allow for clicks on autocomplete items
    setTimeout(() => {
      console.log('Hiding autocomplete list after blur timeout');
      hideAutocompleteList();
    }, 200);
  });

  function showAutocompleteList(symbols: Array<{key: string, name: string}>) {
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

  function selectSymbol(symbol: {key: string, name: string}) {
    console.log('=== selectSymbol function called ===');
    console.log('Symbol object:', symbol);
    
    symbolSearchInput.value = symbol.name;
    hideAutocompleteList();
    
    // Log the selected JSON key to console
    console.log('Selected symbol key:', symbol.key);
    console.log('Selected symbol name:', symbol.name);


// Step 1: Extract parts from the 8-character key
    const symbolSet = symbol.key.slice(0, 2);    // positions 5–6
    const symbolId = symbol.key.slice(2);        // becomes positions 11–16 or more

// Step 2: Define static/default values for remaining SIDC parts
    const codingScheme = "10";                  // positions 1–2 (Warfighting)
    const standardIdentity = "06";              // positions 3–4 (Friendly)
    const status = "0";                         // position 7 (Present)
    const hqModifier = "0";                     // position 8 (None)
    const amplifier1 = "16";                    // positions 9–10 (Default)
    const modifiers = "0000";                   // positions 17–20 (sector modifiers or padding)

// Step 3: Pad symbolId to 10 digits (entity + type + subtype + modifiers)
    const paddedEntityCode = symbolId.padEnd(10, "0");

// Step 4: Combine all into 20-character SIDC
    const fullSIDC = codingScheme
        + standardIdentity
        + symbolSet
        + status
        + hqModifier
        + amplifier1
        + paddedEntityCode;

    console.log("Full SIDC:", fullSIDC);


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

    const options: SymbolOptions = {
      sidc: fullSIDC,
      size: 35,
      quantity: "200",
      staffComments: "REINFORCEMENTS",
      additionalInformation: "SUPPORT FOR JJ",
      type: "MACHINE GUN",
      dtg: "30140000ZSEP97",
      location: "0900000.0E570306.0N"
    };


    var amplifier = new Amplifier();
    /*
    amplifier.DTG = "DDHHMMSSZMONYYYY";
    amplifier.EDTG = "DDHHMMSSZMONYYYY00";
    */
    //amplifier.UNIQUE_DESIG = "Tact";
    amplifier.UNIQUE_DESIG = "Unique Designation";
    amplifier.HIGHER_FORM = "Higher Formation";
    amplifier.STAFF_COM = "Staff Comments";
    amplifier.ADDL_INFO = "Additional Information";
    amplifier.TARGET_DESIGNATOR = "Target Designator";
    amplifier.SIDC = fullSIDC;

    amplifier.SIZE = 60;
    //amplifier.SIZE = 10;


    var attr = {
      plnOrdrOverlayId: 2000,
      plnOrdrId: 300,
      creatorId: 700,
      symbolId: '500'
    }


    var drawEssentials = new DrawEssentials();

    drawEssentials.uniqueDesignation = "FORCE 123456";
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





    //LINE GEOM AND CTRL PTS -------------------------------------------------------------------------------------------------------------------------------------------

    /*
    drawEssentials.GEOM = new Polyline(JSON.parse('[[[7459705.494615135,3528604.534230706],[8132962.839750933,3978054.26054752],[8272995.475569369,3706549.9360785875]]]'));
    drawEssentials.CTRL_PTS = JSON.parse('[' +
        '{"type":"point","x":7459705.494615135,"y":3528604.534230706,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},' +
        '{"type":"point","x":8132962.839750933,"y":3978054.26054752,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},' +
        '{"type":"point","x":8272995.475569369,"y":3706549.9360785875,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}' +
        ']');
    */

    // Step 1: Convert the hardcoded GEOM array into a proper Polyline
    const rawPath = JSON.parse('[[[7459705.494615135,3528604.534230706],[8132962.839750933,3978054.26054752],[8272995.475569369,3706549.9360785875]]]');
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

    //drawEssentials.CTRL_PTS = rawPoly.map(pt => new Point(pt));  // <-- Not necessary
   //drawEssentials.CTRL_PTS = rawPoly; // <--Working

    //Freehand - Arrow
    //drawEssentials.GEOM = JSON.parse('[[[7440152.664026581,3387766.4129998223],[7444163.174728697,3398597.4047426144],[7448121.95234597,3409277.6888287137],[7452032.926455948,3419806.9084322993],[7455900.026636179,3430184.706727551],[7459727.182464213,3440410.7268886482],[7463518.323517601,3450484.612089772],[7467277.37937389,3460406.0055051004],[7471008.27961063,3470174.5503088143],[7475148.941752206,3480909.2617632784],[7479292.299614414,3491522.04846089],[7483416.150821622,3501939.943176853],[7487526.08949822,3512162.4379359456],[7491627.709768598,3522189.0247629476],[7495726.605757144,3532019.1956826374],[7499828.371588249,3541652.4427197943],[7504354.769439134,3552031.06194151],[7509019.9920974625,3562435.845473394],[7513711.978482167,3572586.923176649],[7518438.807870589,3582483.5614114045],[7523208.559540068,3592125.02653779],[7528029.312767945,3601510.5849159355],[7533181.704474733,3611138.323071109],[7538766.289474563,3621101.3019132065],[7544448.296312634,3630736.326249064],[7550239.287547101,3640042.346139027],[7556150.825736118,3649018.3116434393],[7562194.473437837,3657663.1728226463],[7568899.343660081,3666647.2313261996],[7575910.2488474855,3675388.487148571],[7583126.154127727,3683723.8756800313],[7590562.516958701,3691651.9933040277],[7598234.794798306,3699171.436404009],[7606393.391310585,3706481.9119689725],[7614936.109752386,3713434.7673398466],[7623786.069849716,3719939.85706383],[7632960.722351115,3725995.596523343],[7642477.518005126,3731600.401100808],[7652061.0208245255,3736652.6817867267],[7661806.575395454,3741321.5506232576],[7671773.583789642,3745647.8559025396],[7681964.313074588,3749638.0781007954],[7692381.030317785,3753298.697694249],[7703026.002586731,3756636.1951591237],[7713901.496948919,3759657.0509716435],[7724673.652503248,3762290.9968009572],[7734920.163129382,3764489.8458338073],[7745360.715703537,3766444.7408881793],[7755996.989326718,3768160.4817215344],[7766830.663099928,3769641.868091334],[7777863.41612417,3770893.69975504],[7789096.927500446,3771920.776470112],[7800532.876329761,3772727.8979940126],[7812116.321868522,3773317.518243736],[7822432.716829612,3773662.7105588936],[7832906.6788419075,3773851.140094127],[7843539.320989612,3773885.9886319414],[7854331.756356923,3773770.4379548407],[7865285.098028042,3773507.669845329],[7876400.45908717,3773100.8660859116],[7887678.952618504,3772553.2084590914],[7899121.691706248,3771867.878747374],[7910729.789434599,3771048.0587332626],[7921651.444110079,3770169.6925443974],[7931996.906841612,3769248.067577394],[7942469.29488976,3768231.8205746887],[7953069.336140344,3767123.032218383],[7963797.758479185,3765923.7831905787],[7974655.289792107,3764636.1541733774],[7985642.65796493,3763262.225848881],[7996760.590883476,3761804.0788991908],[8008009.816433567,3760263.794006408],[8019391.0625010235,3758643.451852636],[8030905.056971669,3756945.1331199743],[8041663.359459473,3755308.26224209],[8051959.187754632,3753699.550834357],[8062358.274704284,3752035.5642131628],[8072861.108382562,3750317.6975521496],[8083468.1768636,3748547.3460249603],[8094179.96822153,3746725.904805236],[8104996.970530487,3744854.7690666197],[8115919.671864601,3742935.3339827526],[8126948.560298008,3740968.9947272777],[8138084.12390484,3738957.146473837],[8149326.85075923,3736901.1843960728],[8160677.228935311,3734802.5036676265],[8171985.22480874,3732690.7410087604],[8182218.59683924,3730763.3282593554],[8192537.436117143,3728805.5765568875],[8202942.081274396,3726818.453890292],[8213432.870942939,3724802.9282485056],[8224010.143754714,3722759.9676204626],[8234674.238341666,3720690.5399951],[8245425.493335735,3718595.613361352],[8256264.247368865,3716476.1557081556],[8267190.839072999,3714333.135024446],[8278205.607080078,3712167.519299159],[8289308.890022045,3709980.276521229],[8300501.026530843,3707772.374679594],[8311782.355238414,3705544.7817631876],[8323153.214776702,3703298.4657609463]],[[8254575.380901572,3767248.330424147],[8323153.214776702,3703298.4657609463],[8249363.611897673,3645440.02647676]]]');
    //drawEssentials.CTRL_PTS = JSON.parse('[{"type":"point","x":7440152.664026581,"y":3387766.4129998223,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7644392.403604518,"y":3732650.2846224457,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":8323153.214776702,"y":3703298.4657609463,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}]');


    //AREA GEOM AND CTRL PTS -------------------------------------------------------------------------------------------------------------------------------------------


    //const rawPolygon = JSON.parse('[[[7443405.995866349,3488487.2451935397],[7431392.425586601,3485332.1799794533],[7418436.010378483,3481144.9956318866],[7404668.232745316,3475984.5944062434],[7390335.7961438615,3469960.7522655195],[7378275.247584642,3464437.997506145],[7365926.054760581,3458388.9469121625],[7353357.292186632,3451844.5448649097],[7340638.034377749,3444835.7357457215],[7327962.44684212,3437468.0866297428],[7316085.782221778,3430213.844117836],[7304252.926245097,3422638.2148442753],[7292518.871990751,3414765.834911081],[7280938.612537417,3406621.3404202736],[7269567.140963771,3398229.367473874],[7258165.451298598,3389380.476674634],[7247046.807114448,3380277.3141531926],[7236329.679966002,3370990.8392163864],[7226074.512967665,3361548.129503236],[7216341.749233844,3351976.2626527604],[7206301.598635803,3341319.6824307796],[7196715.6284093,3330168.2132922257],[7188067.8235170115,3318962.78586126],[7180448.373015765,3307743.8035278823],[7173642.99142739,3295973.632538993],[7167365.9867410315,3282235.5853009857],[7163115.42031746,3268680.019461578],[7161061.884463602,3255383.3579012225],[7161288.440958511,3242630.3732473087],[7163481.816183315,3229629.256990722],[7167493.460473816,3216115.5457974523],[7173206.329721701,3202181.4235197613],[7179992.808977921,3188836.972140784],[7186660.011529011,3177518.661611206],[7194173.881646882,3166096.4035578286],[7202478.356687263,3154614.3528773948],[7211517.374005882,3143116.6644666474],[7221234.870958467,3131647.4932223284],[7230571.580144088,3121324.70218007],[7240121.026785126,3111354.092454802],[7250076.964759283,3101501.498500587],[7260400.890359576,3091797.2458082773],[7271054.299879025,3082271.6598687246],[7281998.689610646,3072955.0661727805],[7293126.339963569,3063932.5548358466],[7304414.928856026,3055214.381997451],[7315875.94043537,3046789.403171528],[7327472.073887453,3038686.996451431],[7339166.028398126,3030936.539930515],[7350920.503153242,3023567.411702134],[7363071.364984011,3016395.536068183],[7376102.169936748,3009216.625398665],[7389063.49269572,3002619.1295738444],[7401904.590394459,2996643.013637438],[7414574.720166499,2991328.2426331635],[7427023.139145375,2986714.781604739],[7441072.9466569815,2982307.3320716294],[7455792.982042832,2978722.175000973],[7469893.698733545,2976451.2473656125],[7483275.356602679,2975573.1044146135],[7495805.738581659,2976162.1082013045],[7507935.826180548,2978179.091719678],[7520643.838084766,2981577.1273393715],[7533861.8436510535,2986286.1466104263],[7547521.91223615,2992236.081082883],[7561556.113196798,2999356.862306783],[7573934.8486007415,3006400.6415213402],[7585145.134515224,3013347.900684238],[7596471.588821363,3020882.438276048],[7607882.992491875,3028972.052793206],[7619348.126499476,3037584.5427321503],[7630835.771816882,3046687.706589316],[7642314.709416811,3056249.3428611406],[7653197.028384803,3065740.552172537],[7663407.9595034355,3075024.8973860308],[7673540.232598838,3084604.675743374],[7683571.275493597,3094456.604710976],[7693478.516010297,3104557.401755246],[7703239.381971527,3114883.7843425917],[7712831.30119987,3125412.469939422],[7722231.701517915,3136120.1760121463],[7731513.88756182,3147099.1971789175],[7740631.889298593,3158310.7424507537],[7749479.803073176,3169635.0102053634],[7758033.71816769,3181047.3372442406],[7766269.72386425,3192523.060368879],[7774163.909444977,3204037.5163807734],[7781692.364191988,3215566.0420814166],[7788831.177387401,3227083.9742723037],[7796338.640675789,3239948.294706925],[7803513.173848867,3253154.535544302],[7810060.444320678,3266238.216640954],[7815943.353408685,3279161.0718027777],[7821124.802430359,3291884.834835669],[7825567.692703165,3304371.239545525],[7829279.939836127,3316748.4451138466],[7832831.921911287,3332249.9198484328],[7834906.37232566,3347126.462323787],[7835420.014796255,3361292.175516307],[7834289.573040084,3374661.1624023905],[7831431.770774157,3387147.5259584365],[7826271.592770697,3399478.9439382553],[7818761.773533885,3411058.151588546],[7809106.90639157,3421828.3849126487],[7797555.9536395045,3431754.1998092122],[7786924.205197951,3439212.569437212],[7775238.001004265,3446173.9755105358],[7762592.88367338,3452645.924658343],[7749084.395820231,3458635.9235097924],[7735207.606361438,3464006.984839505],[7722408.690200325,3468385.876536378],[7709171.710987649,3472424.3097361554],[7695557.367732844,3476127.053462108],[7681626.359445347,3479498.876737509],[7667439.385134592,3482544.54858563],[7653388.842477357,3485209.9039607057],[7639456.281469617,3487534.3071845802],[7625452.118065462,3489571.0141550144],[7611430.061593029,3491324.2447272935],[7597443.821380454,3492798.2187567046],[7583547.106755875,3493997.156098533],[7569008.353958271,3494970.49344085],[7554392.865384245,3495657.094373501],[7540078.291302513,3496038.390881057],[7526132.271392491,3496119.6973040365],[7512622.445333591,3495906.327982957],[7498626.130901911,3495352.4259874118],[7483105.437033223,3494286.3289441518],[7468638.02980164,3492779.657064555],[7455359.639361302,3490843.0744479187],[7443405.995866349,3488487.2451935397]]]');

    const rawPolygon = JSON.parse('[[[4265573.298979523,3601968.7258994896],[3791052.2273852737,2814361.5864492427],[5698920.453382766,2237109.148839745],[6589258.958848262,3509021.2995047397],[4265573.298979523,3601968.7258994896]]]');

    //drawEssentials.GEOM = rawPolygon;  //Working for Area

    const rawPts = JSON.parse('[{"type":"point","x":7443405.995866349,"y":3488487.2451935397,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7160894.739324412,"y":3250003.716943853,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7494771.678873974,"y":2976053.407569854,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7831094.60332866,"y":3388201.864083415,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}]');
    //drawEssentials.CTRL_PTS = rawPts;  //Working for Area


    //Ambush
    //drawEssentials.GEOM = JSON.parse('[[[7660068.599573985,2904076.347816583],[7660901.225935073,2905054.98740112],[7661703.837399798,2906058.390077164],[7662475.6979074385,2907085.635641937],[7663216.099598426,2908135.7820267724],[7663924.363463519,2909207.8661610666],[7664599.839966501,2910300.904855496],[7665241.909639866,2911413.8957036817],[7665849.983652917,2912545.8180014803],[7666423.504351772,2913695.6336830505],[7666961.945770784,2914862.288272847],[7667464.814114888,2916044.711852661],[7667931.648212453,2917241.820042822],[7668362.019938219,2918452.5149966655],[7668755.534605917,2919675.6864073467],[7669111.831330232,2920910.212526083],[7669430.583357766,2922154.961190892],[7669711.498366695,2923408.7908648746],[7669954.31873485,2924670.551683101],[7670158.821775983,2925939.086507127],[7670324.819943989,2927213.231986191],[7670452.161004893,2928491.8196240985],[7670540.728176469,2929773.6768508283],[7670590.440235338,2931057.6280978792],[7670601.251591453,2932342.4958763607],[7670573.1523299115,2933627.1018568473],[7670506.168220046,2934910.2679500035],[7670400.360691796,2936190.81738699],[7670255.8267793665,2937467.5757986554],[7670072.6990322415,2938739.3722925307],[7669851.145393627,2940005.040526634],[7669591.369046431,2941263.4197791005],[7669293.608226928,2942513.356012662],[7668958.13600628,2943753.7029329925],[7668585.260040102,2944983.3230399555],[7668175.322286323,2946201.088670784],[7667728.698691578,2947405.8830342414],[7667245.798846435,2948596.6012348086],[7666727.065609768,2949772.1512859664],[7666172.974702617,2950931.455111637],[7665584.034271915,2952073.4495348656],[7664960.784424474,2953197.0872528446],[7664303.796731662,2954301.3377973745],[7663613.673705227,2955385.188479888],[7662891.048244742,2956447.645320168],[7662136.583057186,2957487.7339579137],[7661350.970049186,2958504.5005463017],[7660534.929692483,2959497.012626748],[7659689.210363196,2960464.359984047],[7658814.587655509,2961405.655481113],[7657911.863670374,2962320.035872561],[7656981.866279931,2963206.6625963678],[7656025.448368272,2964064.7225429094],[7655043.4870492825,2964893.428800645],[7654036.882862252,2965692.0213777786],[7653006.558946007,2966459.767899239],[7651953.460192317,2967195.9642783236],[7650878.552379349,2967899.935362404],[7649782.821285973,2968571.0355521003],[7648667.271787719,2969208.6493933434]],[[7669851.145393627,2940005.040526634],[7865837.079717581,2978984.6355360188],[7855135.895757661,3039522.761937849]],[[7663924.363463519,2909207.8661610666],[7656850.304515758,2906879.678774651]],[[7666961.945770784,2914862.288272847],[7659887.886823023,2912534.1008864315]],[[7669111.831330232,2920910.212526083],[7662037.772382471,2918582.0251396676]],[[7670324.819943989,2927213.231986191],[7663250.760996227,2924885.0445997757]],[[7670573.1523299115,2933627.1018568473],[7663499.09338215,2931298.914470432]],[[7669851.145393627,2940005.040526634],[7662777.086445865,2937676.8531402186]],[[7668175.322286323,2946201.088670784],[7661101.263338561,2943872.9012843687]],[[7665584.034271915,2952073.4495348656],[7658509.975324154,2949745.26214845]],[[7662136.583057186,2957487.7339579137],[7655062.524109424,2955159.5465714983]],[[7657911.863670374,2962320.035872561],[7650837.804722613,2959991.8484861455]],[[7653006.558946007,2966459.767899239],[7645932.499998245,2964131.5805128235]],[[7852015.719270714,3034225.7533901706],[7855135.895757661,3039522.761937849],[7859886.4039017875,3035620.650555985]]]');
    //drawEssentials.CTRL_PTS = JSON.parse('[{"type":"point","x":7647532.926935223,"y":2969812.192141802,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7660068.599573986,"y":2904076.3478165823,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7668935.294855062,"y":2920280.997813032,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7865837.079717581,"y":2978984.6355360188,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}},{"type":"point","x":7855135.895757661,"y":3039522.761937849,"spatialReference":{"wkid":102100,"latestWkid":3857,"xyTolerance":0.001,"zTolerance":0.001,"mTolerance":0.001,"falseX":-20037700,"falseY":-30241100,"xyUnits":10000,"falseZ":-100000,"zUnits":10000,"falseM":-100000,"mUnits":10000}}]');




        //drawEssentials.GEOM = new Point(68.99174366565728 , 27.709813703606667, map.spatialReference);

    /* //Uncomment to test passive functionality
    drawEssentials.GEOM = new Point({
      longitude: appConfig.activeView.center.longitude,
      latitude: appConfig.activeView.center.latitude,
      spatialReference: appConfig.activeView.spatialReference
    });
  */

    //z.OPTIONS.GEOM = new Point(z.GEOM.x, z.GEOM.y, z.spatialReference);

    //drawEssentials.HEAD_RATIO = 0.17;
    //drawEssentials.TAIL_FACTOR = 0.17;

    drawEssentials.ECHELON = amplifier.getEchelon(fullSIDC);

    //drawEssentials.TEETH_SIZE = 2;

    // Set default draw type from Parameters if available
    const drawTypesSelect = document.getElementById('drawTypesSelectPre') as HTMLSelectElement;
    const selectedValue = parseInt(drawTypesSelect.value);
    console.log("DRAW_TYPE updated to:", selectedValue);
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
      "lineWidth": 3,
      "size": 20,
      "textSize": 12,
      "opacity": 1,
    };

    //Destroy Measurement Engine
    /*
    measurementEngine.destroy(map);
    symDrawProgressEvent.remove();
    symDrawClickEvent.remove();
    */

    drawEssentials.labelOptions = { 'haloColor': [255, 0, 0], 'haloColorSize': 5, 'color': [0, 255, 0], 'textSize': 20, 'bold': 1, 'italic': 0, 'uLine': 0, 'oLine': 0, 'tLine': 0 };
    //var labelOptions = {'haloColor': [255,0,0], 'haloColorSize': 5, 'color': [0,255, 0]};
    //symEngine.initialize(drawEssentials, extraSettings, labelOptions);


    symbolEngine.initialize(drawEssentials, amplifier, attr);

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
      symbolDetailsContent.innerHTML = `
        <p><span class="key">Key:</span> ${key}</p>
        <p><span class="key">Name:</span> ${data.Name || 'N/A'}</p>
        <p><span class="key">Class:</span> ${data.Class || 'N/A'}</p>
        <p><span class="key">Description:</span> ${data.Description || 'N/A'}</p>
        <p><span class="key">SymGeoType:</span> ${data.SymGeoType || 'N/A'}</p>
        <p><span class="key">Is Freehand:</span> ${data.isFreeHand || 'N/A'}</p>
        ${data.Cat ? `<p><span class="key">Categories:</span> ${data.Cat.join(', ')}</p>` : ''}
        ${data.Parameters && data.Parameters.length > 0 ? 
          `<p><span class="key">Parameters:</span></p><ul>${data.Parameters.map((param: any) => 
            `<li>${param.Name}: ${param.description || 'N/A'}</li>`
          ).join('')}</ul>` : ''
        }
        ${data.Tools && data.Tools.length > 0 ? 
          `<p><span class="key">Tools:</span></p><ul>${data.Tools.map((tool: any) => 
            `<li>${tool.Name}: ${tool.description || 'N/A'}</li>`
          ).join('')}</ul> <select id="drawTypesSelect" class="drawTypesSelect">
           ${data.Tools.map((tool: any) =>
              `<option value="${tool.DRAW_TYPE}">${tool.Name}</option>`
          ).join('')}
         </select>\`` : ''
        }
      `;

      
      symbolDetails.style.display = 'block';
      console.log('Symbol details displayed successfully');
    } catch (error) {
      console.error('Error displaying symbol details:', error);
    }
    
    console.log('=== displaySymbolDetails function completed ===');
  }
}

