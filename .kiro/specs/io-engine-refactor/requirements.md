# Requirements Document

## Introduction

The IOEngine (Import/Export Engine) is a dedicated singleton engine for the PAMS8 tactical mapping application that consolidates all import and export functionality. Currently, import/export functions are scattered across the codebase and called directly from HTML button event handlers. This refactor will create a centralized IOEngine following the singleton pattern established by MeasurementEngine, providing a clean architectural separation of concerns and consistent access patterns.

## Glossary

- **IOEngine**: The Import/Export Engine singleton class responsible for all file import and export operations
- **SymbolEngine**: The main tactical symbol management engine that will host the IOEngine instance
- **PAMS8_JSON**: The native PAMS8 JSON file format for saving symbols and their configurations
- **Plan_JSON**: The PAMS8 Plan JSON format that includes overlays and symbol organization
- **GeoJSON**: The standard GeoJSON geographic data format for interoperability
- **Template**: A saved symbol configuration without geometry that can be reused
- **Singleton**: A design pattern ensuring only one instance of a class exists
- **DrawEssentials**: The internal data structure containing symbol drawing configuration
- **Amplifier**: The internal data structure containing symbol amplification data (SIDC, modifiers)
- **GraphicsLayer**: An ArcGIS layer containing graphics/symbols
- **EngineLogger**: The logging utility for user-facing success, error, and next-step messages

## Requirements

### Requirement 1: IOEngine Singleton Architecture

**User Story:** As a developer, I want IOEngine to follow the singleton pattern, so that there is exactly one instance managing all import/export operations consistently across the application.

#### Acceptance Criteria

1. THE IOEngine SHALL implement the singleton pattern with a private constructor
2. THE IOEngine SHALL provide a static getInstance() method that returns the singleton instance
3. THE IOEngine SHALL provide a start(view) method that initializes the engine with the map view
4. THE IOEngine SHALL be instantiated and attached to SymbolEngine as the ioEngine property
5. WHEN SymbolEngine is constructed, THE SymbolEngine SHALL create the IOEngine instance via getInstance()
6. WHEN SymbolEngine.start() is called, THE SymbolEngine SHALL call ioEngine.start(view)

### Requirement 2: Symbol Export to PAMS8 JSON

**User Story:** As a user, I want to export all symbols to a PAMS8 JSON file, so that I can save my work and share it with others.

#### Acceptance Criteria

1. THE IOEngine SHALL provide a saveToFile(filename?: string) method
2. WHEN saveToFile() is called, THE IOEngine SHALL serialize all graphics from tactical layers into PAMS8 JSON format
3. WHEN saveToFile() is called without a filename, THE IOEngine SHALL generate a filename using the pattern `pams8_symbols_${timestamp}.json`
4. WHEN saveToFile() completes successfully, THE IOEngine SHALL trigger a browser download of the JSON file
5. WHEN saveToFile() completes successfully, THE IOEngine SHALL log a success message via EngineLogger
6. THE IOEngine SHALL export symbols from layers: TACT, TACT_PT, FORCE, and milSymbols
7. FOR ALL exported symbols, THE IOEngine SHALL preserve DrawEssentials, Amplifier data, geometry, and layer information

### Requirement 3: Symbol Import from PAMS8 JSON

**User Story:** As a user, I want to import symbols from a PAMS8 JSON file, so that I can restore previously saved work or load shared tactical overlays.

#### Acceptance Criteria

1. THE IOEngine SHALL provide a loadFromFile() method
2. WHEN loadFromFile() is called, THE IOEngine SHALL open a browser file picker dialog
3. WHEN a PAMS8 JSON file is selected, THE IOEngine SHALL parse the file and reconstruct all symbols
4. WHEN a PAMS8 JSON array is detected, THE IOEngine SHALL call importLayerFromJSON(data)
5. WHEN import completes successfully, THE IOEngine SHALL log a success message via EngineLogger with the count of imported symbols
6. IF the file format is invalid, THEN THE IOEngine SHALL log an error message via EngineLogger
7. THE IOEngine SHALL support auto-detection of PAMS8 JSON, GeoJSON, and Template formats

### Requirement 4: Plan Export to Plan JSON

**User Story:** As a user, I want to export my tactical plan with overlays, so that I can save organized multi-layer plans with proper structure.

#### Acceptance Criteria

1. THE IOEngine SHALL provide a savePlanToFile(filename?: string) method
2. WHEN savePlanToFile() is called, THE IOEngine SHALL create a Plan document with overlays for each layer
3. WHEN savePlanToFile() is called without a filename, THE IOEngine SHALL generate a filename using the pattern `pams8_plan_${timestamp}.json`
4. FOR ALL graphics in each layer, THE IOEngine SHALL convert DrawEssentials to Plan format with PlanPoint geometry
5. WHEN savePlanToFile() completes successfully, THE IOEngine SHALL trigger a browser download of the Plan JSON file
6. WHEN savePlanToFile() completes successfully, THE IOEngine SHALL log a success message via EngineLogger with the count of exported symbols
7. THE IOEngine SHALL organize symbols into overlays by layer, preserving layer names and structure

### Requirement 5: Plan Import from Plan JSON

**User Story:** As a user, I want to import a tactical plan from a Plan JSON file, so that I can restore multi-layer plans with their original organization.

#### Acceptance Criteria

1. THE IOEngine SHALL provide a loadPlanFromFile() method
2. WHEN loadPlanFromFile() is called, THE IOEngine SHALL open a browser file picker dialog
3. WHEN a Plan JSON file is selected, THE IOEngine SHALL validate it is a valid Plan document
4. FOR ALL symbols in all overlays, THE IOEngine SHALL reconstruct graphics with proper DrawEssentials and Amplifier data
5. WHEN import completes successfully, THE IOEngine SHALL log a success message via EngineLogger with the count of imported symbols
6. IF the file is not a valid Plan document, THEN THE IOEngine SHALL log an error message via EngineLogger
7. THE IOEngine SHALL convert PlanPoint geometry back to ArcGIS Point geometry during import

### Requirement 6: GeoJSON Export

**User Story:** As a user, I want to export symbols to GeoJSON format, so that I can use my tactical overlays in other GIS applications and tools.

#### Acceptance Criteria

1. THE IOEngine SHALL provide a saveToGeoJSONFile(filename?: string) method
2. WHEN saveToGeoJSONFile() is called, THE IOEngine SHALL convert all symbols to GeoJSON FeatureCollection format
3. WHEN saveToGeoJSONFile() is called without a filename, THE IOEngine SHALL generate a filename using the pattern `pams8_geojson_${timestamp}.geojson`
4. FOR ALL exported features, THE IOEngine SHALL convert Web Mercator coordinates to WGS84 geographic coordinates
5. FOR ALL exported features, THE IOEngine SHALL embed PAMS8-specific data (DrawEssentials, Amplifier) in feature properties
6. WHEN saveToGeoJSONFile() completes successfully, THE IOEngine SHALL trigger a browser download of the GeoJSON file
7. WHEN saveToGeoJSONFile() completes successfully, THE IOEngine SHALL log a success message via EngineLogger

### Requirement 7: GeoJSON Import

**User Story:** As a user, I want to import GeoJSON files, so that I can load tactical data from other GIS applications.

#### Acceptance Criteria

1. THE IOEngine SHALL provide a loadFromGeoJSONFile() method
2. WHEN loadFromGeoJSONFile() is called, THE IOEngine SHALL open a browser file picker dialog
3. WHEN a GeoJSON FeatureCollection is detected, THE IOEngine SHALL call importFromGeoJSON(data)
4. FOR ALL features with pams8:true property, THE IOEngine SHALL reconstruct symbols with DrawEssentials and Amplifier data
5. WHEN import completes successfully, THE IOEngine SHALL log a success message via EngineLogger with the count of imported features
6. IF the file is not a valid GeoJSON FeatureCollection, THEN THE IOEngine SHALL log an error message via EngineLogger
7. THE IOEngine SHALL convert GeoJSON coordinates to the map's spatial reference during import

### Requirement 8: Template Save and Load

**User Story:** As a user, I want to save and load symbol templates, so that I can reuse symbol configurations without geometry.

#### Acceptance Criteria

1. THE IOEngine SHALL provide a saveTemplateToFile(graphic: Graphic) method
2. WHEN saveTemplateToFile() is called, THE IOEngine SHALL prompt the user for a template name
3. WHEN a template name is provided, THE IOEngine SHALL save DrawEssentials and Amplifier data without geometry
4. THE IOEngine SHALL provide a loadTemplateFromFile() method
5. WHEN loadTemplateFromFile() is called, THE IOEngine SHALL open a browser file picker dialog
6. WHEN a template file is selected, THE IOEngine SHALL reconstruct DrawEssentials and Amplifier data
7. WHEN template operations complete, THE IOEngine SHALL log appropriate messages via EngineLogger

### Requirement 9: HTML Button Integration

**User Story:** As a user, I want to access import/export functions through HTML buttons, so that I can easily save and load my tactical overlays.

#### Acceptance Criteria

1. THE HTML button with id 'api-saveAll' SHALL call symbolEngine.ioEngine.saveToFile()
2. THE HTML button with id 'api-load' SHALL call symbolEngine.ioEngine.loadFromFile()
3. THE HTML button with id 'api-save-plan' SHALL call symbolEngine.ioEngine.savePlanToFile()
4. THE HTML button with id 'api-load-plan' SHALL call symbolEngine.ioEngine.loadPlanFromFile()
5. THE HTML button with id 'api-export-geojson' SHALL call symbolEngine.ioEngine.saveToGeoJSONFile()
6. THE HTML button with id 'api-load-geojson' SHALL call symbolEngine.ioEngine.loadFromGeoJSONFile()
7. WHEN any button is clicked, THE button handler SHALL update the status display element

### Requirement 10: Error Handling and User Feedback

**User Story:** As a user, I want clear feedback on import/export operations, so that I know whether my actions succeeded or failed.

#### Acceptance Criteria

1. WHEN any export operation succeeds, THE IOEngine SHALL log a success message via EngineLogger.success()
2. WHEN any import operation succeeds, THE IOEngine SHALL log a success message via EngineLogger.success()
3. IF any operation fails, THEN THE IOEngine SHALL log an error message via EngineLogger.error()
4. WHEN an operation completes, THE IOEngine SHALL log a next-step message via EngineLogger.nextStep() when appropriate
5. FOR ALL error conditions, THE IOEngine SHALL include descriptive error information in console.error()
6. THE IOEngine SHALL handle file parsing errors gracefully without crashing the application
7. THE IOEngine SHALL validate file formats before attempting to import data

### Requirement 11: Migration from SymbolEngine

**User Story:** As a developer, I want import/export functions removed from SymbolEngine, so that the codebase follows proper separation of concerns.

#### Acceptance Criteria

1. THE SymbolEngine SHALL remove the saveToFile() method
2. THE SymbolEngine SHALL remove the loadFromFile() method
3. THE SymbolEngine SHALL remove the savePlanToFile() method
4. THE SymbolEngine SHALL remove the loadPlanFromFile() method
5. THE SymbolEngine SHALL remove the exportLayerToJSON() method
6. THE SymbolEngine SHALL remove the importLayerFromJSON() method
7. THE SymbolEngine SHALL remove the saveToGeoJSONFile() method
8. THE SymbolEngine SHALL remove the loadFromGeoJSONFile() method
9. THE SymbolEngine SHALL remove the saveTemplateToFile() method
10. THE SymbolEngine SHALL remove the loadTemplateFromFile() method
11. THE SymbolEngine SHALL delegate all import/export operations to ioEngine

### Requirement 12: Context Menu Integration

**User Story:** As a user, I want to access import/export functions through context menus, so that I have multiple ways to save and load my work.

#### Acceptance Criteria

1. THE ContextMenuManager SHALL update import/export menu items to call ioEngine methods
2. WHEN "Save All Symbols" is selected, THE ContextMenuManager SHALL call symbolEngine.ioEngine.saveToFile()
3. WHEN "Load Symbols" is selected, THE ContextMenuManager SHALL call symbolEngine.ioEngine.loadFromFile()
4. WHEN "Save Plan" is selected, THE ContextMenuManager SHALL call symbolEngine.ioEngine.savePlanToFile()
5. WHEN "Load Plan" is selected, THE ContextMenuManager SHALL call symbolEngine.ioEngine.loadPlanFromFile()
6. WHEN "Export as GeoJSON" is selected, THE ContextMenuManager SHALL call symbolEngine.ioEngine.saveToGeoJSONFile()
7. WHEN "Import GeoJSON" is selected, THE ContextMenuManager SHALL call symbolEngine.ioEngine.loadFromGeoJSONFile()
