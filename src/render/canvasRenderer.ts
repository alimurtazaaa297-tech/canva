import {
  applyMatrixToPoint,
  createNodeLocalMatrix,
  Point,
} from '../math/matrix';
import { Rect, rectsIntersect, Viewport } from '../math/geometry';
import { SnapGuide } from '../math/snapping';
import {
  getNodeWorldAABB,
  getNodeWorldMatrix,
  getSelectionWorldAABB,
  isContainerNode,
} from '../model/document';
import { PageNode, PathAnchor, PathNode, SceneNode, ShadowStyle } from '../model/types';
import { getHandlePositions, HandleKind } from './hitTest';

export interface RenderOverlayState {
  selectedIds: string[];
  hoveredId: string | null;
  marqueeRect: Rect | null;
  snapGuides: SnapGuide[];
  penDraft: {
    anchors: PathAnchor[];
    previewPoint: Point | null;
  } | null;
  editingPathId: string | null;
  selectedAnchorIndex: number | null;
}

function applyShadow(ctx: CanvasRenderingContext2D, shadow: ShadowStyle): void {
  if (shadow.enabled) {
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur;
    ctx.shadowOffsetX = shadow.offsetX;
    ctx.shadowOffsetY = shadow.offsetY;
  } else {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }
}

function clearShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

export function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (radius === 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function tracePathNode(ctx: CanvasRenderingContext2D, node: PathNode): void {
  const { anchors, closed } = node;
  if (anchors.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(anchors[0].x, anchors[0].y);
  const segCount = closed ? anchors.length : anchors.length - 1;
  for (let i = 0; i < segCount; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % anchors.length];
    const cp1 = a.handleOut ?? { x: a.x, y: a.y };
    const cp2 = b.handleIn ?? { x: b.x, y: b.y };
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, b.x, b.y);
  }
  if (closed) {
    ctx.closePath();
  }
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  page: PageNode,
  nodeId: string,
  visibleWorldRect: Rect | null
): void {
  const node = page.nodes[nodeId];
  if (!node || !node.visible) return;

  // World-space viewport culling for 500+ shape performance
  if (visibleWorldRect && !node.parentId) {
    const aabb = getNodeWorldAABB(page, nodeId);
    if (!rectsIntersect(visibleWorldRect, aabb)) {
      return;
    }
  }

  const localMat = createNodeLocalMatrix(
    node.transform.x,
    node.transform.y,
    node.width,
    node.height,
    node.transform.rotation
  );

  ctx.save();
  ctx.transform(localMat[0], localMat[1], localMat[2], localMat[3], localMat[4], localMat[5]);
  ctx.globalAlpha *= node.opacity;

  switch (node.type) {
    case 'frame': {
      traceRoundedRect(ctx, 0, 0, node.width, node.height, node.cornerRadius);
      if (node.fill.enabled) {
        applyShadow(ctx, node.shadow);
        ctx.fillStyle = node.fill.color;
        ctx.fill();
        clearShadow(ctx);
      }
      if (node.clipContent) {
        ctx.save();
        traceRoundedRect(ctx, 0, 0, node.width, node.height, node.cornerRadius);
        ctx.clip();
      }
      for (const cid of node.children) {
        drawNode(ctx, page, cid, null);
      }
      if (node.clipContent) {
        ctx.restore();
      }
      if (node.stroke.enabled && node.stroke.width > 0) {
        traceRoundedRect(ctx, 0, 0, node.width, node.height, node.cornerRadius);
        ctx.strokeStyle = node.stroke.color;
        ctx.lineWidth = node.stroke.width;
        ctx.stroke();
      }
      break;
    }

    case 'group': {
      for (const cid of node.children) {
        drawNode(ctx, page, cid, null);
      }
      break;
    }

    case 'rect': {
      traceRoundedRect(ctx, 0, 0, node.width, node.height, node.cornerRadius);
      if (node.fill.enabled) {
        applyShadow(ctx, node.shadow);
        ctx.fillStyle = node.fill.color;
        ctx.fill();
        clearShadow(ctx);
      }
      if (node.stroke.enabled && node.stroke.width > 0) {
        ctx.strokeStyle = node.stroke.color;
        ctx.lineWidth = node.stroke.width;
        ctx.stroke();
      }
      break;
    }

    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse(
        node.width / 2,
        node.height / 2,
        Math.max(0.5, node.width / 2),
        Math.max(0.5, node.height / 2),
        0,
        0,
        Math.PI * 2
      );
      if (node.fill.enabled) {
        applyShadow(ctx, node.shadow);
        ctx.fillStyle = node.fill.color;
        ctx.fill();
        clearShadow(ctx);
      }
      if (node.stroke.enabled && node.stroke.width > 0) {
        ctx.strokeStyle = node.stroke.color;
        ctx.lineWidth = node.stroke.width;
        ctx.stroke();
      }
      break;
    }

    case 'line': {
      ctx.beginPath();
      ctx.moveTo(node.p1.x, node.p1.y);
      ctx.lineTo(node.p2.x, node.p2.y);
      if (node.stroke.enabled && node.stroke.width > 0) {
        applyShadow(ctx, node.shadow);
        ctx.strokeStyle = node.stroke.color;
        ctx.lineWidth = node.stroke.width;
        ctx.lineCap = 'round';
        ctx.stroke();
        clearShadow(ctx);
      }
      break;
    }

    case 'text': {
      if (node.fill.enabled) {
        applyShadow(ctx, node.shadow);
        ctx.fillStyle = node.fill.color;
        ctx.font = `${node.fontWeight} ${node.fontSize}px ${node.fontFamily}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = node.textAlign;
        const lines = node.text.split('\n');
        const lineHeight = node.fontSize * 1.25;
        const xOffset =
          node.textAlign === 'center'
            ? node.width / 2
            : node.textAlign === 'right'
            ? node.width
            : 0;
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], xOffset, i * lineHeight);
        }
        clearShadow(ctx);
      }
      break;
    }

    case 'path': {
      if (node.anchors.length > 0) {
        tracePathNode(ctx, node);
        if (node.closed && node.fill.enabled) {
          applyShadow(ctx, node.shadow);
          ctx.fillStyle = node.fill.color;
          ctx.fill();
          clearShadow(ctx);
        }
        if (node.stroke.enabled && node.stroke.width > 0) {
          applyShadow(ctx, node.shadow);
          ctx.strokeStyle = node.stroke.color;
          ctx.lineWidth = node.stroke.width;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.stroke();
          clearShadow(ctx);
        }
      }
      break;
    }
  }

  ctx.restore();
}

function drawFrameLabels(
  ctx: CanvasRenderingContext2D,
  page: PageNode,
  zoom: number,
  selectedSet: Set<string>
): void {
  ctx.save();
  ctx.font = `${12 / zoom}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';

  for (const id of page.children) {
    const node = page.nodes[id];
    if (!node || node.type !== 'frame' || !node.visible) continue;
    ctx.fillStyle = selectedSet.has(id) ? '#2563eb' : '#64748b';
    ctx.fillText(node.name, node.transform.x, node.transform.y - 6 / zoom);
  }
  ctx.restore();
}

function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  zoom: number,
  showHandles: boolean
): void {
  const invZ = 1 / zoom;
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1.5 * invZ;
  ctx.strokeRect(0, 0, width, height);

  if (!showHandles) return;

  const handles = getHandlePositions(width, height, zoom);
  const size = 8 * invZ;

  // Stem to rotate handle
  ctx.beginPath();
  ctx.moveTo(width / 2, 0);
  ctx.lineTo(handles.rotate.x, handles.rotate.y);
  ctx.stroke();

  // 8 resize square handles
  const boxHandles: HandleKind[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  for (const k of boxHandles) {
    const p = handles[k];
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5 * invZ;
    ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    ctx.strokeRect(p.x - size / 2, p.y - size / 2, size, size);
  }

  // Rotate circular handle
  ctx.beginPath();
  ctx.arc(handles.rotate.x, handles.rotate.y, 4.5 * invZ, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1.5 * invZ;
  ctx.stroke();
}

function drawPathOverlay(
  ctx: CanvasRenderingContext2D,
  anchors: PathAnchor[],
  closed: boolean,
  previewPoint: Point | null,
  selectedAnchorIndex: number | null,
  zoom: number
): void {
  if (anchors.length === 0) return;
  const invZ = 1 / zoom;
  ctx.save();

  // Preview stroke for pen draft
  if (previewPoint) {
    const last = anchors[anchors.length - 1];
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    if (last.handleOut) {
      ctx.bezierCurveTo(
        last.handleOut.x,
        last.handleOut.y,
        previewPoint.x,
        previewPoint.y,
        previewPoint.x,
        previewPoint.y
      );
    } else {
      ctx.lineTo(previewPoint.x, previewPoint.y);
    }
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5 * invZ;
    ctx.setLineDash([4 * invZ, 4 * invZ]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw anchor points & bezier control handles
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const isSel = selectedAnchorIndex === i;

    if (a.handleIn) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.handleIn.x, a.handleIn.y);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1 * invZ;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(a.handleIn.x, a.handleIn.y, 3.5 * invZ, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.5 * invZ;
      ctx.stroke();
    }

    if (a.handleOut) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.handleOut.x, a.handleOut.y);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1 * invZ;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(a.handleOut.x, a.handleOut.y, 3.5 * invZ, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.5 * invZ;
      ctx.stroke();
    }

    const sz = 7 * invZ;
    ctx.fillStyle = isSel ? '#2563eb' : '#ffffff';
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5 * invZ;
    ctx.fillRect(a.x - sz / 2, a.y - sz / 2, sz, sz);
    ctx.strokeRect(a.x - sz / 2, a.y - sz / 2, sz, sz);
  }

  void closed;
  ctx.restore();
}

export function renderCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  page: PageNode,
  viewport: Viewport,
  overlay: RenderOverlayState
): void {
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Page background
  ctx.fillStyle = page.backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Apply viewport transform (world -> screen)
  ctx.setTransform(
    dpr * viewport.zoom,
    0,
    0,
    dpr * viewport.zoom,
    dpr * viewport.panX,
    dpr * viewport.panY
  );

  const visibleWorldRect: Rect = {
    x: -viewport.panX / viewport.zoom,
    y: -viewport.panY / viewport.zoom,
    width: width / viewport.zoom,
    height: height / viewport.zoom,
  };

  // Subtle dot grid when zoom >= 0.4
  if (viewport.zoom >= 0.4) {
    const step = viewport.zoom >= 1.5 ? 20 : 40;
    const startX = Math.floor(visibleWorldRect.x / step) * step;
    const startY = Math.floor(visibleWorldRect.y / step) * step;
    const endX = visibleWorldRect.x + visibleWorldRect.width;
    const endY = visibleWorldRect.y + visibleWorldRect.height;
    const dotSize = 1.2 / viewport.zoom;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
    for (let x = startX; x <= endX; x += step) {
      for (let y = startY; y <= endY; y += step) {
        ctx.fillRect(x - dotSize / 2, y - dotSize / 2, dotSize, dotSize);
      }
    }
  }

  // Draw scene tree
  for (const rootId of page.children) {
    drawNode(ctx, page, rootId, visibleWorldRect);
  }

  const selectedSet = new Set(overlay.selectedIds);
  drawFrameLabels(ctx, page, viewport.zoom, selectedSet);

  // Hovered outline
  if (overlay.hoveredId && !selectedSet.has(overlay.hoveredId)) {
    const hovered = page.nodes[overlay.hoveredId];
    if (hovered && hovered.visible) {
      const m = getNodeWorldMatrix(page, hovered.id);
      ctx.save();
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 1.5 / viewport.zoom;
      ctx.strokeRect(0, 0, hovered.width, hovered.height);
      ctx.restore();
    }
  }

  // Selection outlines & handles
  if (overlay.selectedIds.length === 1) {
    const node = page.nodes[overlay.selectedIds[0]];
    if (node) {
      const m = getNodeWorldMatrix(page, node.id);
      ctx.save();
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      const isEditingThisPath = overlay.editingPathId === node.id && node.type === 'path';
      drawSelectionBox(ctx, node.width, node.height, viewport.zoom, !isEditingThisPath);
      if (isEditingThisPath) {
        drawPathOverlay(
          ctx,
          node.anchors,
          node.closed,
          null,
          overlay.selectedAnchorIndex,
          viewport.zoom
        );
      }
      ctx.restore();
    }
  } else if (overlay.selectedIds.length > 1) {
    // Individual faint outlines + combined AABB with handles
    for (const id of overlay.selectedIds) {
      const node = page.nodes[id];
      if (!node) continue;
      const m = getNodeWorldMatrix(page, id);
      ctx.save();
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.45)';
      ctx.lineWidth = 1 / viewport.zoom;
      ctx.strokeRect(0, 0, node.width, node.height);
      ctx.restore();
    }
    const aabb = getSelectionWorldAABB(page, overlay.selectedIds);
    if (aabb) {
      ctx.save();
      ctx.translate(aabb.x, aabb.y);
      drawSelectionBox(ctx, aabb.width, aabb.height, viewport.zoom, true);
      ctx.restore();
    }
  }

  // Pen draft overlay (world space)
  if (overlay.penDraft && overlay.penDraft.anchors.length > 0) {
    const { anchors, previewPoint } = overlay.penDraft;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(anchors[0].x, anchors[0].y);
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i];
      const b = anchors[i + 1];
      const cp1 = a.handleOut ?? { x: a.x, y: a.y };
      const cp2 = b.handleIn ?? { x: b.x, y: b.y };
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, b.x, b.y);
    }
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 2 / viewport.zoom;
    ctx.stroke();

    drawPathOverlay(ctx, anchors, false, previewPoint, null, viewport.zoom);
    ctx.restore();
  }

  // Smart guides
  if (overlay.snapGuides.length > 0) {
    const invZ = 1 / viewport.zoom;
    ctx.save();
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 1 * invZ;
    for (const g of overlay.snapGuides) {
      ctx.beginPath();
      if (g.orientation === 'vertical') {
        ctx.moveTo(g.position, g.start);
        ctx.lineTo(g.position, g.end);
      } else {
        ctx.moveTo(g.start, g.position);
        ctx.lineTo(g.end, g.position);
      }
      ctx.stroke();

      if (g.kind === 'spacing' && g.label) {
        const midX = g.orientation === 'horizontal' ? (g.start + g.end) / 2 : g.position;
        const midY = g.orientation === 'vertical' ? (g.start + g.end) / 2 : g.position;
        ctx.fillStyle = '#ec4899';
        ctx.font = `${10 * invZ}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(g.label, midX, midY - 3 * invZ);
      }
    }
    ctx.restore();
  }

  // Marquee selection box
  if (overlay.marqueeRect) {
    const { x, y, width: mw, height: mh } = overlay.marqueeRect;
    ctx.save();
    ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1 / viewport.zoom;
    ctx.fillRect(x, y, mw, mh);
    ctx.strokeRect(x, y, mw, mh);
    ctx.restore();
  }

  ctx.restore();
  void applyMatrixToPoint;
  void isContainerNode;
  void (undefined as unknown as SceneNode);
}

