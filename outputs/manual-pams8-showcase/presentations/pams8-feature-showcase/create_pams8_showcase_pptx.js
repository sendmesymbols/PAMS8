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
  parts.push(shape(70, 72, 536, 610, 84, { fill: slide.scoring ? '211F1A' : '17232A', line: slide.accent, lineWidth: 1, geom: 'roundRect' }));
  parts.push(textBox(71, 90, 544, 220, 20, basisTitle, { size: 11, color: slide.accent, bold: true }));
  parts.push(textBox(72, 90, 568, 560, 38, basisText, { size: 12.2, color: C.ink, valign: 'top' }));
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
    'Drawing & Symbol Creation': 'Uses DrawEssentials, Amplifier, SIDC metadata, Mapper, and symbol draw events. Final geometry is routed to symbol layers by geometry type.',
    'Symbol Catalog': 'Backed by MS/Data/Symbols.json and SymbolMetadataService. Class names resolve through Mapper into concrete symbol implementations.',
    'Edit': 'Uses SketchViewModel transform behavior plus stored pre-edit snapshots. CTRL_PTS and BASE_LN_PTS stay synchronized after geometry changes.',
    'Control Points': 'Control handles modify the source control-point arrays, then symbol create/redraw logic rebuilds the tactical geometry.',
    'Selection': 'Scans managed symbol layers, tracks selected Graphic instances, and applies type/SIDC/echelon filters from graphic attributes and draw metadata.',
    'Batch Selection Operations': 'Geometry deltas and formation positions are computed from selected symbol centroids/extents, then applied as one undoable operation.',
    'Copy / Paste': 'Clones geometry, symbol, drawEssentials, and attributes. Multi-symbol paste offsets from the clipboard centroid to preserve formation layout.',
    'Undo / Redo': 'Stores labelled closures plus geometry/control-point snapshots. Redo stack clears whenever a new operation is pushed.',
    'Context Menu': 'ContextMenuManager resolves the right-clicked graphic/layer, then renders registered and dynamic action trees.',
    'Measurement': 'Computes geodesic or planar metrics from geometry. Optional magnetic declination, slant range, marching speed, and road ETA refine the result.',
    'Drawing Assistance': 'Uses pointer updates and the last committed control point to draw temporary overlay graphics on a cue layer.',
    'Proximity / Snapping': 'Snapshots candidate graphics from target layers and tests nearest vertex/coordinate per animation frame.',
    'MGRS': 'Generates grid lines with GZD and UTM/MGRS math; level visibility is controlled by settings and zoom.',
    'Import / Export': 'Serializes JSON-safe symbol state including GEOM, CTRL_PTS, and BASE_LN_PTS; restore replays the rendering pipeline.',
    'Settings / Widgets': 'Feature flags and runtime settings are read by SymbolEngine and forwarded to active engines via setOptions/updateConfig.',
    'SymbolEngine': 'Main mediator: initializes engines, listens to symbol events, manages layers, exposes public APIs, and handles view switches.',
    'EditEngine': 'Combines SketchViewModel with custom mixed-transform math so grouped symbols can move, rotate, and scale together.',
    'SelectionEngine': 'Maintains selected graphics, highlights, lasso sketching, clone-drag hooks, and batch geometry transforms.',
    'ClipboardEngine': 'Transforms cloned geometries from original centroid to target paste point; integrates undo and annotation refresh.',
    'UndoRedoManager': 'EditEngine events trigger snapshot-based undo entries for both primary and additional graphics.',
    'KeyboardShortcutManager': 'Document-level keydown router suppresses inputs/textareas and delegates to current graphic or selection state.',
    'AnnotationEngine': 'Annotation state is rebuilt after draw, edit, paste, and selection movement to keep labels attached to symbols.',
    'MeasurementEngine': 'Formats distance/area/bearing snapshots and emits document events for HUD/widgets.',
    'DrawingCueEngine': 'Maintains a temporary overlay layer and coalesces cursor-driven updates for drawing precision.',
    'ProximityEngine': 'Uses screen-space snap radius plus map-space distance ranking; optimized by candidate extents and reusable graphics.',
    'MGRSEngine': 'Rebuilds overlay on view changes, supporting 2D and 3D views with configurable line/label styles.',
    'Symbol Support Engines': 'Keeps catalog lookup, template placement, class mapping, and text-box drawing separate from the core SymbolEngine.',
    'Visualization / Declutter': 'Spatial indexing, priority resolution, clustering, marker dispersal, and label placement reduce dense tactical-map clutter.',
    'MorphixEngine': 'Reads editable symbol state and applies partial patches without losing existing geometry.',
    'ImportExport Engines': 'Plan serialization owns whole-map persistence while SymbolEngine keeps backward-compatible save/load delegates.',
    'DeploymentBuilder / MissionPlanner': 'MissionPlanner composes existing terrain engines rather than duplicating terrain math.',
    'OCOKA': 'Corridors degrade gracefully to pure terrain scoring when road-network enrichment is unavailable.',
    'RoadNetwork / Trafficability': 'External road service is optional; failed calls leave straight-line or terrain-only results intact.',
    'KeyTerrainIdentificationEngine': 'Terrain grid sampling produces elevation, curvature, prominence, and 36-ray viewshed components before final ranking.',
    'PosDefScorerEngine': 'Position is evaluated radially: LOS horizons, slopes, egress rays, and rear dead ground feed the six factors.',
    'OpRankerEngine': 'Each OP gets its own viewshed raster; final recommendation uses greedy max-coverage over AO cells.',
    'LocalPeaksEngine': 'Neighborhood comparison filters false peaks; prominence and isolation thresholds control mission-scale sensitivity.',
    'DeadGroundMapper': 'Observer-to-cell terrain profiles classify masked ground, useful for concealed movement and blind zones.',
    'LOSEngine': 'Line-of-sight rays compare terrain elevation against the observer-to-target sightline.',
    'WeaponEffectEngine': 'Weapon presets provide range bands and elevation envelope; terrain masking is mainly a 3D refinement.',
    'TrajectoryEngine': 'Projectile path depends on origin, target/range, launch parameters, and terrain/elevation context.',
    'BufferEngine': 'Buffers are distance-based graphics around sources; overlap highlights contested or mutually covered areas.',
    'CorridorEngine': 'Dense route segments are scored against corridor width and nearby threat geometries.',
    'EffectEngine / FlightEngine': 'Effects are radius overlays; flight workflows focus on UAV routing and coverage visualization.',
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
  parts.push(textBox(30, 72, 126, 1120, 28, 'Click any item to jump to the feature intro slide. Use Back to Index on each slide to return here.', { size: 14, color: C.muted }));
  parts.push(textBox(31, 82, 168, 440, 28, 'Core Features', { size: 18, color: C.core, bold: true }));
  parts.push(textBox(32, 626, 168, 440, 28, 'Engines', { size: 18, color: C.engine, bold: true }));
  const coreRows = coreItems.map((it) => ({ label: it.title, slide: findFeatureSlideNo(it.title), accent: C.core }));
  const engineRows = [
    ...engineItems.map((it) => ({ label: it[0], slide: findFeatureSlideNo(it[0]), accent: C.engine })),
    ...analysisItems.map((it) => ({ label: it[0], slide: findFeatureSlideNo(it[0]), accent: C.analysis })),
  ];
  coreRows.forEach((it, i) => {
    const y = 204 + i * 36;
    parts.push(shape(100 + i, 82, y, 470, 28, { text: it.label, fill: '1A252A', line: it.accent, color: C.ink, size: 11.5, bold: true, linkTo: true, linkToRel: rel.add(it.slide) }));
  });
  engineRows.forEach((it, i) => {
    const col = i < 15 ? 0 : 1;
    const row = i < 15 ? i : i - 15;
    const x = col === 0 ? 626 : 900;
    const y = 204 + row * 36;
    parts.push(shape(150 + i, x, y, 250, 28, { text: it.label, fill: '1A252A', line: it.accent, color: C.ink, size: 9.7, bold: true, linkTo: true, linkToRel: rel.add(it.slide) }));
  });
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
