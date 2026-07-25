/**
 * OverlayFabric.ts
 *
 * Pure mapping between the persisted SlideOverlay model and fabric.js
 * objects. Used by the SlideEditor (interactive canvas) and by
 * BriefingEngine's present-mode StaticCanvas render, so both surfaces draw
 * annotations identically.
 *
 * fabric.js 4.5 is a CDN global (`window.fabric`) — never import it.
 *
 * Coordinate contract: SlideOverlay stores everything normalized [0..1]
 * against the slide's view rect; strokeWidth/fontSize normalize to view
 * HEIGHT. W/H below are the pixel size of whatever canvas is being drawn on.
 */

import { BOX_OVERLAY_KINDS } from './BriefingTypes';
import type { OverlayKind, SlideOverlay } from './BriefingTypes';

type BoxKind = (typeof BOX_OVERLAY_KINDS)[number];
type ShapeKind = Exclude<BoxKind, 'rect' | 'ellipse'>;

const BOX_KINDS: ReadonlySet<string> = new Set(BOX_OVERLAY_KINDS);

export function isBoxKind(kind: string | undefined): kind is BoxKind {
  return !!kind && BOX_KINDS.has(kind);
}

export function overlayUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** '#RGB' / '#RRGGBB' / 'rgb()' / 'rgba()' → hex + alpha. Null when unusable. */
export function parseColor(c: any): { hex: string; alpha: number } | null {
  if (!c || typeof c !== 'string') return null;
  const s = c.trim();
  if (!s) return null;
  if (s[0] === '#') {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
    if (hex.length < 6) return null;
    return { hex: `#${hex.slice(0, 6).toUpperCase()}`, alpha: 1 };
  }
  const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (!m) return null;
  const to2 = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  const alpha = m[4] != null ? Math.max(0, Math.min(1, parseFloat(m[4]))) : 1;
  return { hex: `#${to2(+m[1])}${to2(+m[2])}${to2(+m[3])}`, alpha };
}

/** '#RRGGBB' + alpha → 'rgba(r, g, b, a)' (fabric fill strings carry alpha inline). */
export function withAlpha(hex: string, alpha: number): string {
  const p = parseColor(hex);
  if (!p) return hex;
  const r = parseInt(p.hex.slice(1, 3), 16);
  const g = parseInt(p.hex.slice(3, 5), 16);
  const b = parseInt(p.hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

/**
 * Dash pattern → fabric stroke props, scaled by width so dashes stay legible
 * at any thickness. Solid explicitly resets both (style changes reuse this).
 */
export function dashProps(
  dash: 'dashed' | 'dotted' | undefined | null,
  strokeWidthPx: number,
): Record<string, any> {
  const w = Math.max(1, strokeWidthPx);
  if (dash === 'dashed') return { strokeDashArray: [w * 3, w * 2], strokeLineCap: 'butt' };
  if (dash === 'dotted') return { strokeDashArray: [1, w * 2], strokeLineCap: 'round' };
  return { strokeDashArray: null, strokeLineCap: 'butt' };
}

export interface ShapeStyle {
  /** Already alpha-baked ('rgba(...)') or '' for none. */
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeDash?: 'dashed' | 'dotted';
}

/**
 * Vertex/path geometry for the box-persisted shape kinds beyond rect/ellipse.
 * Geometry is regenerated from the bbox on every load (and by the editor at
 * draw end), so persistence stays bbox-only exactly like rect/ellipse.
 */
export function makeShapeObject(
  kind: ShapeKind,
  box: { left: number; top: number; width: number; height: number },
  style: ShapeStyle,
  extra: Record<string, any> = {},
): any {
  const fabric = (window as any).fabric;
  const w = Math.max(2, box.width);
  const h = Math.max(2, box.height);
  const opts: Record<string, any> = {
    ...extra,
    left: box.left,
    top: box.top,
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.stroke ? style.strokeWidth : 0,
    ...dashProps(style.strokeDash, style.strokeWidth),
    strokeLineJoin: 'round',
    data: {
      ...(extra.data ?? {}),
      id: extra.data?.id ?? overlayUuid(),
      kind,
      strokeDash: style.strokeDash,
    },
  };

  if (kind === 'triangle') return new fabric.Triangle({ ...opts, width: w, height: h });
  if (kind === 'diamond') {
    return new fabric.Polygon(
      [
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
      ],
      opts,
    );
  }
  if (kind === 'star') {
    // 5-point star on a unit circle, then stretched to exactly fill the box.
    const raw: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? 1 : 0.382;
      raw.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of raw) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const pts = raw.map((p) => ({
      x: ((p.x - minX) / (maxX - minX)) * w,
      y: ((p.y - minY) / (maxY - minY)) * h,
    }));
    return new fabric.Polygon(pts, opts);
  }
  // callout — rounded speech bubble with a tail toward bottom-left.
  const bh = h * 0.78;
  const r = Math.min(w, bh) * 0.14;
  const n = (v: number) => Number(v.toFixed(2));
  const path =
    `M ${n(r)} 0 L ${n(w - r)} 0 Q ${n(w)} 0 ${n(w)} ${n(r)} ` +
    `L ${n(w)} ${n(bh - r)} Q ${n(w)} ${n(bh)} ${n(w - r)} ${n(bh)} ` +
    `L ${n(w * 0.34)} ${n(bh)} L ${n(w * 0.1)} ${n(h)} L ${n(w * 0.18)} ${n(bh)} ` +
    `L ${n(r)} ${n(bh)} Q 0 ${n(bh)} 0 ${n(bh - r)} L 0 ${n(r)} Q 0 0 ${n(r)} 0 Z`;
  return new fabric.Path(path, opts);
}

/**
 * Line + triangle head grouped as one selectable arrow. Creation-time
 * endpoints are stored group-center-relative in data.localPoints so
 * fabricToOverlay can recover them through the group's transform matrix
 * after any move/scale/rotate.
 */
export function makeArrowGroup(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  stroke: string,
  strokeWidthPx: number,
  extra: Record<string, any> = {},
  strokeDash?: 'dashed' | 'dotted',
): any {
  const fabric = (window as any).fabric;
  const head = strokeWidthPx * 4 + 6;
  const angleDeg = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI + 90;
  const line = new fabric.Line([p0.x, p0.y, p1.x, p1.y], {
    stroke,
    strokeWidth: strokeWidthPx,
    ...dashProps(strokeDash, strokeWidthPx),
  });
  const tri = new fabric.Triangle({
    left: p1.x,
    top: p1.y,
    originX: 'center',
    originY: 'center',
    width: head,
    height: head,
    angle: angleDeg,
    fill: stroke,
  });
  const grp = new fabric.Group([line, tri], {
    ...extra,
    data: { id: extra?.data?.id ?? overlayUuid(), kind: 'arrow' as OverlayKind, strokeDash },
  });
  const c = grp.getCenterPoint();
  grp.data.localPoints = [
    { x: p0.x - c.x, y: p0.y - c.y },
    { x: p1.x - c.x, y: p1.y - c.y },
  ];
  return grp;
}

/** Denormalize a persisted overlay into a fabric object (null = unusable entry, skip it). */
export function overlayToFabric(o: SlideOverlay, W: number, H: number): any | null {
  const fabric = (window as any).fabric;
  if (!fabric || !o || !o.kind || !W || !H) return null;
  const common: Record<string, any> = {
    opacity: o.opacity ?? 1,
    data: { id: o.id || overlayUuid(), kind: o.kind, strokeDash: o.strokeDash },
  };
  const strokePx = Math.max(1, (o.strokeWidth ?? 0.004) * H);
  const dash = dashProps(o.strokeDash, strokePx);

  switch (o.kind) {
    case 'text':
      return new fabric.Textbox(o.text ?? '', {
        ...common,
        left: o.x * W,
        top: o.y * H,
        width: Math.max(20, o.w * W),
        fontSize: Math.max(6, (o.fontSize ?? 0.03) * H),
        fontFamily: o.fontFamily || 'Arial',
        fontWeight: o.bold ? 'bold' : 'normal',
        fontStyle: o.italic ? 'italic' : 'normal',
        underline: !!o.underline,
        textAlign: o.align ?? 'left',
        fill: o.textColor ?? '#FFFFFF',
        angle: o.rotation ?? 0,
      });
    case 'rect':
      return new fabric.Rect({
        ...common,
        ...dash,
        left: o.x * W,
        top: o.y * H,
        width: Math.max(2, o.w * W),
        height: Math.max(2, o.h * H),
        fill: o.fill ? withAlpha(o.fill, o.fillOpacity ?? 1) : '',
        stroke: o.stroke ?? '',
        strokeWidth: o.stroke ? strokePx : 0,
        angle: o.rotation ?? 0,
      });
    case 'ellipse':
      return new fabric.Ellipse({
        ...common,
        ...dash,
        left: o.x * W,
        top: o.y * H,
        rx: Math.max(1, (o.w * W) / 2),
        ry: Math.max(1, (o.h * H) / 2),
        fill: o.fill ? withAlpha(o.fill, o.fillOpacity ?? 1) : '',
        stroke: o.stroke ?? '',
        strokeWidth: o.stroke ? strokePx : 0,
        angle: o.rotation ?? 0,
      });
    case 'diamond':
    case 'triangle':
    case 'star':
    case 'callout':
      return makeShapeObject(
        o.kind,
        { left: o.x * W, top: o.y * H, width: o.w * W, height: o.h * H },
        {
          fill: o.fill ? withAlpha(o.fill, o.fillOpacity ?? 1) : '',
          stroke: o.stroke ?? '',
          strokeWidth: strokePx,
          strokeDash: o.strokeDash,
        },
        { ...common, angle: o.rotation ?? 0 },
      );
    case 'line': {
      const [p0, p1] = o.points ?? [];
      if (!p0 || !p1) return null;
      return new fabric.Line([p0.x * W, p0.y * H, p1.x * W, p1.y * H], {
        ...common,
        ...dash,
        stroke: o.stroke ?? '#FF3B30',
        strokeWidth: strokePx,
      });
    }
    case 'arrow': {
      const [p0, p1] = o.points ?? [];
      if (!p0 || !p1) return null;
      return makeArrowGroup(
        { x: p0.x * W, y: p0.y * H },
        { x: p1.x * W, y: p1.y * H },
        o.stroke ?? '#FF3B30',
        strokePx,
        common,
        o.strokeDash,
      );
    }
    case 'freehand':
    case 'highlight': {
      const pts = (o.points ?? []).map((p) => ({ x: p.x * W, y: p.y * H }));
      if (pts.length < 2) return null;
      return new fabric.Polyline(pts, {
        ...common,
        ...dash,
        // Highlighter reads as a marker: translucent, wide, soft ends.
        ...(o.kind === 'highlight'
          ? { opacity: o.opacity ?? 0.45, strokeLineCap: 'round', strokeLineJoin: 'round' }
          : {}),
        fill: '',
        stroke: o.stroke ?? '#FF3B30',
        strokeWidth: strokePx,
      });
    }
  }
  return null;
}

/**
 * Normalize a fabric object (tagged with data.kind by this module / the
 * editor) back into the persisted model. Point-list kinds bake any
 * move/scale/rotate into the recovered points via the transform matrix.
 */
export function fabricToOverlay(obj: any, W: number, H: number): SlideOverlay | null {
  const fabric = (window as any).fabric;
  const kind: OverlayKind | undefined = obj?.data?.kind;
  if (!fabric || !kind || !W || !H) return null;

  const opacity =
    obj.opacity != null && obj.opacity < 1 ? Number(Number(obj.opacity).toFixed(3)) : undefined;
  const rotRaw = Math.round((((obj.angle ?? 0) % 360) + 360) % 360 * 10) / 10;
  const rotation = rotRaw ? rotRaw : undefined;
  const avgScale = ((obj.scaleX ?? 1) + (obj.scaleY ?? 1)) / 2;

  const base: SlideOverlay = {
    id: obj.data.id || overlayUuid(),
    kind,
    x: (obj.left ?? 0) / W,
    y: (obj.top ?? 0) / H,
    w: Math.max(0.001, obj.getScaledWidth() / W),
    h: Math.max(0.001, obj.getScaledHeight() / H),
  };
  if (opacity != null) base.opacity = opacity;

  if (kind === 'text') {
    if (!String(obj.text ?? '').trim()) return null;
    if (rotation) base.rotation = rotation;
    base.text = String(obj.text);
    base.fontFamily = obj.fontFamily || 'Arial';
    base.fontSize = ((obj.fontSize ?? 24) * (obj.scaleY ?? 1)) / H;
    if (obj.fontWeight === 'bold' || obj.fontWeight === 'bolder' || Number(obj.fontWeight) >= 600) {
      base.bold = true;
    }
    if (obj.fontStyle === 'italic') base.italic = true;
    if (obj.underline) base.underline = true;
    if (obj.textAlign === 'center' || obj.textAlign === 'right') base.align = obj.textAlign;
    base.textColor = parseColor(obj.fill)?.hex ?? '#FFFFFF';
    return base;
  }

  if (isBoxKind(kind)) {
    if (rotation) base.rotation = rotation;
    const fill = parseColor(obj.fill);
    if (fill) {
      base.fill = fill.hex;
      if (fill.alpha < 1) base.fillOpacity = Number(fill.alpha.toFixed(3));
    }
    const stroke = parseColor(obj.stroke);
    if (stroke && (obj.strokeWidth ?? 0) > 0) {
      base.stroke = stroke.hex;
      base.strokeWidth = ((obj.strokeWidth ?? 1) * avgScale) / H;
      if (obj.data.strokeDash) base.strokeDash = obj.data.strokeDash;
    }
    return base;
  }

  // line | arrow | freehand | highlight
  const m = obj.calcTransformMatrix();
  const toAbs = (lx: number, ly: number): { x: number; y: number } => {
    const p = fabric.util.transformPoint(new fabric.Point(lx, ly), m);
    return { x: p.x / W, y: p.y / H };
  };

  let pts: Array<{ x: number; y: number }> = [];
  let strokeSrc: any = obj;
  if (kind === 'line') {
    // A Line's object-plane center is the midpoint of its endpoints.
    const cx = ((obj.x1 ?? 0) + (obj.x2 ?? 0)) / 2;
    const cy = ((obj.y1 ?? 0) + (obj.y2 ?? 0)) / 2;
    pts = [
      toAbs((obj.x1 ?? 0) - cx, (obj.y1 ?? 0) - cy),
      toAbs((obj.x2 ?? 0) - cx, (obj.y2 ?? 0) - cy),
    ];
  } else if (kind === 'arrow') {
    const lp: Array<{ x: number; y: number }> = obj.data.localPoints ?? [];
    pts = lp.map((p) => toAbs(p.x, p.y));
    strokeSrc = obj.getObjects?.()?.[0] ?? obj; // stroke lives on the child line
  } else if (kind === 'freehand' || kind === 'highlight') {
    const off = obj.pathOffset ?? { x: 0, y: 0 };
    pts = (obj.points ?? []).map((p: any) => toAbs(p.x - off.x, p.y - off.y));
  }
  if (pts.length < 2) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  base.x = minX;
  base.y = minY;
  base.w = Math.max(0.001, maxX - minX);
  base.h = Math.max(0.001, maxY - minY);
  base.points = pts.map((p) => ({ x: Number(p.x.toFixed(5)), y: Number(p.y.toFixed(5)) }));
  base.stroke = parseColor(strokeSrc?.stroke)?.hex ?? '#FF3B30';
  base.strokeWidth = ((strokeSrc?.strokeWidth ?? 2) * avgScale) / H;
  if (obj.data.strokeDash) base.strokeDash = obj.data.strokeDash;
  // Highlight restores with a 0.45 default, so a full-opacity highlight must
  // still write opacity explicitly or it would darken on reload.
  if (kind === 'highlight') base.opacity = Number(Number(obj.opacity ?? 0.45).toFixed(3));
  return base;
}
