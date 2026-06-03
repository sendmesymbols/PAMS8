import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(root, 'pptx_work');
const outDir = path.join(root, 'output');
const outPptx = path.join(outDir, 'PAMS8_Feature_Showcase_Clickable.pptx');
const indexSlideNo = 3;

const W = 1280;
const H = 720;
const EMU = 914400 / 96;

const C = {
  bg: '111619',
  bg2: '182127',
  panel: '202B31',
  panel2: '26363D',
  ink: 'F4F7F4',
  muted: 'A8B7B1',
  line: '50636A',
  core: '58C98B',
  engine: 'EF9F27',
  analysis: '65A7FF',
  danger: 'DC3C30',
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function write(rel, data) {
  const file = path.join(buildDir, rel);
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, data, 'utf8');
}

function clean() {
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.rmSync(outPptx, { force: true });
  mkdirp(buildDir);
  mkdirp(outDir);
}

function emu(n) {
  return Math.round(n * EMU);
}

function fontSize(pt) {
  return Math.round(pt * 100);
}

function shape(id, x, y, w, h, opts = {}) {
  const fill = opts.fill === 'none'
    ? '<a:noFill/>'
    : `<a:solidFill><a:srgbClr val="${opts.fill || C.panel}"/></a:solidFill>`;
  const line = opts.line === 'none'
    ? '<a:ln><a:noFill/></a:ln>'
    : `<a:ln w="${Math.round((opts.lineWidth || 1) * 12700)}"><a:solidFill><a:srgbClr val="${opts.line || C.line}"/></a:solidFill></a:ln>`;
  const hlink = opts.linkTo
    ? `<a:hlinkClick r:id="rId${opts.linkToRel}" action="ppaction://hlinksldjump"/>`
    : '';
  const tx = opts.text
    ? textBody(opts.text, opts)
    : '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>';
  return `
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="${id}" name="${esc(opts.name || `Shape ${id}`)}">${hlink}</p:cNvPr>
        <p:cNvSpPr/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>
        <a:prstGeom prst="${opts.geom || 'roundRect'}"><a:avLst/></a:prstGeom>
        ${fill}
        ${line}
      </p:spPr>
      ${tx}
    </p:sp>`;
}

function line(id, x1, y1, x2, y2, color = C.line, width = 1) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1) || 1;
  const h = Math.abs(y2 - y1) || 1;
  return `
    <p:cxnSp>
      <p:nvCxnSpPr><p:cNvPr id="${id}" name="Line ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
      <p:spPr>
        <a:xfrm flipV="${y2 < y1 ? 1 : 0}"><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>
        <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
        <a:ln w="${Math.round(width * 12700)}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>
      </p:spPr>
      <p:style/>
    </p:cxnSp>`;
}

function textRun(t, opts = {}) {
  const bold = opts.bold ? ' b="1"' : '';
  const italic = opts.italic ? ' i="1"' : '';
  const size = fontSize(opts.size || 16);
  const color = opts.color || C.ink;
  return `<a:r><a:rPr lang="en-US" sz="${size}"${bold}${italic}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${esc(opts.font || 'Aptos')}"/></a:rPr><a:t>${esc(t)}</a:t></a:r>`;
}

function para(text, opts = {}) {
  const marL = opts.bullet ? ' marL="285750" indent="-171450"' : '';
  const algn = opts.align ? ` algn="${opts.align}"` : '';
  const bullet = opts.bullet ? '<a:buChar char="-" />' : '<a:buNone/>';
  return `<a:p><a:pPr${marL}${algn}>${bullet}</a:pPr>${textRun(text, opts)}<a:endParaRPr lang="en-US" sz="${fontSize(opts.size || 16)}"/></a:p>`;
}

function textBody(text, opts = {}) {
  const inset = opts.inset ?? 10;
  const anchorMap = { mid: 'ctr', middle: 'ctr', center: 'ctr', top: 't', t: 't', bottom: 'b', b: 'b', ctr: 'ctr' };
  const anchor = anchorMap[opts.valign || 'mid'] || 'ctr';
  const lines = Array.isArray(text) ? text : String(text).split('\n');
  return `<p:txBody><a:bodyPr wrap="square" anchor="${anchor}" lIns="${emu(inset)}" rIns="${emu(inset)}" tIns="${emu(inset)}" bIns="${emu(inset)}"/><a:lstStyle/>${lines.map((l, i) => para(l, { ...opts, bullet: opts.bullets, bold: opts.bold && i === 0 })).join('')}</p:txBody>`;
}

function textBox(id, x, y, w, h, text, opts = {}) {
  return shape(id, x, y, w, h, { ...opts, text, fill: opts.fill ?? 'none', line: opts.line ?? 'none', geom: 'rect' });
}

const coreItems = [
  {
    title: 'Drawing & Symbol Creation',
    purpose: 'Create MIL-STD-2525D tactical graphics on 2D and 3D maps.',
    how: ['User selects a symbol and starts interactive drawing.', 'Symbol classes emit draw progress and completion events.', 'SymbolEngine renders the final graphic into the right managed layer.'],
    inputs: 'Symbol/SIDC, location, draw settings, amplifier data.',
    outputs: 'Tactical symbol graphics on FORCE, TACT_PT, TACT, or annotation layers.',
  },
  {
    title: 'Symbol Catalog',
    purpose: 'Provide a searchable catalog of tactical symbol definitions.',
    how: ['Symbol metadata is loaded from Symbols.json.', 'Search/autocomplete returns key and display name matches.', 'Selected definitions map to concrete symbol classes.'],
    inputs: 'Symbol key, SIDC, search text, category/type.',
    outputs: 'Selected metadata, symbol class, rendered tactical symbol.',
  },
  {
    title: 'Edit',
    purpose: 'Modify existing map graphics without redrawing them.',
    how: ['Point symbols move or scale.', 'Line and area symbols transform through move, rotate, and scale.', 'Completed edits refresh annotations and create undo entries.'],
    inputs: 'Selected graphic, edit mode, move/scale/rotate values.',
    outputs: 'Updated geometry, refreshed labels, undoable edit state.',
  },
  {
    title: 'Control Points',
    purpose: 'Reshape tactical lines and areas with precise handles.',
    how: ['Handles appear on stored CTRL_PTS.', 'Dragging a handle updates draw essentials.', 'The symbol redraws live from the new control points.'],
    inputs: 'CTRL_PTS, optional BASE_LN_PTS, selected line/area graphic.',
    outputs: 'Live-redrawn geometry and updated control point state.',
  },
  {
    title: 'Selection',
    purpose: 'Select and filter symbols for focused or batch actions.',
    how: ['Click selects a symbol; Shift-click toggles membership.', 'Lasso and freehand lasso select multiple graphics.', 'Filters select by SIDC, echelon, identity, and geometry type.'],
    inputs: 'Click, Shift-click, lasso polygon, filters.',
    outputs: 'Selected symbol set and hover/highlight state.',
  },
  {
    title: 'Batch Selection Operations',
    purpose: 'Organize many symbols quickly during planning.',
    how: ['Batch actions operate on the current selection.', 'Alignment and arrangement preserve relative map scale.', 'Every operation is captured as one undoable change.'],
    inputs: 'Selected graphics and operation: move, delete, align, arrange.',
    outputs: 'Moved, aligned, distributed, arranged, or deleted groups.',
  },
  {
    title: 'Copy / Paste',
    purpose: 'Duplicate single symbols or complete formations.',
    how: ['Clipboard stores deep symbol clones.', 'Paste places the copied centroid at the clicked point.', 'Multi-symbol paste preserves relative layout and optional offsets.'],
    inputs: 'Selected/right-clicked graphics, paste location, optional offset.',
    outputs: 'Cloned symbols with preserved geometry, attributes, and layout.',
  },
  {
    title: 'Undo / Redo',
    purpose: 'Recover from changes and replay reverted operations.',
    how: ['Operations push labelled undo entries.', 'Pre-edit snapshots capture geometry and control points.', 'Clear-all drops stacks to release graphic references.'],
    inputs: 'Add, edit, delete, paste, move, align, arrange operations.',
    outputs: 'Restored or replayed map state.',
  },
  {
    title: 'Context Menu',
    purpose: 'Expose the right action at the graphic location.',
    how: ['Right-click resolves target graphic and layer.', 'Menu groups actions by edit, selection, clipboard, measurement, and analysis.', 'Dynamic providers add runtime-specific actions.'],
    inputs: 'Right-click target graphic and map point.',
    outputs: 'Contextual action menu and command palette entries.',
  },
  {
    title: 'Measurement',
    purpose: 'Show live tactical measurements during drawing and inspection.',
    how: ['Draw progress feeds current geometry and control points.', 'Engine computes segment, total, area, bearing, extent, and ETA values.', 'Optional road ETA enriches route-like lines when the service exists.'],
    inputs: 'Geometry, control points, units, speed, declination, optional road network.',
    outputs: 'Length, area, bearing, ETA, labels, and measurement snapshot.',
  },
  {
    title: 'Drawing Assistance',
    purpose: 'Improve precision while placing tactical graphics.',
    how: ['Pointer movement updates rubber-band geometry.', 'Guides show bearings, snap angles, rings, and cursor coordinates.', 'Nearby symbols can be highlighted during placement.'],
    inputs: 'Cursor position, last control point, drawing cue settings.',
    outputs: 'Rubber band, distance rings, angular guides, compass overlays.',
  },
  {
    title: 'Proximity / Snapping',
    purpose: 'Relate new drawings to existing map symbols.',
    how: ['Existing symbol layers are snap candidates.', 'Pointer movement finds nearest vertex or coordinate.', 'A reusable indicator renders the dot, line, and distance label.'],
    inputs: 'Cursor position, target layers, snap radius/settings.',
    outputs: 'Nearest point indicator, distance label, snap hint.',
  },
  {
    title: 'MGRS',
    purpose: 'Render a military grid reference overlay.',
    how: ['The active view drives the current grid extent.', 'Grid levels are generated from GZD through fine sub-grids.', 'Labels and grid density adapt to enabled settings.'],
    inputs: 'Active 2D/3D view and grid-level settings.',
    outputs: 'GZD, 100 km, 10 km, 1 km, or 100 m grid lines and labels.',
  },
  {
    title: 'Import / Export',
    purpose: 'Save, reload, and exchange tactical plans.',
    how: ['Graphics serialize into JSON-safe symbol records.', 'Control points and geometry reconstruct through the drawing pipeline.', 'GeoJSON and template paths support external workflows.'],
    inputs: 'PAMS8 JSON, Plan JSON, GeoJSON, templates, file picker.',
    outputs: 'Restored symbols, saved plans, GeoJSON, and templates.',
  },
  {
    title: 'Settings / Widgets',
    purpose: 'Control feature behavior without code changes.',
    how: ['Settings widgets mutate runtime settings.', 'SymbolEngine forwards changes to active engines.', 'Feature flags enable or disable subsystems cleanly.'],
    inputs: 'Toggles, units, colors, thresholds, feature flags.',
    outputs: 'Updated engine configuration and visible UI behavior.',
  },
];

const engineItems = [
  ['SymbolEngine', 'Central coordinator for drawing, symbol creation, editing, selection, clipboard, settings, import/export, and engine access.', 'Coordinates symbol lifecycle events and delegates specialized work to sub-engines.', 'DrawEssentials, Amplifier, symbol metadata, active view, settings.', 'Final graphics, events, updated layers, engine accessors.'],
  ['EditEngine', 'Interactive move, rotate, scale, reshape, point scaling, and mixed/group transform support.', 'Uses SketchViewModel for transform operations and control-point handles for reshape.', 'Selected graphic, optional additional graphics, scale factor, control points.', 'Updated geometry, synced CTRL_PTS/BASE_LN_PTS, edit events.'],
  ['SelectionEngine', 'Manages selection state, lasso, filters, alignment, arrangement, delete, and move selected.', 'Tracks selected graphics and applies geometry transforms or filters across target layers.', 'Clicks, lasso geometry, target layers, selected graphics.', 'Selection set, highlights, arranged/moved/deleted graphics.'],
  ['ClipboardEngine', 'Owns copy, paste, paste mode, offset paste, and clone building.', 'Stores deep clones and rebuilds symbols at a target point while preserving relative layouts.', 'Source graphics, layer IDs, paste point, optional offset.', 'Pasted graphics and undoable clone operations.'],
  ['UndoRedoManager', 'Owns undo/redo stacks and edit snapshots.', 'Captures pre-edit geometry/control points and stores redoable operation closures.', 'Operation entries, edited graphics, label options.', 'Undo/redo counts, labels, restored map state.'],
  ['KeyboardShortcutManager', 'Routes global shortcuts for edit, copy/paste, undo/redo, delete, lasso, and navigation actions.', 'Listens for document keydown events and forwards to SymbolEngine delegates.', 'Keyboard events and current graphic/selection state.', 'Triggered edit, selection, clipboard, undo, redo, or navigation action.'],
  ['AnnotationEngine', 'Creates and refreshes symbol labels and annotations.', 'Reads symbol/amplifier label options and places text graphics on annotation layers.', 'Graphic, DrawEssentials, Amplifier, label settings.', 'Annotation graphics and refreshed labels after edits.'],
  ['MeasurementEngine', 'Calculates lengths, bearings, area, ETA, and measurement labels.', 'Consumes geometry/control point updates and formats values using configured units.', 'Geometry, control points, unit settings, speed, declination.', 'Measurement labels, HUD events, formatted snapshot.'],
  ['DrawingCueEngine', 'Provides live drawing overlays: guides, rings, rubber band, coordinates, and compass.', 'Activates during drawing and updates visual overlays on pointer movement.', 'Active view, target layers, cursor, last control point.', 'Guides, protractor, rings, compass, nearby highlights.'],
  ['ProximityEngine', 'Finds nearest existing geometry while drawing and renders snap indicators.', 'Snapshots candidate layers and checks nearest vertex/coordinate per pointer frame.', 'Target layers, pointer event, snap radius, distance unit.', 'Snap dot, dashed line, distance/direction label.'],
  ['MGRSEngine', 'Renders configurable MGRS grid overlays.', 'Builds grid lines and labels for enabled levels as the view changes.', 'Active view, grid options, zoom/extent.', 'MGRS grid graphics and labels.'],
  ['Symbol Support Engines', 'TemplateEngine, SymbolMetadataService, Mapper, and TextBoxEngine support symbol lookup, mapping, templates, and text boxes.', 'Metadata lookup maps user selections to concrete symbol classes and reusable templates.', 'Symbol key, search text, template data, text settings.', 'Resolved symbol definition, placement workflow, text graphics.'],
  ['Visualization / Declutter', 'Force overlays, clustering, label placement, leader lines, marker dispersal, priority, and spatial indexing.', 'Declutter sub-engines reduce visual overload while preserving tactical priority.', 'Graphics, zoom, density, echelon, label placement settings.', 'Clusters, ladders, displaced markers, placed labels, leader lines.'],
  ['MorphixEngine', 'Reads and patches editable symbol state.', 'Extracts current symbol state and applies partial edits through the same render pipeline.', 'Graphic state, amplifier patch, drawEssentials patch, options patch.', 'Updated symbol graphic with preserved geometry.'],
  ['ImportExport Engines', 'IOEngine, SerializationEngine, and Plan provide plan persistence and data exchange.', 'Serialize graphics and reconstruct through saved symbol state and geometry.', 'Plan JSON, PAMS8 JSON, GeoJSON, symbol layers.', 'Saved/loaded plans and exchange files.'],
  ['DeploymentBuilder / MissionPlanner', 'Planning workflows for reusable deployments and integrated terrain analysis.', 'DeploymentBuilder places prepared tactical plans; MissionPlanner orchestrates terrain engines.', 'AO, observers, symbols, unit/mission settings, optional road network.', 'Deployment graphics, ranked mission terrain features, reports.'],
  ['OCOKA', 'Evaluate avenues of approach.', 'Extracts approach corridors and scores them against terrain and mission factors.', 'AO center/radius, force type, slope threshold, optional road network.', 'Ranked corridors, chokepoints, score labels, slope/width overlays.', 'Width, masking, trafficability, observation exposure, cover/concealment, and obstacle restriction.'],
  ['RoadNetwork / Trafficability', 'Provide route and mobility context when an external road service is available.', 'Computes road-following distance/time and trafficability summaries for selected routes.', 'Start/end points, road service, force/mobility settings.', 'Road distance, drive time, trafficability summary.'],
];

const analysisItems = [
  ['KeyTerrainIdentificationEngine', 'Find tactically significant terrain.', 'Samples elevation, smooths terrain, computes curvature/prominence, detects terrain forms, then scores viewshed.', 'AO center/extent, radius, cell size, sensitivity, optional road network.', 'Ranked dominant ground, ridges, saddles, re-entrants, spurs, viewshed overlay.', '35% prominence + 40% viewshed + 15% elevation + 10% tactical type weight.'],
  ['PosDefScorerEngine', 'Score defensive or fighting positions.', 'Checks observation, fields of fire, cover, concealment, egress, and rear dead ground.', 'Position point, observer height, observation radius, slope radius, threat bearing, egress waypoints, optional road network.', 'Defensibility grade, factor radar, LOS spokes, egress routes, history.', 'Six factors score 0-20, then combine into a 0-100 composite with adjustable weights.'],
  ['OpRankerEngine', 'Rank candidate observation posts.', 'Computes viewshed raster for each OP, then compares total and unique AO coverage.', 'Candidate OP points, AO radius, observer height, max range.', 'Ranked OP list, recommended optimal set, coverage heatmap, gap zones.', 'Unique coverage is highest priority, then total viewshed, with masking/gap penalties.'],
  ['LocalPeaksEngine', 'Detect terrain peaks or valleys.', 'Samples elevation, smooths noise, detects local maxima/minima, filters by prominence and isolation.', 'AOI, cell size, search radius, prominence threshold, isolation threshold.', 'Ranked peaks/valleys, elevation profile, CSV/GeoJSON/Shapefile export.', 'Ranks by prominence/elevation/isolation after threshold filtering.'],
  ['DeadGroundMapper', 'Identify areas hidden from observation.', 'Compares terrain profiles from an observer to AO sample cells to separate visible and masked ground.', 'Observer point, observer height, AO/range, terrain/elevation.', 'Visible zones, dead-ground zones, summary metrics.', 'Visibility is determined by terrain line-of-sight obstruction.'],
  ['LOSEngine', 'Analyze line of sight and viewshed style coverage.', 'Tests observer-to-target rays against terrain elevation.', 'Observer/target points, observer height, terrain/elevation.', 'Visible/blocked segments or coverage overlays.', 'Terrain obstruction determines visible versus blocked paths.'],
  ['WeaponEffectEngine', 'Show weapon engagement zones.', 'Builds a directional sector from weapon range, traverse, and elevation envelope; optional terrain masking subtracts blocked areas.', 'Firing point, weapon preset/range, direction, traverse/elevation limits, optional terrain masking.', 'Engagement sector, range zones, terrain-masked areas.', 'Range limits, arc/traverse, elevation envelope, and terrain mask.'],
  ['TrajectoryEngine', 'Analyze projectile trajectory.', 'Computes and displays projectile path context against range and elevation settings.', 'Origin, target/range, launch parameters, elevation.', 'Trajectory path and impact/clearance context.', 'Ballistic path parameters and terrain/elevation context.'],
  ['BufferEngine', 'Create threat rings and distance buffers.', 'Builds configured radius zones around source graphics and highlights overlaps.', 'Source point/graphic and radius presets.', 'Rings, buffer zones, overlap/contested areas.', 'Distance thresholds and configured radius presets.'],
  ['CorridorEngine', 'Analyze corridors along routes.', 'Scores route segments inside a corridor against width and threat/intersection context.', 'Route/waypoints, corridor width, threat geometries.', 'Corridor segments and scores.', 'Segment score combines route corridor context and nearby threat geometry.'],
  ['EffectEngine / FlightEngine', 'Show effects radius overlays and UAV route/coverage analysis.', 'EffectEngine draws effects zones; FlightEngine supports UAV mission route and coverage workflows.', 'Effect source/radius or UAV route/mission inputs.', 'Effects overlays, UAV route and coverage analysis.', 'Configured radius/mission parameters and route coverage context.'],
];

function makeSlides() {
  const slides = [];
  slides.push({ kind: 'title' });
  slides.push({ kind: 'catalog' });
  slides.push({ kind: 'index' });
  slides.push({ kind: 'divider', title: 'Core Features', accent: C.core, subtitle: 'Drawing, editing, selection, measurement, navigation, and plan exchange.' });
  for (const item of coreItems) pushFeaturePair(slides, { kind: 'feature', group: 'Core Feature', accent: C.core, ...item });
  slides.push({ kind: 'divider', title: 'Engines', accent: C.engine, subtitle: 'The implementation modules behind the showcase features.' });
  for (const item of engineItems) pushFeaturePair(slides, { kind: 'feature', group: 'Engine', accent: C.engine, title: item[0], purpose: item[1], how: [item[2]], inputs: item[3], outputs: item[4], scoring: item[5] });
  for (const item of analysisItems) pushFeaturePair(slides, { kind: 'feature', group: 'Analysis Engine', accent: C.analysis, title: item[0], purpose: item[1], how: [item[2]], inputs: item[3], outputs: item[4], scoring: item[5] });
  return slides;
}

function pushFeaturePair(slides, feature) {
  slides.push(feature);
  slides.push({
    kind: 'screenshot',
    title: feature.title,
    group: feature.group,
    accent: feature.accent,
  });
}

function slideRelTargets(slideNo) {
  const rels = [];
  let id = 2;
  function add(targetSlideNo) {
    rels.push({ id, targetSlideNo });
    return id++;
  }
  return { rels, add };
}

function baseBg() {
  return [
    shape(10, 0, 0, W, H, { fill: C.bg, line: 'none', geom: 'rect' }),
    shape(11, 0, 0, W, 720, { fill: C.bg2, line: 'none', geom: 'rect' }),
    shape(12, 32, 32, 1216, 656, { fill: '151D21', line: '33444B', lineWidth: 1.2, geom: 'roundRect' }),
  ].join('');
}

function header(idStart, title, kicker, accent) {
  return [
    shape(idStart, 52, 42, 7, 48, { fill: accent, line: 'none', geom: 'rect' }),
    textBox(idStart + 1, 72, 38, 980, 28, kicker.toUpperCase(), { size: 11, color: accent, bold: true, valign: 'mid' }),
    textBox(idStart + 2, 72, 60, 980, 52, title, { size: 27, color: C.ink, bold: true, valign: 'mid' }),
    line(idStart + 3, 52, 118, 1228, 118, '33444B', 1),
  ].join('');
}

function screenshotPlaceholder(id, x, y, w, h, accent) {
  return [
    shape(id, x, y, w, h, { fill: '12191D', line: accent, lineWidth: 1.3, geom: 'roundRect' }),
    line(id + 1, x + 24, y + 24, x + w - 24, y + h - 24, '40545D', 1),
    line(id + 2, x + w - 24, y + 24, x + 24, y + h - 24, '40545D', 1),
    textBox(id + 3, x + 28, y + h / 2 - 26, w - 56, 52, 'Add screenshot here', { size: 20, color: C.muted, bold: true, align: 'ctr' }),
  ].join('');
}

function backButton(id, relId) {
  return shape(id, 52, 640, 168, 38, { text: 'Back to Index', fill: '223139', line: C.core, color: C.ink, size: 13, bold: true, align: 'ctr', linkTo: true, linkToRel: relId });
}

function navButton(id, x, y, w, text, relId, accent) {
  return shape(id, x, y, w, 34, { text, fill: '1B272C', line: accent, color: C.ink, size: 11.5, bold: true, align: 'ctr', linkTo: true, linkToRel: relId });
}

function featureSlideXml(slide, slideNo, rel) {
  const parts = [baseBg(), header(20, slide.title, slide.group, slide.accent)];
  parts.push(screenshotPlaceholder(40, 748, 152, 442, 382, slide.accent));
  parts.push(navButton(44, 858, 552, 206, 'Open screenshot slide', rel.add(slideNo + 1), slide.accent));
  parts.push(textBox(60, 72, 150, 100, 22, 'Purpose', { size: 11, color: slide.accent, bold: true }));
  parts.push(textBox(61, 72, 174, 610, 52, slide.purpose, { size: 19, color: C.ink, bold: true, valign: 'top' }));
  const how = Array.isArray(slide.how) ? slide.how : String(slide.how || '').split('|');
  parts.push(textBox(62, 72, 246, 610, 26, 'How it works', { size: 11, color: slide.accent, bold: true }));
  parts.push(textBox(63, 72, 276, 610, 88, how, { size: 14.5, color: C.ink, bullets: true, valign: 'top' }));
  parts.push(shape(64, 72, 388, 285, 128, { fill: '1A252A', line: '33444B', geom: 'roundRect' }));
  parts.push(textBox(65, 90, 402, 250, 22, 'Inputs', { size: 11, color: slide.accent, bold: true }));
  parts.push(textBox(66, 90, 430, 240, 72, slide.inputs, { size: 13.5, color: C.ink, valign: 'top' }));
  parts.push(shape(67, 382, 388, 300, 128, { fill: '1A252A', line: '33444B', geom: 'roundRect' }));
  parts.push(textBox(68, 400, 402, 250, 22, 'Outputs', { size: 11, color: slide.accent, bold: true }));
  parts.push(textBox(69, 400, 430, 260, 72, slide.outputs, { size: 13.5, color: C.ink, valign: 'top' }));
  const technical = technicalBasis(slide);
  const basisTitle = slide.scoring ? 'Scoring / technical basis' : 'Technical basis';
  const basisText = slide.scoring ? `${slide.scoring}\n${technical}` : technical;
  parts.push(shape(70, 72, 520, 610, 112, { fill: slide.scoring ? '1F1B14' : '15212A', line: slide.accent, lineWidth: 1.2, geom: 'roundRect' }));
  parts.push(shape(73, 72, 520, 4, 112, { fill: slide.accent, line: 'none', geom: 'rect' }));
  parts.push(textBox(71, 92, 528, 560, 20, basisTitle, { size: 10.5, color: slide.accent, bold: true }));
  parts.push(textBox(72, 92, 552, 580, 76, basisText, { size: 11, color: C.ink, valign: 'top' }));
  parts.push(backButton(90, rel.add(indexSlideNo)));
  return slideXml(parts.join(''));
}

function screenshotSlideXml(slide, rel) {
  const parts = [baseBg(), header(20, `${slide.title} Screenshot`, `${slide.group} visual`, slide.accent)];
  parts.push(screenshotPlaceholder(40, 92, 150, 1088, 480, slide.accent));
  parts.push(textBox(46, 110, 596, 980, 28, 'Paste or insert a live application screenshot here. This slide is intentionally blank for your demo visuals.', { size: 14, color: C.muted, align: 'ctr' }));
  parts.push(backButton(90, rel.add(indexSlideNo)));
  parts.push(navButton(91, 1010, 640, 190, 'Back to feature', rel.add(findFeatureSlideNo(slide.title)), slide.accent));
  return slideXml(parts.join(''));
}

function technicalBasis(slide) {
  const byTitle = {
    // ── Core Features ─────────────────────────────────────────────────────
    'Drawing & Symbol Creation': 'SketchViewModel drives point/polyline/polygon draw modes. Symbol class is resolved via Mapper from Symbols.json metadata, then DrawEssentials + Amplifier wrap the geometry. On draw events, MeasurementEngine + ProximityEngine + DrawingCueEngine attach live overlays; on complete the final Graphic is routed to FORCE / TACT_PT / TACT layers by symbol geometry type, undo is pushed, and AnnotationEngine refreshes labels.',
    'Symbol Catalog': 'SymbolMetadataService loads Symbols.json into an in-memory SIDC → SymbolDefinition map indexed by key, name tokens, and SymGeoType. Autocomplete uses prefix + token-substring matching with rank by Class. Selection sets the active class, parameters, and default DrawEssentials; Mapper resolves the class name into the concrete TS/JS symbol implementation registered on the engine.',
    'Edit': 'EditEngine activates SketchViewModel’s move tool for point symbols and its transform tool (move + rotate + scale) for polylines / polygons; reshape uses draggable control-point handles on stored CTRL_PTS. A pre-edit snapshot (GEOM + CTRL_PTS + BASE_LN_PTS) is captured before activation so Cancel restores it. On complete the symbol re-renders, annotations refresh, and a single labelled undo entry is pushed.',
    'Control Points': 'Reshape draws one handle Graphic per entry in the symbol’s CTRL_PTS array on a dedicated EDIT_HANDLES layer. Drag events update the source array, then symbol create/redraw rebuilds geometry through the same pipeline used at draw time. Handle redraws are coalesced via requestAnimationFrame to keep panning responsive; BASE_LN_PTS stays in sync with CTRL_PTS for line-anchored amplifiers.',
    'Selection': 'SelectionEngine maintains a Set<Graphic> across managed symbol layers with click / Shift-click toggle and a SketchViewModel-driven lasso polygon. Highlights use ArcGIS LayerView.highlight() so the selection survives layer redraws. Filters (SIDC, echelon, identity, SymGeoType) read attributes + DrawEssentials and apply across all symbol layers at once.',
    'Batch Selection Operations': 'Operations compute geometry deltas from selected centroids/extents and apply them in one atomic pass. Alignment uses min/max projection along the chosen axis; distribution uses equal-spacing between extremes; arrangement (square / triangle / inverted-triangle) positions members on a generated layout grid. Each operation pushes one undo entry that captures pre-op snapshots for every affected graphic.',
    'Copy / Paste': 'ClipboardEngine deep-clones selected graphics via Graphic.clone(), preserving geometry, symbol, DrawEssentials, Amplifier, and attributes. Paste computes the clipboard centroid, then offsets every clone by (paste-point − centroid) to preserve relative formation layout. Offset-paste accepts a distance + bearing for radial expansion. Each paste is one undo entry.',
    'Undo / Redo': 'UndoRedoManager owns LIFO undo / redo stacks of labelled closures plus pre-edit snapshots (geometry, CTRL_PTS, BASE_LN_PTS, additional-graphics state). EditEngine fires before-edit events that push snapshots and after-edit events that finalize closures. New operations clear the redo stack; clear-all drops both stacks to release Graphic references for GC.',
    'Context Menu': 'ContextMenuManager listens for view "pointer-down" with button 2, hit-tests through hitTest(), and resolves the topmost managed graphic + its layer ID. Static menu items are registered per layer ID; dynamic providers add runtime entries (analysis, deployments, measurement). Trees are grouped by action class (edit / select / clipboard / measure / analyze) and rendered as a positioned HTML overlay.',
    'Measurement': 'Geometry updates feed geometryEngine for geodesic length / area, and a per-segment cosine-law bearing with optional magnetic-declination offset. Optional 3D slant range uses observer-to-target elevation delta. Auto-unit picks m↔km or ft↔mi by magnitude; march ETA divides length by speedKmh; road ETA defers to the optional RoadNetwork service and falls back silently to straight-line.',
    'Drawing Assistance': 'DrawingCueEngine maintains a dedicated cue layer and a debounced (50 ms) pointer handler. Cues are generated from the last committed control point and current cursor: rubber-band polyline, angular guides (snap by snapIntervalDeg with snapThresholdDeg tolerance), distance rings with an adaptive interval driven by view scale, nearby-highlight rings, and a magnetic-compass widget with declination offset.',
    'Proximity / Snapping': 'Per pointer-move, candidate graphics are snapshotted from configured target layers and bbox-pre-filtered against a screen-space halfDiag extent. Survivors are tested for nearest vertex / nearest coordinate within snapRadiusPx; the winner renders a reusable dot + dashed line + distance label and emits proximity-snap / proximity-clear / proximity-hint document events.',
    'MGRS': 'MGRSEngine derives the visible extent from the active view, computes Grid Zone Designator, 100 km, 10 km, 1 km, and 100 m cells using UTM ↔ MGRS conversion, and emits per-level polyline + label graphics on its own MGRS layer. Level visibility is gated by zoom thresholds (or explicit toggles); a debounced rebuild runs on view extent / zoom changes so 2D and 3D stay in sync.',
    'Import / Export': 'SerializationEngine writes JSON-safe records (SIDC + GEOM + CTRL_PTS + BASE_LN_PTS + DrawEssentials + Amplifier + attributes). IOEngine handles file dialogs, base64 / Blob download, and format dispatch (PAMS8 JSON, Plan JSON, GeoJSON, templates). Restore replays the rendering pipeline through SymbolEngine.initialize() so the result matches an interactively drawn symbol bit-for-bit.',
    'Settings / Widgets': 'Per-feature widgets own a SettingsManifest (schema + defaults). UI changes dispatch a settingsChanged CustomEvent on window; SymbolEngine.onSettingChanged(path, value) walks the runtime settings tree and forwards the patch to active engines via setOptions / updateConfig. Feature flags toggle subsystem availability at runtime without rebuilding the engine.',

    // ── Engines ──────────────────────────────────────────────────────────
    'SymbolEngine': 'Central mediator. Owns GraphicsLayerManager (FORCE, TACT, TACT_PT, ANNOTATION, SKETCH), wires SketchViewModel, instantiates and disposes sub-engines on view switch, listens for symbol onDrawProgress / onDrawEnd CustomEvents, exposes the public API (addMilSymbolAtCenter, clearAllGraphics, undo, redo, copy / paste …), and routes settingsChanged events to active engines.',
    'EditEngine': 'Activates SketchViewModel’s move tool for points and its transform tool (move + rotate + scale) for poly geometries; reshape uses a dedicated handle layer with rAF-coalesced drag updates. Mixed-selection transforms compute a shared anchor + rotation around the centroid so grouped point + line + polygon members move coherently. Emits changeInSymbol / scalePointSymbol events for undo + annotation.',
    'SelectionEngine': 'Tracks selected graphics in a Map<id, Graphic> across symbol layers with ArcGIS highlight tinting. Implements click / Shift-toggle / lasso (SketchViewModel polygon) selection, clone-drag (Ctrl-drag duplicate), batch alignment / distribution / formation arrange, filter selection (SIDC, echelon, identity, geometry type), and emits selectionChange events.',
    'ClipboardEngine': 'Deep-clones source graphics; computes the source centroid and rebuilds each member at (target − centroid + memberOffset) so formations preserve relative layout. Offset-paste accepts a vector (distance + bearing) for radial expansion. Integrates with UndoRedoManager so each paste is one entry, and triggers AnnotationEngine for restored labels.',
    'UndoRedoManager': 'LIFO undo + redo stacks of { label, undo, redo } closures. Pre-edit snapshots capture geometry, CTRL_PTS, BASE_LN_PTS, and any additional-graphics state before EditEngine activates. Push clears the redo stack; clear-all drops both stacks to release Graphic references. Public undoCount / redoCount drive UI affordances and the API panel.',
    'KeyboardShortcutManager': 'Document-level keydown listener that suppresses events targeted at <input>/<textarea>/contenteditable, normalizes Cmd ↔ Ctrl, and dispatches to SymbolEngine delegates (undo, redo, copy, cut, paste, delete, lasso, escape, info, center). Routing favors current edit state, then selection, then last clicked graphic; combos register in declaration order.',
    'AnnotationEngine': 'Owns the ANNOTATION layer. Reads Amplifier label fields + DrawEssentials placement to position each label relative to its parent geometry (offset by font size). Hides annotations during edit / drag; rebuilds after draw, edit, paste, delete, and selection moves so labels stay attached to symbols. Cooperates with the declutter LabelPlacer when enabled.',
    'MeasurementEngine': 'On every draw / sketch update event, computes segment length, total length, bearing, geodesic area, bounding-box extent, slant range, and ETA. Uses geometryEngine for geodesic math and an internal formatter for unit + bearing (decimal / mils / quadrant) + autoUnit scaling. Optional road-following ETA via RoadNetworkEngine. Emits measurement-update events for HUD + widgets.',
    'DrawingCueEngine': 'Cue overlays live on a dedicated GraphicsLayer with a 50 ms debounce on pointer-move. Active cues: rubber band, angular guides + protractor arc + fan, anchor cross, distance rings (fixed or adaptive to view scale, capped at maxOuterKm), nearby-highlight rings, cursor coordinate label, and the multi-instance magnetic compass widget.',
    'ProximityEngine': 'Per pointer-move, snapshots candidates from target layers, bbox-pre-filters by screen-space halfDiag, then tests nearest vertex / nearest coordinate within snapRadiusPx. Reuses dot + dashed line + label graphics across frames to avoid GC pressure. Emits proximity-snap / proximity-clear / proximity-hint document events for HUD + audit logs.',
    'MGRSEngine': 'Derives extent from the active view and rebuilds the overlay on extent / zoom changes (debounced). Generates GZD, 100 km, 10 km, 1 km, and 100 m cell polylines + labels using UTM ↔ MGRS conversion. Per-level visibility is gated by zoom thresholds, with independent color / opacity / width settings; 2D and 3D share the same rebuild path.',
    'Symbol Support Engines': 'SymbolMetadataService loads + indexes Symbols.json by SIDC, key, and name tokens; Mapper resolves class names into concrete TS/JS symbol implementations; TemplateEngine pre-fills DrawEssentials + Amplifier for known SIDC patterns and persists user templates; TextBoxEngine draws multi-line styled text graphics. Keeps catalog and decoration concerns out of SymbolEngine.',
    'Visualization / Declutter': 'SpatialIndex is a grid-bucketed R-tree-style index over symbol screen positions for O(1) neighbour queries. ClusterEngine groups by radius + identity; PriorityResolver ranks by echelon + identity to decide who survives; MarkerDisperser fans co-located symbols out radially; LadderEngine builds halyard-style stacks at high zoom; LabelPlacer runs an 8-position try-fit with leader lines on overflow. DeclutterEngine orchestrates the pipeline and re-runs on pan / zoom with debounce.',
    'MorphixEngine': 'Reads editable symbol state into a kind-aware shape (Point / FPoint / Line / Area), then applies partial patches (amplifier, drawEssentials, options, extraSettings) through the same render pipeline used at draw time. Geometry, CTRL_PTS, and BASE_LN_PTS are preserved; emits update events so AnnotationEngine and UndoRedoManager pick up changes automatically.',
    'ImportExport Engines': 'SerializationEngine maps Graphic → JSON-safe symbol records (SIDC + GEOM + CTRL_PTS + BASE_LN_PTS + DrawEssentials + Amplifier + attributes). Plan.ts owns the PlanDocument schema (metadata + symbols[] + overlays[]). IOEngine drives file dialogs, base64 / Blob download, and format dispatch (PAMS8 JSON, Plan JSON, GeoJSON, templates). Restore replays SymbolEngine.initialize() per record so output matches interactive draws.',
    'DeploymentBuilder / MissionPlanner': 'DeploymentBuilder reads reusable formation templates and places them at a user-anchored centroid, rebuilding constituent symbols through the SymbolEngine draw pipeline. MissionPlannerEngine composes existing terrain engines (KeyTerrain, OpRanker, DeadGround, Corridor) along a route or AO and emits a ranked MissionTerrainFeature[] for the dashboard rather than duplicating terrain math.',
    'OCOKA': 'Samples a terrain grid over the AO and scores five OCOKA dimensions: Observation (LOS / viewshed), Cover (terrain masking), Concealment (curvature + vegetation proxy), Key terrain (delegated to KeyTerrain output), Avenues (corridors via CorridorEngine). Dimension weights are configurable; output is a per-cell 0–100 heatmap plus ranked corridors with width / trafficability / threat exposure scores. Degrades to terrain-only when the road service is offline.',
    'RoadNetwork / Trafficability': 'RoadNetworkEngine wraps an optional external road service: queries nearest road, performs A* / Dijkstra-style routing, and classifies edges (highway / major / minor / track). TrafficabilityEngine augments route segments with terrain-derived attributes (slope, vegetation proxy, wetness) per road class and assigns GO / SLOW-GO / NO-GO. Both fail gracefully — failed calls leave straight-line or terrain-only results intact.',

    // ── Analysis Engines ──────────────────────────────────────────────────
    'KeyTerrainIdentificationEngine': 'Samples a configurable elevation grid (20–70 m cell) via ElevationSampler, applies a 3×3 Gaussian smooth, derives Laplacian + plan / profile curvature for landform class, computes prominence within a radius, and runs 36-ray viewshed scoring at each candidate. Ranks features (dominant ground / ridge / saddle / re-entrant / spur) by 35% prominence + 40% viewshed + 15% elevation + 10% type weight.',
    'PosDefScorerEngine': 'Six factors scored 0–20 from the observer point: observation (% visible rays), fields of fire (threat-sector coverage), cover-from-fire (terrain masking), cover-from-view (reverse LOS blocking), egress (terrain + optional RoadNetwork routing), rear dead ground (cells below the rear horizon). Ray casting defaults to 10° resolution and uses haversine for ground distances. Composite 0–100 with per-factor weights; emits radar + LOS spokes + egress overlays.',
    'OpRankerEngine': 'For each candidate OP, casts horizon rays at ~2° resolution out to maxRange (3.5 km default) and rasterises a coverage layer on a 30–80 m cell grid inside the AO. Combines results with a greedy max-coverage set selector to recommend an optimal k-OP team that maximises unique AO coverage; outputs per-OP unique%, total%, gap area, and an aggregated count heatmap with road-access enrichment.',
    'LocalPeaksEngine': 'ElevationSampler builds a regular grid over the AOI, 3×3 Gaussian smooths it, then scans 3×3 neighbourhoods for local maxima / minima. Each candidate is filtered by topographic prominence (height above the connecting saddle) and isolation (distance to the next higher peak). Surviving features rank by a prominence × elevation × isolation composite; outputs CSV / GeoJSON / Shapefile and an elevation profile cross-section.',
    'DeadGroundMapper': 'Builds a per-bearing horizon cache from the observer, then samples AO cells and classifies each by (observer-LOS angle − target-ground angle). Renders depth-coloured heatmap (continuous ramp), binary visible / masked, range-fade, or quadrant-hued modes. 3D adds a viewshed dome (azimuth × elevation rays) with cap / skirt mesh and contour bands.',
    'LOSEngine': 'Ray-casts at fixed angular resolution between observer and target using ElevationSampler; checks target slope against the maximum intervening terrain slope. 3D views additionally call ArcGIS ViewshedAnalysis for dome rendering. Maintains three layers (los-analysis, los-observer, los-committed) so working / persisted results stay separate; supports multi-target lists and per-target visible / blocked segments.',
    'WeaponEffectEngine': 'Builds a directional sector from a preset (Direct Fire / Mortar / Artillery 155 / ATGM / Anti-Air / Anti-Armor) parameterised by min / max range (50 m – 30 km), azimuth spread (60–360°), elevation envelope (−10°–90°), and extrude height. Generates inner / outer geodesic rings + a 3D dome via ENU → WGS84 transform. Optional terrain masking subtracts blocked cells.',
    'TrajectoryEngine': 'Solves projectile motion via an RK4-style ODE integrator with eight presets (60 / 81 / 120 mm mortars, 105 / 155 mm artillery, ATGM, RPG-7, loitering munition). Inputs: launch angle, muzzle velocity 115–827 m/s, azimuth, wind speed / bearing, Coriolis. Outputs apogee, time-of-flight, impact point, and a preset CEP (1–70 m). Renders arc + apogee mark + impact circle.',
    'BufferEngine': 'Builds geodesic ring polygons at configurable radii around single / unioned / corridor sources using geometryEngine.geodesicBuffer. Six presets cover 155 mm artillery, 81 mm mortar, ATGM, IED / VBIED, NBC, and observation post; rings are colour-coded by threat tier (safe / warning / lethal / dead / exclusion / info). Overlaps are highlighted via union + intersect for contested areas.',
    'CorridorEngine': 'Densifies the route to 20–40 m segments, scores each segment for terrain exposure (slope + LOS-ability to threats), and detects chokepoints by clustering high-exposure cells. Threat overlays at 700–3000 m radius shade segments by risk tier. Optional road-following via RoadNetworkEngine adds true distance, drive time, and trafficability; emits an average exposure score 0–100 plus per-segment rendering.',
    'EffectEngine / FlightEngine': 'EffectEngine draws munition-effects circles around source graphics using preset radii (frag, blast, casualty), colour-banded by lethality tier. FlightEngine models low-level helicopter / UAV legs with terrain masking, wind drift, and optional road-following for ingress; renders the flight path, LOS-to-threat shading, and nap-of-earth feasibility with altitude / climb / turn-radius constraints.',
  };
  return byTitle[slide.title] || 'Uses ArcGIS graphics, managed layers, symbol metadata, and runtime settings to keep the workflow consistent in 2D and 3D.';
}

function titleSlideXml() {
  const parts = [baseBg()];
  parts.push(shape(20, 70, 78, 8, 96, { fill: C.core, line: 'none', geom: 'rect' }));
  parts.push(textBox(21, 94, 70, 760, 34, 'PAMS8 SHOWCASE', { size: 13, color: C.core, bold: true }));
  parts.push(textBox(22, 94, 118, 800, 118, 'PAMS8: Military Standard 2525D Symbol Drawing Library', { size: 36, color: C.ink, bold: true, valign: 'top' }));
  parts.push(textBox(23, 96, 262, 710, 72, 'Draw, edit, analyze, and manage tactical map symbols in 2D and 3D.', { size: 22, color: C.muted, valign: 'top' }));
  parts.push(shape(24, 88, 404, 250, 112, { fill: '1B292F', line: C.core, lineWidth: 1.4, geom: 'roundRect' }));
  parts.push(textBox(25, 110, 418, 210, 58, '954', { size: 42, color: C.core, bold: true, align: 'ctr' }));
  parts.push(textBox(26, 110, 482, 210, 28, 'symbol definitions', { size: 14, color: C.ink, bold: true, align: 'ctr' }));
  parts.push(shape(27, 736, 82, 396, 446, { fill: '12191D', line: '33444B', geom: 'roundRect' }));
  parts.push(textBox(28, 772, 128, 324, 82, 'Native tactical drawing + analysis workflows', { size: 26, color: C.ink, bold: true, align: 'ctr', valign: 'mid' }));
  parts.push(textBox(29, 780, 260, 308, 150, ['2D / 3D view support', 'MIL-STD-2525D rendering', 'Editable symbols and plans', 'Terrain and route analysis'], { size: 16, color: C.muted, bullets: true, valign: 'top' }));
  parts.push(shape(30, 944, 640, 190, 38, { text: 'Open Index', fill: '223139', line: C.core, color: C.ink, size: 13, bold: true, align: 'ctr', linkTo: true, linkToRel: 2 }));
  return slideXml(parts.join(''));
}

function catalogSlideXml() {
  const parts = [baseBg(), header(20, 'Symbol Catalog Snapshot', 'Opening proof', C.core)];
  const metrics = [
    ['954', 'Total symbols'],
    ['511', 'Force point'],
    ['325', 'Tactical point'],
    ['62', 'Area'],
    ['56', 'Line'],
  ];
  metrics.forEach((m, i) => {
    const x = 82 + i * 230;
    parts.push(shape(40 + i, x, 178, 182, 116, { fill: i === 0 ? '20382D' : '1A252A', line: i === 0 ? C.core : '33444B', geom: 'roundRect' }));
    parts.push(textBox(60 + i, x + 10, 196, 162, 48, m[0], { size: i === 0 ? 36 : 31, color: i === 0 ? C.core : C.ink, bold: true, align: 'ctr' }));
    parts.push(textBox(80 + i, x + 12, 248, 158, 28, m[1], { size: 13, color: C.muted, bold: true, align: 'ctr' }));
  });
  parts.push(shape(90, 102, 388, 1030, 144, { fill: '151D21', line: '33444B', geom: 'roundRect' }));
  parts.push(textBox(91, 136, 420, 450, 42, 'What this proves', { size: 24, color: C.ink, bold: true }));
  parts.push(textBox(92, 136, 474, 920, 52, 'PAMS8 is not a single-symbol demo. It is a broad tactical drawing and planning library with force symbols, tactical points, areas, lines, and analysis workflows operating across both 2D and 3D map views.', { size: 18, color: C.muted, valign: 'top' }));
  parts.push(shape(93, 944, 640, 190, 38, { text: 'Open Index', fill: '223139', line: C.core, color: C.ink, size: 13, bold: true, align: 'ctr', linkTo: true, linkToRel: 2 }));
  return slideXml(parts.join(''));
}

function indexSlideXml(rel) {
  const parts = [baseBg(), header(20, 'Clickable Index', 'Navigation', C.core)];
  parts.push(textBox(30, 72, 126, 1120, 22, 'Click any tile to jump to its feature slide. Each slide has a Back to Index button.', { size: 12.5, color: C.muted }));

  // Column geometry — three balanced columns with consistent gutters
  const colY = 168;            // top of the section header strip
  const headerH = 44;          // section header strip height
  const tileTop = colY + headerH + 14;
  const tileH = 30;
  const tileGap = 6;

  // Column-1 (Core): full list of coreItems
  const col1X = 56;
  const col1W = 380;

  // Column-2 (Engines): 9 engine slots split into two micro-columns of width 184 + 184
  const col2X = 456;
  const col2W = 380;

  // Column-3 (Analysis): 11 analysis slots in a single narrow column
  const col3X = 856;
  const col3W = 372;

  const sections = [
    { x: col1X, w: col1W, title: 'Core Features',    accent: C.core,     items: coreItems.map((it) => ({ label: it.title, slide: findFeatureSlideNo(it.title) })) },
    { x: col2X, w: col2W, title: 'Engines',          accent: C.engine,   items: engineItems.map((it) => ({ label: it[0], slide: findFeatureSlideNo(it[0]) })) },
    { x: col3X, w: col3W, title: 'Analysis Engines', accent: C.analysis, items: analysisItems.map((it) => ({ label: it[0], slide: findFeatureSlideNo(it[0]) })) },
  ];

  let idCursor = 100;
  sections.forEach((sec, sIdx) => {
    // Section header strip — accent rail + title + count badge
    parts.push(shape(idCursor++, sec.x, colY, 6, headerH, { fill: sec.accent, line: 'none', geom: 'rect' }));
    parts.push(textBox(idCursor++, sec.x + 16, colY + 4, sec.w - 80, 18, String(sIdx + 1).padStart(2, '0'), { size: 9.5, color: sec.accent, bold: true }));
    parts.push(textBox(idCursor++, sec.x + 16, colY + 18, sec.w - 80, 26, sec.title, { size: 17, color: C.ink, bold: true, valign: 'mid' }));
    // Count badge (pill)
    const badgeW = 56;
    const badgeX = sec.x + sec.w - badgeW;
    parts.push(shape(idCursor++, badgeX, colY + 12, badgeW, 22, { fill: '17242A', line: sec.accent, lineWidth: 1, text: `${sec.items.length} items`, size: 9.5, color: sec.accent, bold: true, align: 'ctr', geom: 'roundRect' }));
    // Divider under header
    parts.push(line(idCursor++, sec.x, colY + headerH + 4, sec.x + sec.w, colY + headerH + 4, sec.accent, 1.2));

    // Items — two micro-columns when the list is long (engines has 18 entries)
    const useSplit = sec.items.length > 11;
    const microW = useSplit ? Math.floor((sec.w - 8) / 2) : sec.w;
    const halfLen = useSplit ? Math.ceil(sec.items.length / 2) : sec.items.length;

    sec.items.forEach((it, i) => {
      const micro = useSplit && i >= halfLen ? 1 : 0;
      const row = useSplit && i >= halfLen ? i - halfLen : i;
      const tx = sec.x + (useSplit ? micro * (microW + 8) : 0);
      const ty = tileTop + row * (tileH + tileGap);

      // Tile body
      parts.push(shape(idCursor++, tx, ty, microW, tileH, { fill: '141C20', line: 'none', geom: 'roundRect', linkTo: true, linkToRel: rel.add(it.slide) }));
      // Accent left rail
      parts.push(shape(idCursor++, tx, ty, 3, tileH, { fill: sec.accent, line: 'none', geom: 'rect' }));
      // Index number (small, muted)
      const numW = 28;
      parts.push(textBox(idCursor++, tx + 8, ty, numW, tileH, String(i + 1).padStart(2, '0'), { size: 8.5, color: sec.accent, bold: true, valign: 'mid', align: 'ctr', font: 'Consolas' }));
      // Label (truncated client-side via column width — PPTX wraps)
      const labelX = tx + 8 + numW + 4;
      const labelW = microW - (8 + numW + 4) - 18;
      parts.push(textBox(idCursor++, labelX, ty, labelW, tileH, it.label, { size: useSplit ? 9.5 : 10.5, color: C.ink, bold: true, valign: 'mid' }));
      // Arrow chevron on the right
      parts.push(textBox(idCursor++, tx + microW - 18, ty, 14, tileH, '›', { size: 14, color: sec.accent, bold: true, valign: 'mid', align: 'ctr' }));
    });
  });

  // Footer legend strip
  const footerY = 660;
  parts.push(line(idCursor++, 56, footerY - 8, 1228, footerY - 8, '33444B', 0.8));
  parts.push(shape(idCursor++, 56, footerY, 8, 8, { fill: C.core, line: 'none', geom: 'rect' }));
  parts.push(textBox(idCursor++, 70, footerY - 6, 160, 22, 'Core', { size: 10, color: C.muted, valign: 'mid' }));
  parts.push(shape(idCursor++, 130, footerY, 8, 8, { fill: C.engine, line: 'none', geom: 'rect' }));
  parts.push(textBox(idCursor++, 144, footerY - 6, 160, 22, 'Engine', { size: 10, color: C.muted, valign: 'mid' }));
  parts.push(shape(idCursor++, 210, footerY, 8, 8, { fill: C.analysis, line: 'none', geom: 'rect' }));
  parts.push(textBox(idCursor++, 224, footerY - 6, 160, 22, 'Analysis', { size: 10, color: C.muted, valign: 'mid' }));
  const totalCount = coreItems.length + engineItems.length + analysisItems.length;
  parts.push(textBox(idCursor++, 980, footerY - 6, 248, 22, `${totalCount} features · 93 slides`, { size: 10, color: C.muted, bold: true, valign: 'mid', align: 'r', font: 'Consolas' }));

  return slideXml(parts.join(''));
}

function findFeatureSlideNo(title) {
  const index = allSlides.findIndex((slide) => slide.kind === 'feature' && slide.title === title);
  if (index < 0) throw new Error(`Could not find feature slide for ${title}`);
  return index + 1;
}

function dividerSlideXml(slide, rel) {
  const parts = [baseBg()];
  parts.push(shape(20, 76, 106, 8, 244, { fill: slide.accent, line: 'none', geom: 'rect' }));
  parts.push(textBox(21, 108, 112, 900, 78, slide.title, { size: 48, color: C.ink, bold: true }));
  parts.push(textBox(22, 112, 214, 800, 66, slide.subtitle, { size: 22, color: C.muted, valign: 'top' }));
  parts.push(shape(23, 108, 364, 420, 72, { text: 'Use the index to jump directly to any topic.', fill: '1A252A', line: slide.accent, color: C.ink, size: 17, bold: true, align: 'ctr' }));
  parts.push(backButton(24, rel.add(indexSlideNo)));
  return slideXml(parts.join(''));
}

function slideXml(spTree) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      ${spTree}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function slideRelsXml(rel) {
  const rows = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>',
    ...rel.rels.map((r) => `<Relationship Id="rId${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slide${r.targetSlideNo}.xml"/>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows.join('')}</Relationships>`;
}

function writeStaticParts(slideCount) {
  write('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  ${Array.from({ length: slideCount }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('\n  ')}
</Types>`);
  write('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  write('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>PAMS8 Feature Showcase</dc:title><dc:creator>Codex</dc:creator><cp:lastModifiedBy>Codex</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2026-06-03T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-06-03T00:00:00Z</dcterms:modified></cp:coreProperties>`);
  write('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft PowerPoint</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${slideCount}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Theme</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>PAMS8 Feature Showcase</vt:lpstr></vt:vector></TitlesOfParts></Properties>`);
  write('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${Array.from({ length: slideCount }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>
  <p:sldSz cx="${emu(W)}" cy="${emu(H)}" type="wide"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle/>
</p:presentation>`);
  write('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${Array.from({ length: slideCount }, (_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}<Relationship Id="rId${slideCount + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`);
  write('ppt/theme/theme1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="PAMS8 Tactical"><a:themeElements><a:clrScheme name="PAMS8"><a:dk1><a:srgbClr val="${C.bg}"/></a:dk1><a:lt1><a:srgbClr val="${C.ink}"/></a:lt1><a:dk2><a:srgbClr val="${C.bg2}"/></a:dk2><a:lt2><a:srgbClr val="${C.muted}"/></a:lt2><a:accent1><a:srgbClr val="${C.core}"/></a:accent1><a:accent2><a:srgbClr val="${C.engine}"/></a:accent2><a:accent3><a:srgbClr val="${C.analysis}"/></a:accent3><a:accent4><a:srgbClr val="${C.danger}"/></a:accent4><a:accent5><a:srgbClr val="7A8C92"/></a:accent5><a:accent6><a:srgbClr val="C7D1CC"/></a:accent6><a:hlink><a:srgbClr val="${C.core}"/></a:hlink><a:folHlink><a:srgbClr val="${C.engine}"/></a:folHlink></a:clrScheme><a:fontScheme name="PAMS8"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="PAMS8"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`);
  write('ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`);
  write('ppt/slideMasters/_rels/slideMaster1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`);
  write('ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  write('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
}

const allSlides = makeSlides();

function main() {
  clean();
  writeStaticParts(allSlides.length);
  allSlides.forEach((slide, i) => {
    const no = i + 1;
    const rel = slideRelTargets(no);
    let xml;
    if (slide.kind === 'title') {
      rel.add(indexSlideNo);
      xml = titleSlideXml();
    } else if (slide.kind === 'catalog') {
      rel.add(indexSlideNo);
      xml = catalogSlideXml();
    } else if (slide.kind === 'index') {
      xml = indexSlideXml(rel);
    } else if (slide.kind === 'divider') {
      xml = dividerSlideXml(slide, rel);
    } else if (slide.kind === 'screenshot') {
      xml = screenshotSlideXml(slide, rel);
    } else {
      xml = featureSlideXml(slide, no, rel);
    }
    write(`ppt/slides/slide${no}.xml`, xml);
    write(`ppt/slides/_rels/slide${no}.xml.rels`, slideRelsXml(rel));
  });
  fs.writeFileSync(path.join(root, 'deck_manifest.json'), JSON.stringify({
    title: 'PAMS8 Feature Showcase',
    slideCount: allSlides.length,
    indexSlide: indexSlideNo,
    output: outPptx,
    sections: {
      coreFeatures: coreItems.length,
      engineSlides: engineItems.length,
      analysisSlides: analysisItems.length,
    },
  }, null, 2));
  console.log(JSON.stringify({ slideCount: allSlides.length, buildDir, outPptx }, null, 2));
}

main();
