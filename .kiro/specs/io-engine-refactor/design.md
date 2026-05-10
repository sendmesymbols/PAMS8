# Design Document: IOEngine Refactor

## Overview

This design refactors the existing `ImportExportEngine` into a singleton `IOEngine` that follows the established architectural pattern used by `MeasurementEngine`. The refactor consolidates all import/export functionality into a single, centralized engine with consistent access patterns through `SymbolEngine.ioEngine`.

The IOEngine will handle all file operations for PAMS8 tactical symbols, including:
- Native PAMS8 JSON format (symbols and plans)
- GeoJSON interoperability format
- Template save/load for symbol configurations

This refactor improves code organization by:
1. Establishing a clear singleton pattern for the import/export subsystem
2. Providing a consistent API surface through `SymbolEngine`
3. Removing scattered import/export methods from `SymbolEngine`
4. Following the same initialization pattern as other engine singletons

## Architecture

### Singleton Pattern

The IOEngine follows the singleton pattern established by `MeasurementEngine`:

```typescript
class IOEngine {
  private static _instance: IOEngine;
  
  private constructor() {
    // Private constructor prevents direct instantiation
  }
  
  public static getInstance(): IOEngine {
    if (!IOEngine._instance) {
      IOEngine._instance = new IOEngine();
    }
    return IOEngine._instance;
  }
  
  public start(layerManager: GraphicsLayerManager): void {
    // Initialize with layer manager reference
  }
}
```

### Integration with SymbolEngine

The IOEngine is instantiated and managed by `SymbolEngine`:

```typescript
class SymbolEngine {
  private _ioEngine: IOEngine;
  
  constructor(viewProvider: () => MapView | SceneView) {
    // ... other initialization
    this._ioEngine = IOEngine.getInstance();
  }
  
  public start(view: MapView | SceneView): void {
    // ... other engine starts
    this._ioEngine.start(this._layerManager);
  }
  
  public get ioEngine(): IOEngine {
    return this._ioEngine;
  }
}
```

### Dependency Flow

```
HTML Buttons / Context Menus
         ↓
   SymbolEngine.ioEngine
         ↓
      IOEngine (singleton)
         ↓
   GraphicsLayerManager
         ↓
   ArcGIS GraphicsLayers
```

## Components and Interfaces

### IOEngine Class

**Responsibilities:**
- Manage all import/export operations for tactical symbols
- Serialize/deserialize PAMS8 JSON format
- Convert between PAMS8 Plan format and runtime graphics
- Handle GeoJSON import/export with coordinate transformations
- Manage template save/load operations
- Provide user feedback through EngineLogger

**Key Methods:**

```typescript
class IOEngine {
  // Lifecycle
  public static getInstance(): IOEngine;
  public start(layerManager: GraphicsLayerManager): void;
  
  // PAMS8 JSON Export/Import
  public saveToFile(filename?: string): void;
  public loadFromFile(): void;
  public exportLayerToJSON(): object[];
  public importLayerFromJSON(data: object[]): void;
  
  // Plan Export/Import
  public savePlanToFile(filename?: string): void;
  public loadPlanFromFile(): void;
  
  // GeoJSON Export/Import
  public saveToGeoJSONFile(filename?: string): void;
  public loadFromGeoJSONFile(): void;
  public exportToGeoJSON(): object;
  public importFromGeoJSON(geojson: any): void;
  
  // Template Operations
  public saveTemplateToFile(graphic: Graphic): void;
  public loadTemplateFromFile(): void;
  
  // Internal Helpers
  private _downloadJSON(data: any, filename: string): void;
  private _serializePoint(pt: any): object | null;
  private _toPlanPoint(pt: any): PlanPoint | null;
  private _planPointToArcGisPoint(raw: any): Point | null;
  private _buildPlanDrawEss(graphic: Graphic): Record<string, unknown> | null;
  private _buildRuntimeDrawEss(drawEssRaw: any): { de: DrawEssentials; amplifier: Amplifier };
  private _drawEssToGeometry(drawEss: any): Point | Polyline | Polygon | null;
  private _layerIdForDrawEss(drawEss: any): string;
  private _loadFallbackGraphicFromDrawEss(drawEssRaw: any, id: string, layerId: string): void;
  private generateUUID(): string;
}
```

### SymbolEngine Integration

**Modified Methods:**

```typescript
class SymbolEngine {
  private _ioEngine: IOEngine;
  
  constructor(viewProvider: () => MapView | SceneView) {
    // Initialize IOEngine singleton
    this._ioEngine = IOEngine.getInstance();
  }
  
  public start(view: MapView | SceneView): void {
    // Start IOEngine with layer manager
    this._ioEngine.start(this._layerManager);
  }
  
  public get ioEngine(): IOEngine {
    return this._ioEngine;
  }
  
  // REMOVED: All import/export methods delegated to ioEngine
  // - saveToFile()
  // - loadFromFile()
  // - savePlanToFile()
  // - loadPlanFromFile()
  // - exportLayerToJSON()
  // - importLayerFromJSON()
  // - saveToGeoJSONFile()
  // - loadFromGeoJSONFile()
  // - saveTemplateToFile()
  // - loadTemplateFromFile()
}
```

### HTML Button Integration

**Button Event Handlers:**

```javascript
// Save all symbols to PAMS8 JSON
document.getElementById('api-saveAll').addEventListener('click', () => {
  symbolEngine.ioEngine.saveToFile();
  updateStatus('Symbols exported');
});

// Load symbols from PAMS8 JSON
document.getElementById('api-load').addEventListener('click', () => {
  symbolEngine.ioEngine.loadFromFile();
  updateStatus('Symbols loaded');
});

// Save plan to Plan JSON
document.getElementById('api-save-plan').addEventListener('click', () => {
  symbolEngine.ioEngine.savePlanToFile();
  updateStatus('Plan exported');
});

// Load plan from Plan JSON
document.getElementById('api-load-plan').addEventListener('click', () => {
  symbolEngine.ioEngine.loadPlanFromFile();
  updateStatus('Plan loaded');
});

// Export to GeoJSON
document.getElementById('api-export-geojson').addEventListener('click', () => {
  symbolEngine.ioEngine.saveToGeoJSONFile();
  updateStatus('GeoJSON exported');
});

// Import from GeoJSON
document.getElementById('api-load-geojson').addEventListener('click', () => {
  symbolEngine.ioEngine.loadFromGeoJSONFile();
  updateStatus('GeoJSON loaded');
});
```

### Context Menu Integration

**ContextMenuManager Updates:**

```typescript
class ContextMenuManager {
  private _buildImportExportMenuItems(): ContextMenuItem[] {
    return [
      {
        id: 'save-all',
        label: 'Save All Symbols',
        action: () => this._symbolEngine.ioEngine.saveToFile()
      },
      {
        id: 'load-symbols',
        label: 'Load Symbols',
        action: () => this._symbolEngine.ioEngine.loadFromFile()
      },
      {
        id: 'save-plan',
        label: 'Save Plan',
        action: () => this._symbolEngine.ioEngine.savePlanToFile()
      },
      {
        id: 'load-plan',
        label: 'Load Plan',
        action: () => this._symbolEngine.ioEngine.loadPlanFromFile()
      },
      {
        id: 'export-geojson',
        label: 'Export as GeoJSON',
        action: () => this._symbolEngine.ioEngine.saveToGeoJSONFile()
      },
      {
        id: 'import-geojson',
        label: 'Import GeoJSON',
        action: () => this._symbolEngine.ioEngine.loadFromGeoJSONFile()
      }
    ];
  }
}
```

## Data Models

### PAMS8 JSON Format

**Symbol Export Format:**

```typescript
interface PAMS8Symbol {
  pams8Version: string;           // "2.0"
  type: 'pams8-symbol';
  layerId: string;                // Target layer ID
  id: string;                     // Unique symbol ID
  sidc: string;                   // Symbol identification code
  amplifier: Amplifier;           // Symbol modifiers
  drawEssentials: {
    SIDC?: string;
    SYM_NAME?: string;
    SYM_GEO_TYPE?: 'Point' | 'FPoint' | 'Line' | 'Area';
    CTRL_PTS?: SerializedPoint[];
    BASE_LN_PTS?: {
      startPt: SerializedPoint;
      midPt: SerializedPoint;
      endPt: SerializedPoint;
    };
    GEOM?: SerializedPoint;
    [key: string]: any;
  };
}

interface SerializedPoint {
  x: number;
  y: number;
  spatialReference: any;
}
```

### Plan JSON Format

**Plan Document Structure:**

```typescript
interface PlanDocument {
  poObj: {
    plnOrdrPK: {
      plnOrdrId: number;
    };
    plnOrdrOverlay: PlanOverlay[];
  };
}

interface PlanOverlay {
  plnOrdrOverlayPK: {
    plnOrdrId: number;
    plnOrdrOverlayId: string;
  };
  plnOrdrOverlayName: string;
  plnOrdrOverlaySeq: number;
  plnOrdrSymbolSet: PlanSymbol[];
}

interface PlanSymbol {
  plnOrdrSymbolPK: {
    plnOrdrId: number;
    plnOrdrOverlayId: string;
    plnOrdrSymbolId: string;
  };
  drawEss: string;  // JSON-stringified DrawEssentials with PlanPoint geometry
}

interface PlanPoint {
  type: 'point';
  x: number;
  y: number;
  sp: 'WGS1SP';  // Spatial reference identifier
}
```

### GeoJSON Format

**Feature Collection Structure:**

```typescript
interface PAMS8GeoJSON {
  type: 'FeatureCollection';
  features: PAMS8Feature[];
}

interface PAMS8Feature {
  type: 'Feature';
  geometry: {
    type: 'Point' | 'MultiLineString' | 'Polygon';
    coordinates: number[] | number[][] | number[][][];
  };
  properties: {
    pams8: true;                // Marker for PAMS8-specific features
    id: string;
    layerId: string;
    sidc: string;
    amplifier: Amplifier;
    drawEssentials: any;
  };
}
```

### Template Format

**Template Structure:**

```typescript
interface PAMS8Template {
  pams8Version: string;           // "1.0"
  type: 'pams8-template';
  name: string;                   // User-provided template name
  sidc: string;
  amplifier: Amplifier;
  drawEssentials: {
    // DrawEssentials without geometry (CTRL_PTS, BASE_LN_PTS, GEOM removed)
    SIDC?: string;
    SYM_NAME?: string;
    SYM_GEO_TYPE?: string;
    [key: string]: any;
  };
}
```

## Error Handling

### Error Categories

1. **File Selection Errors**
   - User cancels file picker
   - No file selected
   - Action: Silent failure (no error message)

2. **File Format Errors**
   - Invalid JSON syntax
   - Missing required fields
   - Unrecognized format
   - Action: Log error via `EngineLogger.error()` with descriptive message

3. **Data Conversion Errors**
   - Invalid geometry data
   - Missing spatial reference
   - Coordinate transformation failures
   - Action: Skip invalid graphics, log warning, continue processing

4. **Layer Access Errors**
   - Layer not found
   - Layer not initialized
   - Action: Use fallback layer (milSymbols), log warning

### Error Handling Strategy

```typescript
class IOEngine {
  public loadFromFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.geojson,application/json';
    
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;  // Silent failure - user cancelled
      
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const parsed = JSON.parse(evt.target?.result as string);
          
          // Auto-detect format
          if (parsed?.type === 'FeatureCollection') {
            this.importFromGeoJSON(parsed);
          } else if (Array.isArray(parsed)) {
            this.importLayerFromJSON(parsed);
          } else {
            EngineLogger.error(
              'IOEngine',
              'Unrecognized file format. Expected PAMS8 JSON, GeoJSON, or Template.'
            );
          }
        } catch (err) {
          console.error('[IOEngine] File parsing failed:', err);
          EngineLogger.error(
            'IOEngine',
            `Failed to parse file: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
        }
      };
      
      reader.readAsText(file);
    };
    
    input.click();
  }
  
  public importLayerFromJSON(data: object[]): void {
    let successCount = 0;
    let errorCount = 0;
    
    data.forEach((item, index) => {
      try {
        const result = this.loadSymbolFromJSON(item as any);
        if (result) {
          successCount++;
        } else {
          errorCount++;
          console.warn(`[IOEngine] Failed to load symbol at index ${index}`);
        }
      } catch (err) {
        errorCount++;
        console.warn(`[IOEngine] Error loading symbol at index ${index}:`, err);
      }
    });
    
    if (successCount > 0) {
      EngineLogger.success(
        'IOEngine',
        `Imported ${successCount} symbol${successCount !== 1 ? 's' : ''}`
      );
    }
    
    if (errorCount > 0) {
      EngineLogger.error(
        'IOEngine',
        `Failed to import ${errorCount} symbol${errorCount !== 1 ? 's' : ''}`
      );
    }
  }
}
```

### User Feedback

All operations provide feedback through `EngineLogger`:

```typescript
// Success messages
EngineLogger.success('IOEngine', 'Exported 42 symbols to pams8_symbols_1234567890.json');
EngineLogger.success('IOEngine', 'Imported 15 symbols from file');
EngineLogger.success('IOEngine', 'Plan exported with 28 symbols across 3 overlays');

// Error messages
EngineLogger.error('IOEngine', 'Failed to parse file: Invalid JSON syntax');
EngineLogger.error('IOEngine', 'Unrecognized file format');
EngineLogger.error('IOEngine', 'No valid symbols found in file');

// Next-step messages
EngineLogger.nextStep('IOEngine', 'Symbols loaded - use Edit mode to modify them');
EngineLogger.nextStep('IOEngine', 'Template loaded - click on map to place symbol');
```

## Testing Strategy

### Property-Based Testing Assessment

**Property-based testing is NOT appropriate for this refactor** because:

1. **Architectural Reorganization**: This is primarily a code reorganization (moving methods, creating singleton) rather than new algorithmic logic
2. **File I/O Operations**: Import/export operations involve side effects (file system, DOM manipulation) rather than pure functions
3. **UI Integration**: Button clicks and context menu interactions are not suitable for property-based testing
4. **Existing Logic**: The serialization/deserialization logic already exists and is being moved, not rewritten
5. **No New Algorithms**: No new data transformations or business logic that would benefit from property-based testing

**Appropriate Testing Approach**: This refactor requires:
- **Unit tests** for singleton pattern and method delegation
- **Integration tests** for full export/import workflows
- **Manual testing** for UI interactions and file operations
- **Regression tests** to ensure existing functionality is preserved

### Unit Tests

**Test Coverage:**

1. **Singleton Pattern Tests**
   - Verify `getInstance()` returns same instance
   - Verify multiple calls to `getInstance()` return identical reference
   - Verify singleton persists across module reloads

2. **SymbolEngine Integration Tests**
   - Verify `ioEngine` property is initialized
   - Verify `ioEngine.start()` is called during SymbolEngine initialization
   - Verify `ioEngine` getter returns IOEngine instance

3. **Method Delegation Tests**
   - Verify all import/export methods removed from SymbolEngine
   - Verify HTML buttons call correct IOEngine methods
   - Verify context menu items call correct IOEngine methods

4. **Serialization Tests** (existing tests, verify still work)
   - Test `_serializePoint()` with various point types
   - Test `_toPlanPoint()` conversion
   - Test `_planPointToArcGisPoint()` conversion
   - Test round-trip: Point → PlanPoint → Point

5. **Export Tests** (existing tests, verify still work)
   - Test `exportLayerToJSON()` with empty layers
   - Test `exportLayerToJSON()` with mixed geometry types
   - Test `saveSymbolToJSON()` preserves all DrawEssentials
   - Test `exportToGeoJSON()` coordinate transformation
   - Test `_buildPlanDrawEss()` with various symbol types

6. **Import Tests** (existing tests, verify still work)
   - Test `loadSymbolFromJSON()` with valid data
   - Test `loadSymbolFromJSON()` with missing fields
   - Test `importFromGeoJSON()` with PAMS8 features
   - Test `importFromGeoJSON()` with non-PAMS8 features
   - Test `_buildRuntimeDrawEss()` reconstruction

7. **Error Handling Tests**
   - Test invalid JSON parsing
   - Test missing required fields
   - Test invalid geometry data
   - Test coordinate transformation failures

8. **Template Tests**
   - Test template save removes geometry
   - Test template load preserves configuration
   - Test template name validation

### Integration Tests

**Test Scenarios:**

1. **Full Export/Import Cycle**
   - Create symbols on map
   - Export to PAMS8 JSON via `symbolEngine.ioEngine.saveToFile()`
   - Clear map
   - Import from PAMS8 JSON via `symbolEngine.ioEngine.loadFromFile()`
   - Verify symbols match original (geometry, attributes, layer placement)

2. **Plan Export/Import Cycle**
   - Create multi-layer plan with symbols on TACT, TACT_PT, FORCE layers
   - Export to Plan JSON via `symbolEngine.ioEngine.savePlanToFile()`
   - Clear map
   - Import from Plan JSON via `symbolEngine.ioEngine.loadPlanFromFile()`
   - Verify layer organization preserved
   - Verify overlay structure matches original

3. **GeoJSON Interoperability**
   - Export PAMS8 symbols to GeoJSON via `symbolEngine.ioEngine.saveToGeoJSONFile()`
   - Verify coordinate transformation (Web Mercator → WGS84)
   - Import GeoJSON in external GIS tool (QGIS, ArcGIS Pro)
   - Verify geometry and properties are readable
   - Re-import into PAMS8 via `symbolEngine.ioEngine.loadFromGeoJSONFile()`
   - Verify round-trip fidelity

4. **Template Workflow**
   - Create configured symbol with custom amplifiers
   - Save as template via `symbolEngine.ioEngine.saveTemplateToFile(graphic)`
   - Load template via `symbolEngine.ioEngine.loadTemplateFromFile()`
   - Place on map
   - Verify configuration applied (no geometry, amplifiers preserved)

5. **HTML Button Integration**
   - Click 'api-saveAll' button → verify `ioEngine.saveToFile()` called
   - Click 'api-load' button → verify `ioEngine.loadFromFile()` called
   - Click 'api-save-plan' button → verify `ioEngine.savePlanToFile()` called
   - Click 'api-load-plan' button → verify `ioEngine.loadPlanFromFile()` called
   - Click 'api-export-geojson' button → verify `ioEngine.saveToGeoJSONFile()` called
   - Click 'api-load-geojson' button → verify `ioEngine.loadFromGeoJSONFile()` called
   - Verify status display updated after each operation

6. **Context Menu Integration**
   - Open context menu
   - Select 'Save All Symbols' → verify `ioEngine.saveToFile()` called
   - Select 'Load Symbols' → verify `ioEngine.loadFromFile()` called
   - Select 'Save Plan' → verify `ioEngine.savePlanToFile()` called
   - Select 'Load Plan' → verify `ioEngine.loadPlanFromFile()` called
   - Select 'Export as GeoJSON' → verify `ioEngine.saveToGeoJSONFile()` called
   - Select 'Import GeoJSON' → verify `ioEngine.loadFromGeoJSONFile()` called

### Regression Tests

**Verify Existing Functionality:**

1. **File Format Compatibility**
   - Import files saved with old `ImportExportEngine`
   - Verify all symbols load correctly
   - Export with new `IOEngine`
   - Verify file format unchanged

2. **Backward Compatibility**
   - Load PAMS8 JSON files from previous versions
   - Load Plan JSON files from previous versions
   - Load GeoJSON files exported previously
   - Load template files from previous versions

3. **Data Integrity**
   - Verify DrawEssentials preserved through export/import
   - Verify Amplifier data preserved through export/import
   - Verify geometry preserved through export/import
   - Verify layer assignments preserved through export/import

### Manual Testing

**Test Cases:**

1. **File Picker Behavior**
   - Verify file picker opens when clicking load buttons
   - Verify file type filters work (.json, .geojson)
   - Verify cancel behavior (no error, no crash)
   - Verify multiple file selections (if supported)

2. **Download Behavior**
   - Verify file downloads with correct name pattern
   - Verify file contains valid JSON (can be opened in text editor)
   - Verify file can be re-imported successfully
   - Verify download works in different browsers (Chrome, Firefox, Edge)

3. **User Feedback**
   - Verify success messages appear via EngineLogger
   - Verify error messages are descriptive and actionable
   - Verify next-step guidance is helpful
   - Verify console logs provide debugging information

4. **Error Recovery**
   - Import invalid JSON file → verify error message, app remains stable
   - Import file with missing fields → verify graceful degradation
   - Import file with wrong format → verify format detection works
   - Cancel file picker → verify no error, app continues normally
   - Verify subsequent operations work after error

5. **Performance**
   - Export large number of symbols (100+) → verify reasonable performance
   - Import large file → verify reasonable performance
   - Verify no memory leaks after multiple export/import cycles

### Test Execution Strategy

1. **Pre-Refactor**: Run all existing tests to establish baseline
2. **During Refactor**: Run unit tests after each phase
3. **Post-Refactor**: Run full test suite (unit + integration + manual)
4. **Regression**: Compare results with pre-refactor baseline
5. **Sign-Off**: Manual testing of all user-facing features

## Implementation Notes

### Migration Strategy

1. **Phase 1: Create IOEngine**
   - Rename `ImportExportEngine.ts` to `IOEngine.ts`
   - Add singleton pattern (private constructor, getInstance())
   - Add `start(layerManager)` method
   - Keep all existing functionality

2. **Phase 2: Integrate with SymbolEngine**
   - Add `_ioEngine` property to SymbolEngine
   - Initialize in constructor via `getInstance()`
   - Call `start()` in SymbolEngine.start()
   - Add `ioEngine` getter

3. **Phase 3: Update HTML Buttons**
   - Update all button event handlers
   - Change from `symbolEngine.method()` to `symbolEngine.ioEngine.method()`
   - Test each button

4. **Phase 4: Update Context Menus**
   - Update ContextMenuManager menu items
   - Change action callbacks to use `ioEngine`
   - Test each menu item

5. **Phase 5: Remove Old Methods**
   - Remove import/export methods from SymbolEngine
   - Update any remaining references
   - Run full test suite

6. **Phase 6: Add EngineLogger Integration**
   - Add success/error/nextStep logging to all operations
   - Test user feedback messages

### Backward Compatibility

The refactor maintains backward compatibility:

- File formats remain unchanged (PAMS8 JSON, Plan JSON, GeoJSON, Template)
- All existing saved files can be imported
- Export format is identical to previous version
- No breaking changes to data structures

### Performance Considerations

1. **Lazy Initialization**
   - IOEngine singleton created on first access
   - Layer manager reference set during `start()`
   - No performance impact on application startup

2. **File Operations**
   - File reading/writing is asynchronous (FileReader API)
   - Large files may take time to parse
   - Consider progress indicators for large imports (future enhancement)

3. **Memory Management**
   - Singleton pattern ensures single instance
   - No memory leaks from multiple instances
   - File data released after processing

### Future Enhancements

1. **Progress Indicators**
   - Show progress bar for large file imports
   - Display count of processed symbols during import

2. **Batch Operations**
   - Import multiple files at once
   - Export selected symbols only

3. **Format Validation**
   - Validate file format before processing
   - Provide detailed validation errors

4. **Auto-Save**
   - Periodic auto-save to browser storage
   - Recovery from crashes

5. **Cloud Integration**
   - Save/load from cloud storage
   - Share plans with other users

## Dependencies

### External Dependencies

- **@arcgis/core**: ArcGIS Maps SDK for JavaScript
  - `Graphic`, `Point`, `Polyline`, `Polygon`
  - `GraphicsLayer`
  - `webMercatorUtils` for coordinate transformations

### Internal Dependencies

- **GraphicsLayerManager**: Manages tactical layers
- **DrawEssentials**: Symbol drawing configuration
- **Amplifier**: Symbol amplification data (SIDC, modifiers)
- **AnnotationEngine**: Symbol annotation rendering
- **Plan**: Plan document format utilities
- **EngineLogger**: User feedback logging
- **symbolData.json**: Symbol definitions

### Dependency Injection

The IOEngine receives its dependencies through:

1. **Constructor**: None (singleton pattern)
2. **start() method**: `GraphicsLayerManager` instance
3. **Method parameters**: Individual graphics, data objects

This design allows for:
- Easy testing with mock dependencies
- Clear separation of concerns
- Flexible initialization timing

## Conclusion

This design refactors the import/export functionality into a clean singleton architecture that:

1. **Follows Established Patterns**: Uses the same singleton pattern as MeasurementEngine
2. **Centralizes Functionality**: All import/export operations in one place
3. **Simplifies Access**: Consistent API through `SymbolEngine.ioEngine`
4. **Maintains Compatibility**: No changes to file formats or data structures
5. **Improves Maintainability**: Clear separation of concerns, single responsibility

The refactor is low-risk because:
- It's primarily a code reorganization
- All existing functionality is preserved
- File formats remain unchanged
- Migration can be done incrementally
- Backward compatibility is maintained

The result is a cleaner, more maintainable codebase that follows SOLID principles and established architectural patterns within the PAMS8 application.
