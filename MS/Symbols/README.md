# UEISymbol - ArcGIS API 4.3 Implementation

This directory contains the ported UEISymbol class from the old dojo-based ArcGIS API 3.x to the new ArcGIS API for JavaScript 4.3 with TypeScript support.

## Overview

The `UEISymbol` class provides functionality to draw military symbols on both `MapView` and `SceneView` instances. It supports two main modes:

1. **Interactive Drawing**: When no geometry is provided, the symbol follows the mouse cursor and is placed on click
2. **Immediate Placement**: When geometry is provided, the symbol is placed immediately at the specified location

## Features

- ✅ Works with both MapView and SceneView
- ✅ Interactive mouse drawing
- ✅ Immediate symbol placement
- ✅ Integration with LayerManager for proper layer management
- ✅ Event-driven architecture
- ✅ TypeScript support
- ✅ Military symbol generation using milsymbol library

## Usage

### Basic Setup

```typescript
import UEISymbol from "./MS/Symbols/UEISymbol";
import MapView from "@arcgis/core/views/MapView";

// Create a view
const view = new MapView({
    container: "viewDiv",
    map: map,
    center: [-122.4194, 37.7749],
    zoom: 10
});

// Initialize UEISymbol
const ueiSymbol = new UEISymbol(view);
```

### Interactive Drawing

```typescript
// Draw symbol interactively (follows mouse, click to place)
const options = {
    SIDC: "100310001812110000000000000000",
    SIZE: 30
};

ueiSymbol.init(options);

// Listen for draw events
ueiSymbol.on("onDrawEnd", (event) => {
    console.log("Symbol drawn:", event);
});

ueiSymbol.on("onDrawProgress", (event) => {
    console.log("Drawing progress:", event);
});
```

### Immediate Placement

```typescript
import Point from "@arcgis/core/geometry/Point";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";

// Create a point geometry
const point = new Point({
    longitude: -122.4194,
    latitude: 37.7749,
    spatialReference: SpatialReference.WGS84
});

// Place symbol immediately
const options = {
    SIDC: "100310001812110000000000000000",
    GEOM: point,
    SIZE: 30
};

ueiSymbol.init(options);
```

### Event Handling

The UEISymbol class provides several events:

- `onDrawEnd`: Fired when a symbol is successfully placed
- `onDrawProgress`: Fired during interactive drawing (mouse movement)

```typescript
ueiSymbol.on("onDrawEnd", (event) => {
    const { geometry, marker, drawEssentials } = event;
    console.log("Symbol placed at:", geometry);
});

ueiSymbol.on("onDrawProgress", (event) => {
    const { currentGeometry, currentMarker } = event;
    console.log("Drawing at:", currentGeometry);
});
```

### Layer Management

The UEISymbol automatically uses the GraphicsLayerManager to manage layers:

```typescript
// Get the symbol layer
const symbolLayer = ueiSymbol.getSymbolLayer();

// Clear all symbols
ueiSymbol.clearSymbols();
```

### Deactivation

```typescript
// Deactivate the symbol drawing
ueiSymbol.deactivate();
```

## API Reference

### Constructor

```typescript
constructor(view: MapView | SceneView)
```

### Methods

#### `init(options: UEISymbolOptions, marker?: any, sic?: string, symName?: string, offset?: string, sidc?: string): void`

Initializes the symbol with the provided options.

**Parameters:**
- `options`: Symbol configuration options
- `marker`: Optional marker (legacy parameter)
- `sic`: Symbol identification code
- `symName`: Symbol name
- `offset`: Offset string (legacy parameter)
- `sidc`: SIDC code

#### `deactivate(): void`

Deactivates the symbol drawing and cleans up resources.

#### `on(eventName: string, callback: Function): void`

Registers an event listener.

#### `off(eventName: string, callback?: Function): void`

Removes an event listener.

#### `getSymbolLayer(): GraphicsLayer`

Returns the graphics layer used for symbol placement.

#### `clearSymbols(): void`

Clears all symbols from the layer.

### Options Interface

```typescript
interface UEISymbolOptions {
    SIDC?: string;           // SIDC code for the symbol
    GEOM?: Point;            // Geometry for immediate placement
    ANGLE?: number;          // Rotation angle (not implemented in 4.x)
    SIZE?: number;           // Symbol size
    AMPLIFIER?: Amplifier;  // Symbol amplifier
    [key: string]: any;      // Additional properties
}
```

## Dependencies

- ArcGIS API for JavaScript 4.27+
- milsymbol library (for symbol generation)
- GraphicsLayerManager (for layer management)
- DrawEssentials (for drawing parameters)
- Amplifier (for symbol enhancement)

## Migration from 3.x

### Key Changes

1. **API Changes**: Updated to use ArcGIS API 4.x classes and methods
2. **Event System**: Replaced dojo events with custom event emitter
3. **Layer Management**: Integrated with GraphicsLayerManager
4. **TypeScript**: Full TypeScript support with type definitions
5. **Navigation**: Updated navigation handling for 4.x API

### Breaking Changes

- `setAngle()` method removed (not available in 4.x PictureMarkerSymbol)
- Navigation API changes (commented out in current implementation)
- Event handling API changed from dojo to custom implementation

## Example

See `MS/Examples/UEISymbolExample.html` for a complete working example that demonstrates:

- Switching between MapView and SceneView
- Interactive symbol drawing
- Immediate symbol placement
- Event handling
- Layer management

## Notes

- The milsymbol library must be loaded before using UEISymbol
- Some 3.x features (like `setAngle`) are not available in 4.x and have been commented out
- Navigation controls are temporarily disabled during drawing (commented out due to API changes)
- The implementation uses the GraphicsLayerManager for proper layer management across different view types 