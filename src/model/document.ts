import { nanoid } from 'nanoid';
import {
  applyMatrixToPoint,
  createNodeLocalMatrix,
  IDENTITY_MATRIX,
  invertMatrix,
  Matrix2D,
  multiplyMatrices,
} from '../math/matrix';
import { getTransformedAABB, mergeRects, Rect } from '../math/geometry';
import {
  Constraints,
  ContainerNode,
  DocumentModel,
  EllipseNode,
  FrameNode,
  GroupNode,
  LineNode,
  PageNode,
  PathAnchor,
  PathNode,
  RectNode,
  SceneNode,
  ShadowStyle,
  TextNode,
} from './types';

export const DEFAULT_CONSTRAINTS: Constraints = {
  horizontal: 'left',
  vertical: 'top',
};

export const DEFAULT_SHADOW: ShadowStyle = {
  enabled: false,
  color: 'rgba(0,0,0,0.25)',
  blur: 12,
  offsetX: 0,
  offsetY: 4,
};

export function isContainerNode(node: SceneNode): node is ContainerNode {
  return node.type === 'frame' || node.type === 'group';
}

export function createEmptyDocument(): DocumentModel {
  const pageId = nanoid(8);
  const frameId = nanoid(8);
  const rectId = nanoid(8);
  const textId = nanoid(8);

  const welcomeFrame: FrameNode = {
    id: frameId,
    type: 'frame',
    name: 'Desktop - 1',
    parentId: null,
    transform: { x: 120, y: 80, rotation: 0 },
    width: 640,
    height: 420,
    visible: true,
    locked: false,
    opacity: 1,
    constraints: { ...DEFAULT_CONSTRAINTS },
    fill: { color: '#ffffff', enabled: true },
    stroke: { color: '#e2e8f0', width: 1, enabled: false },
    cornerRadius: 12,
    shadow: {
      enabled: true,
      color: 'rgba(15, 23, 42, 0.12)',
      blur: 24,
      offsetX: 0,
      offsetY: 8,
    },
    clipContent: true,
    children: [rectId, textId],
  };

  const heroCard: RectNode = {
    id: rectId,
    type: 'rect',
    name: 'Accent Card',
    parentId: frameId,
    transform: { x: 40, y: 40, rotation: 0 },
    width: 220,
    height: 140,
    visible: true,
    locked: false,
    opacity: 1,
    constraints: { horizontal: 'left', vertical: 'top' },
    fill: { color: '#3b82f6', enabled: true },
    stroke: { color: '#1d4ed8', width: 0, enabled: false },
    cornerRadius: 16,
    shadow: { ...DEFAULT_SHADOW },
  };

  const titleText: TextNode = {
    id: textId,
    type: 'text',
    name: 'Heading',
    parentId: frameId,
    transform: { x: 40, y: 204, rotation: 0 },
    width: 340,
    height: 44,
    visible: true,
    locked: false,
    opacity: 1,
    constraints: { horizontal: 'left', vertical: 'top' },
    text: 'Mini Figma Canvas',
    fontSize: 28,
    fontFamily: 'Inter, system-ui, sans-serif',
    fontWeight: 700,
    textAlign: 'left',
    fill: { color: '#0f172a', enabled: true },
    shadow: { ...DEFAULT_SHADOW },
  };

  const page: PageNode = {
    id: pageId,
    type: 'page',
    name: 'Page 1',
    backgroundColor: '#f1f5f9',
    children: [frameId],
    nodes: {
      [frameId]: welcomeFrame,
      [rectId]: heroCard,
      [textId]: titleText,
    },
  };

  return {
    version: 1,
    id: nanoid(10),
    name: 'Untitled Design',
    pages: [page],
    activePageId: pageId,
  };
}

export function getActivePage(doc: DocumentModel): PageNode {
  return doc.pages.find((p) => p.id === doc.activePageId) ?? doc.pages[0];
}

export function updateActivePage(
  doc: DocumentModel,
  updater: (page: PageNode) => PageNode
): DocumentModel {
  return {
    ...doc,
    pages: doc.pages.map((p) => (p.id === doc.activePageId ? updater(p) : p)),
  };
}

export function getNodeWorldMatrix(page: PageNode, nodeId: string): Matrix2D {
  const chain: SceneNode[] = [];
  let current: SceneNode | undefined = page.nodes[nodeId];
  while (current) {
    chain.push(current);
    current = current.parentId ? page.nodes[current.parentId] : undefined;
  }
  let m: Matrix2D = IDENTITY_MATRIX;
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i];
    const local = createNodeLocalMatrix(
      n.transform.x,
      n.transform.y,
      n.width,
      n.height,
      n.transform.rotation
    );
    m = multiplyMatrices(m, local);
  }
  return m;
}

export function getParentWorldMatrix(page: PageNode, nodeId: string): Matrix2D {
  const node = page.nodes[nodeId];
  if (!node || !node.parentId) return IDENTITY_MATRIX;
  return getNodeWorldMatrix(page, node.parentId);
}

export function getNodeWorldAABB(page: PageNode, nodeId: string): Rect {
  const node = page.nodes[nodeId];
  if (!node) return { x: 0, y: 0, width: 0, height: 0 };
  const world = getNodeWorldMatrix(page, nodeId);
  return getTransformedAABB(node.width, node.height, world);
}

export function getSelectionWorldAABB(page: PageNode, ids: string[]): Rect | null {
  const rects: Rect[] = [];
  for (const id of ids) {
    if (page.nodes[id]) {
      rects.push(getNodeWorldAABB(page, id));
    }
  }
  if (rects.length === 0) return null;
  return mergeRects(rects);
}

export function isNodeVisibleInTree(page: PageNode, nodeId: string): boolean {
  let curr: SceneNode | undefined = page.nodes[nodeId];
  while (curr) {
    if (!curr.visible) return false;
    curr = curr.parentId ? page.nodes[curr.parentId] : undefined;
  }
  return true;
}

export function isNodeLockedInTree(page: PageNode, nodeId: string): boolean {
  let curr: SceneNode | undefined = page.nodes[nodeId];
  while (curr) {
    if (curr.locked) return true;
    curr = curr.parentId ? page.nodes[curr.parentId] : undefined;
  }
  return false;
}

export function collectSubtreeIds(page: PageNode, rootId: string): string[] {
  const result: string[] = [];
  const visit = (id: string) => {
    const node = page.nodes[id];
    if (!node) return;
    result.push(id);
    if (isContainerNode(node)) {
      for (const cid of node.children) {
        visit(cid);
      }
    }
  };
  visit(rootId);
  return result;
}

/**
 * Normalizes a GroupNode's bounding box to tightly wrap its children in world/parent space,
 * adjusting children's local coordinates accordingly.
 */
export function fitGroupToChildren(page: PageNode, groupId: string): PageNode {
  const group = page.nodes[groupId];
  if (!group || group.type !== 'group' || group.children.length === 0) return page;

  const childRects = group.children
    .map((cid) => {
      const c = page.nodes[cid];
      if (!c) return null;
      const local = createNodeLocalMatrix(
        c.transform.x,
        c.transform.y,
        c.width,
        c.height,
        c.transform.rotation
      );
      return getTransformedAABB(c.width, c.height, local);
    })
    .filter((r): r is Rect => r !== null);

  if (childRects.length === 0) return page;
  const bounds = mergeRects(childRects);
  if (bounds.x === 0 && bounds.y === 0 && bounds.width === group.width && bounds.height === group.height) {
    return page;
  }

  // Offset in group's local space rotated to parent space
  const groupLocal = createNodeLocalMatrix(
    group.transform.x,
    group.transform.y,
    group.width,
    group.height,
    group.transform.rotation
  );
  const newOriginInParent = applyMatrixToPoint(groupLocal, { x: bounds.x, y: bounds.y });
  const updatedNodes = { ...page.nodes };

  for (const cid of group.children) {
    const c = updatedNodes[cid];
    if (!c) continue;
    updatedNodes[cid] = {
      ...c,
      transform: {
        ...c.transform,
        x: c.transform.x - bounds.x,
        y: c.transform.y - bounds.y,
      },
    };
  }

  // Recompute top-left for rotated group so its center stays aligned
  const newCenterLocal = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const newCenterParent = applyMatrixToPoint(groupLocal, newCenterLocal);
  const newX = newCenterParent.x - bounds.width / 2;
  const newY = newCenterParent.y - bounds.height / 2;
  void newOriginInParent;

  updatedNodes[groupId] = {
    ...group,
    transform: { ...group.transform, x: newX, y: newY },
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  };

  return { ...page, nodes: updatedNodes };
}

export function createRectNode(
  x: number,
  y: number,
  width: number,
  height: number,
  parentId: string | null = null
): RectNode {
  return {
    id: nanoid(8),
    type: 'rect',
    name: 'Rectangle',
    parentId,
    transform: { x, y, rotation: 0 },
    width: Math.max(1, width),
    height: Math.max(1, height),
    visible: true,
    locked: false,
    opacity: 1,
    constraints: { ...DEFAULT_CONSTRAINTS },
    fill: { color: '#93c5fd', enabled: true },
    stroke: { color: '#2563eb', width: 2, enabled: false },
    cornerRadius: 0,
    shadow: { ...DEFAULT_SHADOW },
  };
}

export function createEllipseNode(
  x: number,
  y: number,
  width: number,
  height: number,
  parentId: string | null = null
): EllipseNode {
  return {
    id: nanoid(8),
    type: 'ellipse',
    name: 'Ellipse',
    parentId,
    transform: { x, y, rotation: 0 },
    width: Math.max(1, width),
    height: Math.max(1, height),
    visible: true,
    locked: false,
    opacity: 1,
    constraints: { ...DEFAULT_CONSTRAINTS },
    fill: { color: '#fca5a5', enabled: true },
    stroke: { color: '#dc2626', width: 2, enabled: false },
    shadow: { ...DEFAULT_SHADOW },
  };
}

export function createFrameNode(
  x: number,
  y: number,
  width: number,
  height: number,
  parentId: string | null = null
): FrameNode {
  return {
    id: nanoid(8),
    type: 'frame',
    name: 'Frame',
    parentId,
    transform: { x, y, rotation: 0 },
    width: Math.max(1, width),
    height: Math.max(1, height),
    visible: true,
    locked: false,
    opacity: 1,
    constraints: { ...DEFAULT_CONSTRAINTS },
    fill: { color: '#ffffff', enabled: true },
    stroke: { color: '#cbd5e1', width: 1, enabled: true },
    cornerRadius: 0,
    shadow: { ...DEFAULT_SHADOW },
    clipContent: true,
    children: [],
  };
}

export function createLineNode(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  parentId: string | null = null
): LineNode {
  const minX = Math.min(x1, x2);
  const minY = Math.min(y1, y2);
  const w = Math.max(1, Math.abs(x2 - x1));
  const h = Math.max(1, Math.abs(y2 - y1));
  return {
    id: nanoid(8),
    type: 'line',
    name: 'Line',
    parentId,
    transform: { x: minX, y: minY, rotation: 0 },
    width: w,
    height: h,
    p1: { x: x1 - minX, y: y1 - minY },
    p2: { x: x2 - minX, y: y2 - minY },
    visible: true,
    locked: false,
    opacity: 1,
    constraints: { ...DEFAULT_CONSTRAINTS },
    stroke: { color: '#0f172a', width: 2, enabled: true },
    shadow: { ...DEFAULT_SHADOW },
  };
}

export function createTextNode(
  x: number,
  y: number,
  text = 'Text',
  parentId: string | null = null
): TextNode {
  return {
    id: nanoid(8),
    type: 'text',
    name: 'Text',
    parentId,
    transform: { x, y, rotation: 0 },
    width: 140,
    height: 32,
    visible: true,
    locked: false,
    opacity: 1,
    constraints: { ...DEFAULT_CONSTRAINTS },
    text,
    fontSize: 20,
    fontFamily: 'Inter, system-ui, sans-serif',
    fontWeight: 500,
    textAlign: 'left',
    fill: { color: '#0f172a', enabled: true },
    shadow: { ...DEFAULT_SHADOW },
  };
}

export function createPathNode(
  worldAnchors: PathAnchor[],
  closed: boolean,
  parentId: string | null = null
): PathNode {
  const pts: { x: number; y: number }[] = [];
  for (const a of worldAnchors) {
    pts.push({ x: a.x, y: a.y });
    if (a.handleIn) pts.push(a.handleIn);
    if (a.handleOut) pts.push(a.handleOut);
  }
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxX = Math.max(...pts.map((p) => p.x));
  const maxY = Math.max(...pts.map((p) => p.y));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  const localAnchors: PathAnchor[] = worldAnchors.map((a) => ({
    x: a.x - minX,
    y: a.y - minY,
    handleIn: a.handleIn
      ? { x: a.handleIn.x - minX, y: a.handleIn.y - minY }
      : undefined,
    handleOut: a.handleOut
      ? { x: a.handleOut.x - minX, y: a.handleOut.y - minY }
      : undefined,
  }));

  return {
    id: nanoid(8),
    type: 'path',
    name: 'Vector',
    parentId,
    transform: { x: minX, y: minY, rotation: 0 },
    width,
    height,
    visible: true,
    locked: false,
    opacity: 1,
    constraints: { ...DEFAULT_CONSTRAINTS },
    anchors: localAnchors,
    closed,
    fill: { color: '#a78bfa', enabled: closed },
    stroke: { color: '#4f46e5', width: 2, enabled: true },
    shadow: { ...DEFAULT_SHADOW },
  };
}

export function createGroupNode(
  x: number,
  y: number,
  width: number,
  height: number,
  children: string[],
  parentId: string | null = null
): GroupNode {
  return {
    id: nanoid(8),
    type: 'group',
    name: 'Group',
    parentId,
    transform: { x, y, rotation: 0 },
    width: Math.max(1, width),
    height: Math.max(1, height),
    visible: true,
    locked: false,
    opacity: 1,
    constraints: { ...DEFAULT_CONSTRAINTS },
    children,
  };
}

/**
 * Converts a world point to a node's local space.
 */
export function worldToNodeLocal(
  page: PageNode,
  nodeId: string,
  worldPoint: { x: number; y: number }
): { x: number; y: number } {
  const inv = invertMatrix(getNodeWorldMatrix(page, nodeId));
  return applyMatrixToPoint(inv, worldPoint);
}

/**
 * Applies parent-frame constraints to direct children when a frame is resized
 * from oldWidth/oldHeight to newWidth/newHeight.
 */
export function applyFrameConstraints(
  page: PageNode,
  frameId: string,
  oldWidth: number,
  oldHeight: number,
  newWidth: number,
  newHeight: number
): Record<string, SceneNode> {
  const frame = page.nodes[frameId];
  if (!frame || frame.type !== 'frame' || oldWidth <= 0 || oldHeight <= 0) {
    return page.nodes;
  }

  const dx = newWidth - oldWidth;
  const dy = newHeight - oldHeight;
  const sx = newWidth / oldWidth;
  const sy = newHeight / oldHeight;

  const nextNodes = { ...page.nodes };
  for (const childId of frame.children) {
    const child = nextNodes[childId];
    if (!child) continue;

    let { x, y } = child.transform;
    let w = child.width;
    let h = child.height;

    switch (child.constraints.horizontal) {
      case 'left':
        break;
      case 'right':
        x += dx;
        break;
      case 'center':
        x += dx / 2;
        break;
      case 'left-right':
        w = Math.max(1, w + dx);
        break;
      case 'scale':
        x *= sx;
        w = Math.max(1, w * sx);
        break;
    }

    switch (child.constraints.vertical) {
      case 'top':
        break;
      case 'bottom':
        y += dy;
        break;
      case 'center':
        y += dy / 2;
        break;
      case 'top-bottom':
        h = Math.max(1, h + dy);
        break;
      case 'scale':
        y *= sy;
        h = Math.max(1, h * sy);
        break;
    }

    nextNodes[childId] = {
      ...child,
      transform: { ...child.transform, x, y },
      width: w,
      height: h,
    };
  }
  return nextNodes;
}

