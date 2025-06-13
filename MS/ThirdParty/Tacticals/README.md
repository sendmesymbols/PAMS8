# Military Symbology Module

This module provides military symbology support for ArcGIS API for JavaScript 4.3 applications using TypeScript. It implements MIL-STD-2525 symbol standards and provides tools for rendering military symbols on ArcGIS maps.

## Features

- TypeScript implementation of MIL-STD-2525 symbology
- Integration with ArcGIS API for JavaScript 4.3
- SIDC (Symbol Identification Coding) parsing and formatting
- Interactive symbol placement using SketchViewModel
- Symbol caching for improved performance
- Support for both 2D and 3D views

## Usage

```typescript
import { SymbolEngine } from './military-symbology';
import MapView from "@arcgis/core/views/MapView";

// Initialize with a map view
const view = new MapView({...});
const symbolEngine = new SymbolEngine(view);

// Draw a military symbol interactively
await symbolEngine.drawMilSymbolInteractively({
    sidc: "SFGPEWRH--MT",
    size: 32,
    outlineColor: "#FF0000"
});

// Add a military symbol at a specific point
const point = new Point({
    longitude: -118.15,
    latitude: 34.03
});

const result = symbolEngine.addMilSymbolAtPoint(point, {
    sidc: "SFGPEWRH--MT",
    size: 32
});
```

## Symbol Options

The module supports various symbol options including:
- SIDC (Symbol Identification Code)
- Size
- Outline color and width
- Additional military specific attributes (quantity, reinforcement, etc.)

## SIDC Format

The SIDC (Symbol Identification Coding) follows the 15-character format specified in MIL-STD-2525:

```
Position  Description
0         Coding Scheme
1         Identity
2         Battle Dimension
3         Status
4-9       Function ID
10        Modifier
11        Echelon
12-14     Additional Information
```

## Dependencies

- ArcGIS API for JavaScript 4.3
- TypeScript 4.x or higher
