# TacticalPoint - Seamless 2D/3D Symbol Implementation

## Overview

The `TacticalPoint` class now provides seamless switching between 2D (`MapView`) and 3D (`SceneView`) views using a unified `PictureMarkerSymbol` approach. This eliminates the previous limitation where `SimpleMarkerSymbol` with the `path` property only worked in 2D views.

## Key Changes

### Before (Problematic)
- **2D Views**: Used `SimpleMarkerSymbol` with `path` property
- **3D Views**: Used `PictureMarkerSymbol` with SVG data URL
- **Issue**: `path` property doesn't work in 3D views, breaking seamless view switching

### After (Seamless)
- **Both 2D and 3D Views**: Use `PictureMarkerSymbol` with SVG data URL
- **Benefit**: Consistent rendering across view types, enabling seamless switching

## Usage

### Basic Usage

```typescript
import { TacticalPoint, MarkerOptions } from "./TacticalPoint";
import MapView from "@arcgis/core/views/MapView";
import Point from "@arcgis/core/geometry/Point";

// Create tactical point (works with both MapView and SceneView)
const tacticalPoint = new TacticalPoint(view);

// Configure marker appearance
const markerOptions: MarkerOptions = {
    color: [255, 0, 0, 0.8],        // Red color
    size: 32,                       // Size in pixels (recommended: 24-48 for optimal visibility)
    angle: 0,                       // Rotation angle
    outline: {
        color: [255, 255, 255, 1],  // White outline
        width: 2                    // Outline width
    }
};

// Create point geometry
const point = new Point({
    longitude: -118.2437,
    latitude: 34.0522,
    spatialReference: { wkid: 4326 }
});

// Initialize tactical point
tacticalPoint.init(
    {
        GEOM: point,        // Immediate placement (optional)
        SIZE: 24,           // Override size (optional)
        ANGLE: 0            // Override angle (optional)
    },
    markerOptions,          // Marker styling
    "100000",              // SIC (Symbol Identification Code)
    "MyTacticalPoint",     // Symbol name
    "0",                   // Offset (0 = center, 1 = bottom)
    "SPGP------"           // SIDC (Symbol ID Code)
);
```

### Interactive Drawing

```typescript
// For interactive drawing (user clicks to place)
tacticalPoint.init(
    {
        // No GEOM provided = interactive mode
        SIZE: 24,
        ANGLE: 0
    },
    markerOptions,
    "100000",
    "InteractivePoint",
    "0",
    "SPGP------"
);

// Listen for completion
tacticalPoint.on("onDrawEnd", (event) => {
    console.log("Point placed at:", event.geometry);
    console.log("Symbol used:", event.marker);
    console.log("Draw essentials:", event.drawEssentials);
});
```

### View Switching Example

```typescript
import { TacticalPointTest } from "./TacticalPointTest";

// Create test instance with both views
const test = new TacticalPointTest(mapView, sceneView);

// Test symbol creation in current view
test.testUnifiedSymbol();

// Switch to 3D view seamlessly
await test.switchView(false); // false = switch to 3D

// Switch back to 2D view
await test.switchView(true);  // true = switch to 2D

// Test multiple symbols
test.testMultipleSymbols();

// Cleanup when done
test.cleanup();
```

## Technical Details

### Symbol Generation
- Converts SVG paths to base64-encoded SVG data URLs
- Uses consistent viewBox (0 0 500 500) for all tactical symbols
- Handles various color formats: arrays, ArcGIS Color objects, hex strings
- Applies appropriate sizing multipliers for optimal visibility

### Size Handling
- **2D Views**: Applies 1.8x multiplier with minimum 32px for better visibility
- **3D Views**: Applies 2.5x multiplier with minimum 48px for optimal 3D visibility  
- **SVG Generation**: Uses 3x base size with minimum 64px for crisp rendering at all scales
- **Interactive Drawing**: Symbols are automatically centered on cursor for precise placement

### Color Support
- Array format: `[r, g, b, a]`
- ArcGIS Color object: `{r, g, b, a}`
- String format: `"#FF0000"` or named colors
- Automatic outline color handling

## Benefits

1. **Seamless View Switching**: No symbol recreation needed when switching between 2D and 3D
2. **Consistent Rendering**: Same visual appearance across view types
3. **Performance**: Single symbol type reduces complexity
4. **Maintainability**: Unified code path for both view types
5. **Scalability**: Works with any number of SVG paths/tactical symbols

## Migration from Old Version

If you're upgrading from the previous version:

1. **No API Changes**: The public interface remains the same
2. **Automatic Improvement**: Existing code gets seamless 2D/3D support automatically
3. **Optional**: Use new `MarkerOptions` interface for cleaner type safety

```typescript
// Old way (still works)
tacticalPoint.init(options, simpleMarkerSymbol, ...);

// New way (recommended)
tacticalPoint.init(options, markerOptions, ...);
```

## Error Handling

The class includes comprehensive error handling:

- Invalid SIDC/SIC combinations
- Missing symbol definitions  
- SVG generation failures (with fallback to simple circle)
- View switching errors

All errors are logged to console with detailed information for debugging.

## Troubleshooting

### Symbols Appear Too Small
The class now automatically applies size multipliers for optimal visibility:
- **Recommended sizes**: 24-48 pixels for base size
- **2D views**: Automatically scaled to 1.8x with 32px minimum
- **3D views**: Automatically scaled to 2.5x with 48px minimum

```typescript
// For better visibility, use larger base sizes
const markerOptions: MarkerOptions = {
    size: 32, // Will become ~58px in 2D, ~80px in 3D
    // ... other options
};
```

### Symbol Not Centered on Cursor
The class now automatically centers symbols on the cursor during interactive drawing:
- **Default behavior**: Symbol center aligns with cursor position
- **Bottom positioning**: Use `offset: "1"` for center-bottom alignment
- **No manual offset needed**: Centering is handled automatically

### Performance with Many Symbols
For applications with hundreds of tactical symbols:
- Use consistent sizes (24-48px range) for better performance
- Consider clustering for dense symbol areas
- Symbols are optimized for both 2D and 3D rendering 