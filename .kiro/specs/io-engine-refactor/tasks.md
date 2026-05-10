# Implementation Plan: IOEngine Refactor

## Overview

This implementation refactors the existing `ImportExportEngine` into a singleton `IOEngine` following the architectural pattern established by `MeasurementEngine`. The refactor consolidates all import/export functionality into a centralized engine with consistent access patterns through `SymbolEngine.ioEngine`.

The implementation will:
1. Rename and restructure `ImportExportEngine` to `IOEngine` with singleton pattern
2. Integrate IOEngine with SymbolEngine following the established pattern
3. Update all HTML button and context menu references
4. Remove deprecated methods from SymbolEngine
5. Add comprehensive user feedback via EngineLogger

## Tasks

- [ ] 1. Create IOEngine singleton class
  - [x] 1.1 Rename ImportExportEngine.ts to IOEngine.ts
    - Rename file from `MS/Engines/ImportExportEngine.ts` to `MS/Engines/IOEngine.ts`
    - Update class name from `ImportExportEngine` to `IOEngine`
    - _Requirements: 1.1, 1.2_
  
  - [-] 1.2 Implement singleton pattern
    - Add private static `_instance: IOEngine` property
    - Make constructor private to prevent direct instantiation
    - Add public static `getInstance(): IOEngine` method
    - Ensure getInstance() returns the same instance on multiple calls
    - _Requirements: 1.1, 1.2_
  
  - [-] 1.3 Add start() method for initialization
    - Add public `start(layerManager: GraphicsLayerManager): void` method
    - Store layerManager reference in `_layerManager` property
    - Remove constructor parameter, move initialization to start()
    - _Requirements: 1.3_

- [ ] 2. Integrate IOEngine with SymbolEngine
  - [~] 2.1 Add IOEngine property to SymbolEngine
    - Add private `_ioEngine: IOEngine` property to SymbolEngine class
    - Initialize in constructor via `IOEngine.getInstance()`
    - Add public getter `get ioEngine(): IOEngine` that returns `_ioEngine`
    - _Requirements: 1.4, 1.5_
  
  - [~] 2.2 Initialize IOEngine in SymbolEngine.start()
    - Call `this._ioEngine.start(this._layerManager)` in SymbolEngine.start() method
    - Ensure initialization happens after layerManager is ready
    - _Requirements: 1.6_
  
  - [~] 2.3 Update ContextMenuManager integration
    - Change `linkImportExportEngine()` method to accept `IOEngine` type
    - Update `_importExportEngine` property type from `ImportExportEngine` to `IOEngine`
    - Update SymbolEngine to call `this._contextMenuManager.linkImportExportEngine(this._ioEngine)`
    - _Requirements: 1.4, 12.1_

- [ ] 3. Add EngineLogger integration for user feedback
  - [~] 3.1 Add EngineLogger to export operations
    - Import EngineLogger utility
    - Add success logging to `saveToFile()`: "Exported N symbols to filename"
    - Add success logging to `savePlanToFile()`: "Plan exported with N symbols across M overlays"
    - Add success logging to `saveToGeoJSONFile()`: "Exported N symbols to GeoJSON"
    - Add success logging to `saveTemplateToFile()`: "Template saved to file"
    - _Requirements: 2.5, 4.6, 6.7, 8.7, 10.1_
  
  - [~] 3.2 Add EngineLogger to import operations
    - Add success logging to `loadFromFile()`: "Imported N symbols from file"
    - Add success logging to `loadPlanFromFile()`: "Imported N symbols from plan"
    - Add success logging to `loadFromGeoJSONFile()`: "Imported N features from GeoJSON"
    - Add success logging to `loadTemplateFromFile()`: "Template loaded successfully"
    - Add next-step guidance where appropriate
    - _Requirements: 3.5, 5.5, 7.5, 8.7, 10.2, 10.4_
  
  - [~] 3.3 Add EngineLogger error handling
    - Add error logging for invalid JSON parsing: "Failed to parse file: [error message]"
    - Add error logging for invalid file formats: "Unrecognized file format"
    - Add error logging for invalid Plan documents: "Invalid plan file format"
    - Add error logging for invalid GeoJSON: "Expected a GeoJSON FeatureCollection"
    - Keep console.error() for detailed debugging information
    - _Requirements: 3.6, 5.6, 6.6, 7.6, 10.3, 10.5_

- [~] 4. Checkpoint - Verify core refactor complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Update HTML button event handlers
  - [~] 5.1 Update save/load button handlers
    - Update button with id 'api-saveAll' to call `symbolEngine.ioEngine.saveToFile()`
    - Update button with id 'api-load' to call `symbolEngine.ioEngine.loadFromFile()`
    - Verify status display updates after operations
    - _Requirements: 9.1, 9.2, 9.7_
  
  - [~] 5.2 Update plan button handlers
    - Update button with id 'api-save-plan' to call `symbolEngine.ioEngine.savePlanToFile()`
    - Update button with id 'api-load-plan' to call `symbolEngine.ioEngine.loadPlanFromFile()`
    - Verify status display updates after operations
    - _Requirements: 9.3, 9.4, 9.7_
  
  - [~] 5.3 Update GeoJSON button handlers
    - Update button with id 'api-export-geojson' to call `symbolEngine.ioEngine.saveToGeoJSONFile()`
    - Update button with id 'api-load-geojson' to call `symbolEngine.ioEngine.loadFromGeoJSONFile()`
    - Verify status display updates after operations
    - _Requirements: 9.5, 9.6, 9.7_

- [ ] 6. Update context menu integration
  - [~] 6.1 Update ContextMenuManager save/load menu items
    - Update "Save All Symbols" action to call `this._importExportEngine!.saveToFile()`
    - Update "Load Symbols" action to call `this._importExportEngine!.loadFromFile()`
    - Verify menu items work correctly with IOEngine
    - _Requirements: 12.2, 12.3_
  
  - [~] 6.2 Update ContextMenuManager plan menu items
    - Update "Save Plan" action to call `this._importExportEngine!.savePlanToFile()`
    - Update "Load Plan" action to call `this._importExportEngine!.loadPlanFromFile()`
    - Verify menu items work correctly with IOEngine
    - _Requirements: 12.4, 12.5_
  
  - [~] 6.3 Update ContextMenuManager GeoJSON menu items
    - Update "Export as GeoJSON" action to call `this._importExportEngine!.saveToGeoJSONFile()`
    - Update "Import GeoJSON" action to call `this._importExportEngine!.loadFromGeoJSONFile()`
    - Verify menu items work correctly with IOEngine
    - _Requirements: 12.6, 12.7_

- [ ] 7. Remove deprecated methods from SymbolEngine
  - [~] 7.1 Remove import/export methods from SymbolEngine
    - Remove `saveToFile()` method
    - Remove `loadFromFile()` method
    - Remove `savePlanToFile()` method
    - Remove `loadPlanFromFile()` method
    - Remove `exportLayerToJSON()` method
    - Remove `importLayerFromJSON()` method
    - Remove `saveToGeoJSONFile()` method
    - Remove `loadFromGeoJSONFile()` method
    - Remove `saveTemplateToFile()` method
    - Remove `loadTemplateFromFile()` method
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10_
  
  - [~] 7.2 Update SymbolEngine to delegate to ioEngine
    - Remove old `importExportEngine` getter
    - Ensure all import/export operations go through `ioEngine` property
    - Update any internal SymbolEngine references to use `this._ioEngine`
    - _Requirements: 11.11_

- [ ] 8. Update TypeScript type definitions
  - [~] 8.1 Update import statements across codebase
    - Find all imports of `ImportExportEngine` using grep
    - Replace with `IOEngine` imports
    - Update import paths from `./ImportExportEngine` to `./IOEngine`
    - _Requirements: 1.1_
  
  - [~] 8.2 Update type declarations
    - Update `ImportExportEngine.d.ts` to `IOEngine.d.ts` if it exists
    - Update SymbolEngine.d.ts to reference IOEngine
    - Update ContextMenuManager.d.ts to reference IOEngine
    - _Requirements: 1.1_

- [~] 9. Final checkpoint - Integration testing
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Verify backward compatibility
  - [~] 10.1 Test file format compatibility
    - Verify PAMS8 JSON files from old version can be imported
    - Verify Plan JSON files from old version can be imported
    - Verify GeoJSON files from old version can be imported
    - Verify Template files from old version can be imported
    - Verify exported files match previous format exactly
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
  
  - [~] 10.2 Test full export/import cycles
    - Create test symbols on map
    - Export to PAMS8 JSON via `symbolEngine.ioEngine.saveToFile()`
    - Clear map and re-import
    - Verify symbols match original (geometry, attributes, layers)
    - Test Plan JSON export/import cycle
    - Test GeoJSON export/import cycle
    - Test Template save/load cycle
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [~] 11. Final verification and cleanup
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- This is an architectural refactor that reorganizes existing code without changing functionality
- All file formats remain unchanged for backward compatibility
- The singleton pattern follows the established MeasurementEngine pattern
- EngineLogger provides consistent user feedback across all operations
- Error handling is graceful with descriptive messages
- All existing import/export logic is preserved, only the access pattern changes
- Testing focuses on integration and regression to ensure no functionality is lost

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3"] },
    { "id": 4, "tasks": ["3.1", "3.2", "3.3"] },
    { "id": 5, "tasks": ["5.1", "5.2", "5.3", "6.1", "6.2", "6.3"] },
    { "id": 6, "tasks": ["7.1", "7.2"] },
    { "id": 7, "tasks": ["8.1", "8.2"] },
    { "id": 8, "tasks": ["10.1", "10.2"] }
  ]
}
```
