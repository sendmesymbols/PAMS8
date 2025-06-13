import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Map from '@arcgis/core/map';
import PlotPoint from "../MS/PlotPoint.ts";
import SymbolEngine from "../MS/Engines/SymbolEngine.ts";
import type { SymbolOptions } from '../MS/ThirdParty/MilSymbols/UEITypes.ts'
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";

//import SymbolEngine from "../dist/MS/Engines/SymbolEngine.min";
//import type { SymbolOptions } from '../dist/MS/ThirdParty/MilSymbols/UEITypes'

// Define button to switch views
const switchButton: HTMLElement | null = document.getElementById('switch-btn');
const drawButton: HTMLElement | null = document.getElementById('draw-btn');
const createButton: HTMLElement | null = document.getElementById('createButton');


// Define app config
const appConfig: { mapView: any; sceneView: any; activeView: any; container: any } = {
  mapView: null,
  sceneView: null,
  activeView: null,
  container: 'viewDiv' // Use same container for both views
};

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
      if (useInteractivePlacement) {
        symbolEngine.drawMilSymbolInteractively(options);
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
