import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Map from '@arcgis/core/map';
import PlotPoint from "../MS/PlotPoint.ts";
import SymbolEngine from "../MS/Engines/SymbolEngine.ts";
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
import '../MS/ThirdParty/milsymbol.d.ts';

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
    const standardIdentity = "03";              // positions 3–4 (Friendly)
    const status = "0";                         // position 7 (Present)
    const hqModifier = "0";                     // position 8 (None)
    const amplifier1 = "00";                    // positions 9–10 (Default)
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
    drawEssentials.DRAW_TYPE = 1;
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
          ).join('')}</ul>` : ''
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

