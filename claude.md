# PAMS8 - Military Standard 2525D Symbol Drawing Library

## Project Overview

This is a TypeScript library for drawing Military Standard 2525D symbols on maps using the ArcGIS API for JavaScript 5. The library allows users to draw tactical symbols including unit equipment, installation symbols, and tactical point/area/line symbols.

## Architecture

### Library Structure (`@MS/`)

```
MS/
├── Data/
│   └── Symbols.json           # Symbol metadata and definitions
├── Engines/
│   ├── SymbolEngine.ts        # Main engine handling all symbol operations
│   └── Mapper.d.ts            # Maps symbol class names to implementations
├── Symbols/                   # Symbol implementations (each has .ts and .js version)
│   ├── TacticalPoint.ts       # Tactical point symbols (dots, text, etc.)
│   ├── UEISymbol.ts           # Unit Equipment and Installation symbols
│   ├── FreehandArea.ts        # Freehand area symbols
│   ├── FreehandArrow.ts       # Freehand arrow symbols
│   └── [Many more symbol types...]
├── ThirdParty/
│   └── MilSymbols/
│       ├── milsymbol.js       # Core JS library for unit/installation symbols
│       └── milsymbol.d.ts    # TypeScript declarations for milsymbol
├── Support/
│   ├── Amplifier.ts           # Handles symbol amplifier/modifier data
│   ├── DrawEssentials.ts      # Drawing parameters and configuration
│   └── GeoTools.ts            # Geographic utility functions
├── Managers/
│   └── GraphicsLayerManager.ts # Manages graphics layers for symbols
└── PlotPoint.ts               # Plot point functionality
```

### Symbol Categories

1. **Unit Equipment and Installation (UEI)** - Uses `milsymbol.js` library
2. **Tactical Point Symbols** - Uses `TacticalPoint.ts` class (dots, text, etc.)
3. **Area and Line Symbols** - Uses individual symbol classes in `MS/Symbols/`

## Key Dependencies

- **ArcGIS API for JS 5**: `https://developers.arcgis.com/javascript/latest/`
- **milsymbol.js**: Legacy JS library for UEI symbols (loaded via script tag)
- **Vite**: Build tool and dev server
- **TypeScript**: Type safety

## Build Configuration

- **Entry point**: `MS/Engines/SymbolEngine.ts`
- **Output directory**: `dist/MS`
- **Build command**: `npm run build`
- **Dev server**: `npm run dev` (port 3000)

## Working with the Codebase

### Adding a New Symbol

1. Add symbol metadata to `MS/Data/Symbols.json`:

```json
"KEY": {
    "Class": "SymbolClassName",
    "Name": "Display Name",
    "SymGeoType": "Point|Line|Polygon|Area",
    "Parameters": [...]
}
```

2. Create symbol class in `MS/Symbols/` (both `.ts` and `.js` versions)

   - Follow existing pattern with constructor accepting `(view, isLine?)`
   - Implement `init()` method for initialization
   - Emit `onDrawEnd` and `onDrawProgress` events

3. The `Mapper.ts` class maps `Class` names to actual implementations

### Symbol Event System

Symbols emit events caught by `SymbolEngine`:

- `onDrawProgress` - During drawing operation
- `onDrawEnd` - When drawing completes

Events bubble up via CustomEvents to `document` level for global handling.

### SIDC (Symbol Identification Code)

- 20-character code identifying symbol type
- Parsed by `SIDC` class in `MS/Support/SIDC.ts`
- Format: `PPASSSSHHAEEEEEE...` where:
  - PP: Coding scheme
  - A: Standard identity
  - SSSS: Symbol set
  - H: Status/HQ/Modifier
  - A: Amplifier
  - E: Entity

### Drawing Flow

1. User selects symbol from `Symbols.json` metadata
2. `SymbolEngine.initialize()` creates symbol instance via `Mapper`
3. Symbol handles interactive drawing via `SketchViewModel` or direct event handlers
4. On completion, symbol emits `onDrawEnd` event
5. `SymbolEngine.drawSymEnd()` creates the final `Graphic` and adds to layer
6. `AnnotationEngine` adds labels if applicable

### Graphics Layers

Managed by `GraphicsLayerManager`:

- `TACT_PT` - Tactical point symbols
- `TACT` - Tactical graphics
- `FORCE` - Force symbols
- `ANNOTATION_LAYER` - Labels and text
- `SKETCH` - Temporary sketch graphics

## Testing

The testing harness is in `src/main.ts` which:

- Creates 2D/3D map views
- Instantiates `SymbolEngine`
- Provides UI for drawing symbols
- Tests autocomplete and symbol search

## Common Patterns

### Creating a Symbol Programmatically

```typescript
const symbolEngine = new SymbolEngine(() => activeView);
const amplifier = new Amplifier();
amplifier.SIDC = '10110201004100000000';

const drawEssentials = new DrawEssentials();
drawEssentials.SIZE = 60;

symbolEngine.initialize(drawEssentials, amplifier);
```

### Handling View Switch (2D ↔ 3D)

```typescript
reactiveUtils.watch(
  () => this._getView()?.type,
  (newType: string | undefined) => {
    symbolEngine.onViewChanged(newView);
  },
);
```

## File Naming Conventions

- `.ts` files: TypeScript implementations (newer)
- `.js` files: Corresponding JavaScript versions (older, legacy)
- `.d.ts` files: TypeScript declaration files
- `__` prefix: Private/internal classes (e.g., `__Contain.ts`)
- `____` prefix: Base/abstract classes (e.g., `____UEISymbol.ts`)

## Important Notes

1. Each `.ts` file typically has a corresponding `.js` file - the JS is the original, TS is the translation
2. `milsymbol.js` is loaded via script tag in `index.html`, not as an ES module
3. The `window.MS` object provides access to the milsymbol library
4. Symbol classes must emit global CustomEvents for `SymbolEngine` to catch them
5. `dist/MS` contains the production build of the library
6. API Test and Settings panel in @index.html and @main.ts should be kept in sync with utility functions and features being added in @MS library
