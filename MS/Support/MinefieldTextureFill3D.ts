import Graphic from "@arcgis/core/Graphic";
import Mesh from "@arcgis/core/geometry/Mesh";
import Polygon from "@arcgis/core/geometry/Polygon";
import MeshMaterial from "@arcgis/core/geometry/support/MeshMaterial";
import MeshTexture from "@arcgis/core/geometry/support/MeshTexture";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import PictureFillSymbol from "@arcgis/core/symbols/PictureFillSymbol";
import MeshSymbol3D from "@arcgis/core/symbols/MeshSymbol3D";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";

export const MINEFIELD_TEXTURE_FILL_KEY = "MINEFIELD_TEXTURE_FILL";
export const MINEFIELD_TEXTURE_FILL_ROLE = "minefield-texture-fill";

const DEFAULT_PICTURE_WIDTH = 100;
const DEFAULT_PICTURE_HEIGHT = 50;
const DEFAULT_REPEAT_COUNT = 6;
const INVISIBLE_PRIMARY_ALPHA = 0.001;

export interface MinefieldTextureMetadata {
  url: string;
  imageWidth?: number;
  imageHeight?: number;
  pictureWidth?: number;
  pictureHeight?: number;
  opacity?: number;
  tileWidthMapUnits?: number;
  tileHeightMapUnits?: number;
  anchorX?: number;
  anchorY?: number;
}

type ViewType = MapView | SceneView;

export function setMinefieldTextureMetadata(
  drawEssentials: any,
  metadata: MinefieldTextureMetadata,
): MinefieldTextureMetadata {
  const existing: Partial<MinefieldTextureMetadata> =
    getMinefieldTextureMetadata(drawEssentials) ?? {};
  const next: MinefieldTextureMetadata = {
    ...existing,
    ...metadata,
    imageWidth:
      metadata.imageWidth ??
      existing.imageWidth ??
      metadata.pictureWidth ??
      existing.pictureWidth ??
      DEFAULT_PICTURE_WIDTH,
    imageHeight:
      metadata.imageHeight ??
      existing.imageHeight ??
      metadata.pictureHeight ??
      existing.pictureHeight ??
      DEFAULT_PICTURE_HEIGHT,
    pictureWidth:
      metadata.pictureWidth ??
      existing.pictureWidth ??
      metadata.imageWidth ??
      existing.imageWidth ??
      DEFAULT_PICTURE_WIDTH,
    pictureHeight:
      metadata.pictureHeight ??
      existing.pictureHeight ??
      metadata.imageHeight ??
      existing.imageHeight ??
      DEFAULT_PICTURE_HEIGHT,
  };

  drawEssentials[MINEFIELD_TEXTURE_FILL_KEY] = next;
  return next;
}

export function getMinefieldTextureMetadata(
  drawEssentials: any,
): MinefieldTextureMetadata | null {
  const metadata = drawEssentials?.[MINEFIELD_TEXTURE_FILL_KEY];
  return metadata?.url ? metadata : null;
}

export function isMinefieldTextureGraphic(graphic: Graphic | null | undefined): boolean {
  const attrs = graphic?.attributes;
  return Boolean(
    attrs?.isMinefieldTextureFill === true ||
      attrs?.role === MINEFIELD_TEXTURE_FILL_ROLE ||
      attrs?.type === MINEFIELD_TEXTURE_FILL_ROLE,
  );
}

export function createMinefieldPrimaryFillSymbol(
  view: ViewType,
  outline: SimpleLineSymbol | any,
  metadata: MinefieldTextureMetadata,
): PictureFillSymbol | SimpleFillSymbol {
  if (view.type === "3d") {
    return new SimpleFillSymbol({
      style: "solid",
      color: [255, 255, 255, INVISIBLE_PRIMARY_ALPHA],
      outline,
    });
  }

  try {
    return new PictureFillSymbol({
      url: metadata.url,
      outline,
      width: metadata.pictureWidth ?? DEFAULT_PICTURE_WIDTH,
      height: metadata.pictureHeight ?? DEFAULT_PICTURE_HEIGHT,
    });
  } catch {
    return new SimpleFillSymbol({
      style: "solid",
      color: [255, 165, 0, metadata.opacity ?? 1],
      outline,
    });
  }
}

// Visible preview fill used while the user is interactively drawing.
// PictureFillSymbol works in MapView; SceneView refuses to render it
// AND triggers a console warning on every pointer-move. In 3D we use a
// solid-but-translucent SimpleFillSymbol so the polygon is visible during
// drag; the final textured Mesh is generated in SymbolEngine.drawSymEnd.
export function createMinefieldPreviewFillSymbol(
  view: ViewType,
  outline: SimpleLineSymbol | any,
  metadata: MinefieldTextureMetadata,
  fallbackColor: [number, number, number],
): PictureFillSymbol | SimpleFillSymbol {
  const opacity = metadata.opacity ?? 1;
  if (view.type === "3d") {
    return new SimpleFillSymbol({
      style: "solid",
      color: [fallbackColor[0], fallbackColor[1], fallbackColor[2], opacity * 0.35],
      outline,
    });
  }

  try {
    const sym = new PictureFillSymbol({
      url: metadata.url,
      outline,
      width: metadata.pictureWidth ?? DEFAULT_PICTURE_WIDTH,
      height: metadata.pictureHeight ?? DEFAULT_PICTURE_HEIGHT,
    });
    if (sym.color) sym.color.a = opacity;
    return sym;
  } catch {
    return new SimpleFillSymbol({
      style: "solid",
      color: [fallbackColor[0], fallbackColor[1], fallbackColor[2], opacity],
      outline,
    });
  }
}

export function applyMinefieldPrimarySymbolForView(
  graphic: Graphic,
  view: ViewType,
): void {
  if (isMinefieldTextureGraphic(graphic)) return;
  const metadata = getMinefieldTextureMetadata(graphic.attributes?.drawEssentials);
  if (!metadata || graphic.geometry?.type !== "polygon") return;

  const outline = extractOutline(graphic.symbol);
  graphic.symbol = createMinefieldPrimaryFillSymbol(view, outline, metadata);
}

export function createMinefieldTextureGraphic(
  parentGraphic: Graphic,
  view: ViewType,
): Graphic | null {
  if (view.type !== "3d") return null;
  if (isMinefieldTextureGraphic(parentGraphic)) return null;
  if (parentGraphic.geometry?.type !== "polygon") return null;

  const metadata = getMinefieldTextureMetadata(parentGraphic.attributes?.drawEssentials);
  if (!metadata) return null;

  const polygon = parentGraphic.geometry as Polygon;
  const mesh = Mesh.createFromPolygon(polygon.clone());
  const positions = mesh.vertexAttributes?.position;
  if (!positions || positions.length < 9) return null;

  ensureTextureTiling(metadata, polygon, positions);
  mesh.vertexAttributes = {
    position: positions,
    normal: mesh.vertexAttributes.normal ?? undefined,
    uv: buildUvCoordinates(positions, metadata),
  };
  mesh.vertexAttributesChanged();

  const material = new MeshMaterial({
    color: [255, 255, 255, metadata.opacity ?? 1],
    colorTexture: new MeshTexture({
      url: normalizeTextureUrl(metadata.url),
      wrap: "repeat",
      transparent: true,
    }),
    alphaMode: "blend",
    doubleSided: true,
  });

  if (mesh.components?.length) {
    mesh.components.forEach((component) => {
      component.material = material;
      component.shading = "flat";
    });
  } else {
    mesh.addComponent({
      material,
      shading: "flat",
    });
  }

  const parentId = ensureGraphicId(parentGraphic);
  const textureId = `${parentId}:minefield-texture`;
  parentGraphic.attributes = {
    ...(parentGraphic.attributes ?? {}),
    minefieldTextureGraphicId: textureId,
  };

  return new Graphic({
    geometry: mesh,
    symbol: new MeshSymbol3D({
      symbolLayers: [{
        type: "fill",
        castShadows: false,
        material: {
          color: [255, 255, 255, 1],
          colorMixMode: "multiply",
        },
      }],
    }),
    attributes: {
      id: textureId,
      parentId,
      type: MINEFIELD_TEXTURE_FILL_ROLE,
      role: MINEFIELD_TEXTURE_FILL_ROLE,
      isMinefieldTextureFill: true,
    },
  });
}

export function syncMinefieldTextureGraphic(
  layer: GraphicsLayer | null | undefined,
  parentGraphic: Graphic,
  view: ViewType,
): Graphic | null {
  if (!layer || isMinefieldTextureGraphic(parentGraphic)) return null;

  removeMinefieldTextureForGraphic(layer, parentGraphic);
  applyMinefieldPrimarySymbolForView(parentGraphic, view);

  const textureGraphic = createMinefieldTextureGraphic(parentGraphic, view);
  if (textureGraphic) {
    layer.add(textureGraphic);
  }
  return textureGraphic;
}

export function removeMinefieldTextureForGraphic(
  layer: GraphicsLayer | null | undefined,
  graphicOrId: Graphic | string,
): void {
  if (!layer) return;
  const parentId =
    typeof graphicOrId === "string" ? graphicOrId : graphicOrId.attributes?.id;
  if (!parentId) return;

  getLayerGraphics(layer)
    .filter((graphic) => graphic.attributes?.parentId === parentId)
    .filter(isMinefieldTextureGraphic)
    .forEach((graphic) => layer.remove(graphic));
}

export function syncMinefieldTextureGraphicsForLayer(
  layer: GraphicsLayer | null | undefined,
  view: ViewType,
): void {
  if (!layer) return;

  const graphics = getLayerGraphics(layer);
  graphics.filter(isMinefieldTextureGraphic).forEach((textureGraphic) => {
    const parentId = textureGraphic.attributes?.parentId;
    const hasParent = graphics.some(
      (graphic) =>
        !isMinefieldTextureGraphic(graphic) && graphic.attributes?.id === parentId,
    );
    if (view.type !== "3d" || !hasParent) layer.remove(textureGraphic);
  });

  getLayerGraphics(layer)
    .filter((graphic) => !isMinefieldTextureGraphic(graphic))
    .filter((graphic) =>
      Boolean(getMinefieldTextureMetadata(graphic.attributes?.drawEssentials)),
    )
    .forEach((graphic) => syncMinefieldTextureGraphic(layer, graphic, view));
}

function ensureTextureTiling(
  metadata: MinefieldTextureMetadata,
  polygon: Polygon,
  positions: Float64Array,
): void {
  const extent = polygon.extent;
  let xmin = extent?.xmin ?? Number.POSITIVE_INFINITY;
  let xmax = extent?.xmax ?? Number.NEGATIVE_INFINITY;
  let ymin = extent?.ymin ?? Number.POSITIVE_INFINITY;
  let ymax = extent?.ymax ?? Number.NEGATIVE_INFINITY;

  if (!extent) {
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      xmin = Math.min(xmin, x);
      xmax = Math.max(xmax, x);
      ymin = Math.min(ymin, y);
      ymax = Math.max(ymax, y);
    }
  }

  const width = Math.max(Math.abs(xmax - xmin), Number.EPSILON);
  const height = Math.max(Math.abs(ymax - ymin), Number.EPSILON);
  const imageWidth = metadata.imageWidth ?? DEFAULT_PICTURE_WIDTH;
  const imageHeight = metadata.imageHeight ?? DEFAULT_PICTURE_HEIGHT;
  const aspect = imageHeight / Math.max(imageWidth, Number.EPSILON);

  if (!metadata.tileWidthMapUnits || metadata.tileWidthMapUnits <= 0) {
    metadata.tileWidthMapUnits = Math.max(width / DEFAULT_REPEAT_COUNT, height / DEFAULT_REPEAT_COUNT, Number.EPSILON);
  }
  if (!metadata.tileHeightMapUnits || metadata.tileHeightMapUnits <= 0) {
    metadata.tileHeightMapUnits = Math.max(metadata.tileWidthMapUnits * aspect, Number.EPSILON);
  }
  if (metadata.anchorX === undefined) metadata.anchorX = xmin;
  if (metadata.anchorY === undefined) metadata.anchorY = ymax;
}

function buildUvCoordinates(
  positions: Float64Array,
  metadata: MinefieldTextureMetadata,
): Float32Array {
  const uv = new Float32Array((positions.length / 3) * 2);
  const tileWidth = Math.max(metadata.tileWidthMapUnits ?? 1, Number.EPSILON);
  const tileHeight = Math.max(metadata.tileHeightMapUnits ?? 1, Number.EPSILON);
  const anchorX = metadata.anchorX ?? 0;
  const anchorY = metadata.anchorY ?? 0;

  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    uv[j] = (positions[i] - anchorX) / tileWidth;
    uv[j + 1] = (anchorY - positions[i + 1]) / tileHeight;
  }

  return uv;
}

function extractOutline(symbol: any): SimpleLineSymbol | any {
  const outline = symbol?.outline;
  return outline?.clone?.() ?? outline;
}

function normalizeTextureUrl(url: string): string {
  if (typeof document === "undefined") return url;
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
}

function ensureGraphicId(graphic: Graphic): string {
  if (!graphic.attributes) graphic.attributes = {};
  if (!graphic.attributes.id) {
    graphic.attributes.id =
      globalThis.crypto?.randomUUID?.() ??
      `minefield-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return String(graphic.attributes.id);
}

function getLayerGraphics(layer: GraphicsLayer): Graphic[] {
  const graphics = layer.graphics as any;
  if (typeof graphics?.toArray === "function") return graphics.toArray();
  const result: Graphic[] = [];
  graphics?.forEach?.((graphic: Graphic) => result.push(graphic));
  return result;
}
