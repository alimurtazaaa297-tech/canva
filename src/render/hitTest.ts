import {
  applyMatrixToPoint,
  createNodeLocalMatrix,
  IDENTITY_MATRIX,
  invertMatrix,
  Matrix2D,
  multiplyMatrices,
  Point,
} from '../math/matrix';
import {
  cubicBezierPoint,
  distance,
  distToCubicBezier,
  distToSegment,
  pointInEllipse,
  pointInPolygon,
  pointInRect,
  Rect,
  rectsIntersect,
} from '../math/geometry';
import {
  getNodeWorldAABB,
  getNodeWorldMatrix,
  getSelectionWorldAABB,
  isContainerNode,
} from '../model/document';
import { PageNode, PathNode, SceneNode } from '../model/types';

export type HandleKind =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'rotate';

export interface HandleHit {
  kind: HandleKind;
}

export function getHandlePositions(
  width: number,
  height: number,
  zoom: number
): Record<HandleKind, Point> {
  const rotateOffset = 24 / zoom;
  return {
    nw: { x: 0, y: 0 },
    n: { x: width / 2, y: 0 },
    ne: { x: width, y: 0 },
    e: { x: width, y: height / 2 },
    se: { x: width, y: height },
    s: { x: width / 2, y: height },
    sw: { x: 0, y: height },
    w: { x: 0, y: height / 2 },
    rotate: { x: width / 2, y: -rotateOffset },
  };
}

/**
 * Hit-tests the 8 resize handles and rotation handle for the current selection.
 * For a single selected node, handles are in the node's rotated local space.
 * For multi-selection, handles are in the axis-aligned selection AABB world space.
 */
export function hitTestSelectionHandles(
  page: PageNode,
  selectedIds: string[],
  worldPoint: Point,
  zoom: number
): HandleHit | null {
  if (selectedIds.length === 0) return null;

  const hitRadius = 8 / zoom;

  if (selectedIds.length === 1) {
    const node = page.nodes[selectedIds[0]];
    if (!node || node.locked) return null;
    const worldMatrix = getNodeWorldMatrix(page, node.id);
    const localPoint = applyMatrixToPoint(invertMatrix(worldMatrix), worldPoint);
    const handles = getHandlePositions(node.width, node.height, zoom);
    const order: HandleKind[] = ['rotate', 'nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'];
    for (const kind of order) {
      if (distance(localPoint, handles[kind]) <= hitRadius) {
        return { kind };
      }
    }
    return null;
  }

  const aabb = getSelectionWorldAABB(page, selectedIds);
  if (!aabb) return null;
  const localPoint = { x: worldPoint.x - aabb.x, y: worldPoint.y - aabb.y };
  const handles = getHandlePositions(aabb.width, aabb.height, zoom);
  const order: HandleKind[] = ['rotate', 'nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'];
  for (const kind of order) {
    if (distance(localPoint, handles[kind]) <= hitRadius) {
      return { kind };
    }
  }
  return null;
}

function samplePathPolygon(node: PathNode, samplesPerSeg = 12): Point[] {
  const { anchors, closed } = node;
  if (anchors.length < 2) return [];
  const pts: Point[] = [{ x: anchors[0].x, y: anchors[0].y }];
  const segCount = closed ? anchors.length : anchors.length - 1;
  for (let i = 0; i < segCount; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % anchors.length];
    const p0 = { x: a.x, y: a.y };
    const p1 = a.handleOut ?? p0;
    const p2 = b.handleIn ?? { x: b.x, y: b.y };
    const p3 = { x: b.x, y: b.y };
    for (let s = 1; s <= samplesPerSeg; s++) {
      pts.push(cubicBezierPoint(p0, p1, p2, p3, s / samplesPerSeg));
    }
  }
  return pts;
}

function hitTestLocalShape(
  node: SceneNode,
  localPoint: Point,
  zoom: number
): boolean {
  const pad = 4 / zoom;

  switch (node.type) {
    case 'rect':
    case 'frame':
    case 'text': {
      return (
        localPoint.x >= -pad &&
        localPoint.x <= node.width + pad &&
        localPoint.y >= -pad &&
        localPoint.y <= node.height + pad
      );
    }
    case 'group': {
      return false; // groups are hit via their children
    }
    case 'ellipse': {
      return pointInEllipse(localPoint, node.width + pad * 2, node.height + pad * 2) ||
        pointInEllipse(
          { x: localPoint.x + pad, y: localPoint.y + pad },
          node.width + pad * 2,
          node.height + pad * 2
        );
    }
    case 'line': {
      const tol = Math.max(4, node.stroke.width / 2) + pad;
      return distToSegment(localPoint, node.p1, node.p2) <= tol;
    }
    case 'path': {
      const { anchors, closed } = node;
      if (anchors.length === 0) return false;
      if (anchors.length === 1) {
        return distance(localPoint, anchors[0]) <= pad + 4;
      }
      if (closed && node.fill.enabled) {
        const poly = samplePathPolygon(node);
        if (pointInPolygon(localPoint, poly)) return true;
      }
      const tol = Math.max(4, (node.stroke.enabled ? node.stroke.width : 2) / 2) + pad;
      const segCount = closed ? anchors.length : anchors.length - 1;
      for (let i = 0; i < segCount; i++) {
        const a = anchors[i];
        const b = anchors[(i + 1) % anchors.length];
        const p0 = { x: a.x, y: a.y };
        const p1 = a.handleOut ?? p0;
        const p2 = b.handleIn ?? { x: b.x, y: b.y };
        const p3 = { x: b.x, y: b.y };
        if (distToCubicBezier(localPoint, p0, p1, p2, p3) <= tol) {
          return true;
        }
      }
      return false;
    }
  }
}

/**
 * Hit-tests the page tree top-to-bottom in z-order.
 * Correctly handles rotated and nested nodes.
 * If `deepSelect` is false, hitting a child inside a Group returns the Group itself.
 */
export function hitTestPage(
  page: PageNode,
  worldPoint: Point,
  zoom: number,
  options: { deepSelect?: boolean; includeLocked?: boolean } = {}
): string | null {
  const { deepSelect = false, includeLocked = false } = options;

  const visit = (
    nodeId: string,
    parentWorld: Matrix2D
  ): string | null => {
    const node = page.nodes[nodeId];
    if (!node || !node.visible) return null;
    if (!includeLocked && node.locked) return null;

    const localMat = createNodeLocalMatrix(
      node.transform.x,
      node.transform.y,
      node.width,
      node.height,
      node.transform.rotation
    );
    const worldMat = multiplyMatrices(parentWorld, localMat);
    const localPt = applyMatrixToPoint(invertMatrix(worldMat), worldPoint);

    if (isContainerNode(node)) {
      const insideFrame =
        localPt.x >= 0 &&
        localPt.x <= node.width &&
        localPt.y >= 0 &&
        localPt.y <= node.height;

      const canHitChildren =
        node.type !== 'frame' || !node.clipContent || insideFrame;

      if (canHitChildren) {
        for (let i = node.children.length - 1; i >= 0; i--) {
          const childHit = visit(node.children[i], worldMat);
          if (childHit) {
            if (node.type === 'group' && !deepSelect) {
              return node.id;
            }
            return childHit;
          }
        }
      }

      if (node.type === 'frame' && insideFrame) {
        return node.id;
      }
      return null;
    }

    if (hitTestLocalShape(node, localPt, zoom)) {
      return node.id;
    }
    return null;
  };

  for (let i = page.children.length - 1; i >= 0; i--) {
    const hit = visit(page.children[i], IDENTITY_MATRIX);
    if (hit) return hit;
  }
  return null;
}

/**
 * Returns IDs of top-level selectable nodes (or children of frames) intersecting `marquee`.
 */
export function marqueeSelectPage(page: PageNode, marquee: Rect): string[] {
  const selected: string[] = [];
  for (const rootId of page.children) {
    const node = page.nodes[rootId];
    if (!node || !node.visible || node.locked) continue;
    const aabb = getNodeWorldAABB(page, rootId);
    if (rectsIntersect(marquee, aabb)) {
      selected.push(rootId);
    }
  }
  return selected;
}

/**
 * Checks if `worldPoint` is inside a FrameNode and returns the topmost FrameNode ID
 * (used when drawing new shapes inside a Frame).
 */
export function findFrameAtPoint(
  page: PageNode,
  worldPoint: Point,
  excludeIds: Set<string> = new Set()
): string | null {
  for (let i = page.children.length - 1; i >= 0; i--) {
    const id = page.children[i];
    if (excludeIds.has(id)) continue;
    const node = page.nodes[id];
    if (!node || node.type !== 'frame' || !node.visible || node.locked) continue;
    const localPt = applyMatrixToPoint(
      invertMatrix(getNodeWorldMatrix(page, id)),
      worldPoint
    );
    if (pointInRect(localPt, { x: 0, y: 0, width: node.width, height: node.height })) {
      return id;
    }
  }
  return null;
}

