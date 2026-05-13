Memory Leaks (High)

setupEventHandlers() registers pointer-move and click on the view in the constructor, but deactivate() never calls removeEventHandlers(). Every UEISymbol instance leaks two permanent view event listeners. Fix: call removeEventHandlers() inside deactivate().
The eventListeners Map (local on/off system) is populated but never cleared on deactivate().
Dead Code (Medium)

createSymbolData() (UEISymbol.ts:164) and createFallbackSymbol() (UEISymbol.ts:204) are never called. The call was commented out at line 89 and replaced inline in init(). Both methods are dead weight.
drawEnd() (UEISymbol.ts:312) has an empty if (spatialRef.isWebMercator) block that does nothing, then immediately calls onDrawEnd. The method is just a passthrough — it can be eliminated.
var drawEssentials = new DrawEssentials() at line 151 is created unconditionally, but the options.GEOM branch overwrites it immediately, and the else branch never uses it.
Type Safety (Medium)

_ueiData, _height, _width, _ptSymbol, _options, mouseMoveHandler, clickHandler are all typed any. The marker result from milsymbol has a known shape — you could define a MilSymbolMarker interface with asCanvas(), height, width, markerAnchor.
Logic Issues (Medium)

placeSymbolImmediately() calls this.createDrawEssentials() and passes the result to drawEnd(), but drawEnd() ignores it and creates nothing — it just forwards the already-received drawEssentials through to emit. Conversely, placeSymbolAtPoint() passes this._options (not a DrawEssentials) as the third arg to onDrawEnd, so the emitted event carries inconsistent payload types.
The dual event system is redundant: emit() fires both local eventListeners listeners and a global CustomEvent. SymbolEngine only listens to the global event; nothing uses the local on()/off() API. You can drop the Map<string, Function[]> entirely.
Minor / Style

var at line 151 should be const/let.
All the opts.field || '' assignments in init() (lines 94–115) could be extracted into a small helper or object spread to avoid 20 near-identical lines.
Comments describing what the code does (// Create symbol data using milsymbol library, // Remove temporary graphic, etc.) add noise without adding value.
layerManager.initializeLayers() is called every time a UEISymbol is constructed — that's redundant if GraphicsLayerManager is a singleton that's already initialized.