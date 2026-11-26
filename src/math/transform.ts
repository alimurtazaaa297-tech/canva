import {
  applyMatrixToPoint,
  createNodeLocalMatrix,
  invertMatrix,
  Point,
  radToDeg,
} from './matrix';
import { Rect } from './geometry';
import { applyFrameConstraints, getNodeWorldMatrix, getParentWorldMatrix } from '../model/document';
import { PageNode, SceneNode } from '../model/types';
import { HandleKind } from '../render/hitTest';

export interface ResizeOptions {
  preserveAspectRatio?: boolean;
}

/**
 * Resizes a single node (including rotated or nested nodes) using one of the 8 handles,
 * keeping the opposite corner/edge anchored in world space.
 */
export function resizeSingleNode(
  initialPage: PageNode,
  nodeId: string,
  handle: HandleKind,
  worldPointer: Point,
  options: ResizeOptions = {}
): Record<string, SceneNode> {
  const initialNode = initialPage.nodes[nodeId];
  if (!initialNode || handle === 'rotate') return {};

  const initialWorld = getNodeWorldMatrix(initialPage, nodeId);
  const localPointer = applyMatrixToPoint(invertMatrix(initialWorld), worldPointer);

  const w0 = initialNode.width;
  const h0 = initialNode.height;

  let minX = 0;
  let minY = 0;
  let maxX = w0;
  let maxY = h0;

  const movesLeft = handle === 'nw' || handle === 'w' || handle === 'sw';
  const movesRight = handle === 'ne' || handle === 'e' || handle === 'se';
  const movesTop = handle === 'nw' || handle === 'n' || handle === 'ne';
  const movesBottom = handle === 'sw' || handle === 's' || handle === 'se';

  if (movesLeft) minX = Math.min(w0 - 1, localPointer.x);
  if (movesRight) maxX = Math.max(1, localPointer.x);
  if (movesTop) minY = Math.min(h0 - 1, localPointer.y);
  if (movesBottom) maxY = Math.max(1, localPointer.y);

  let newW = Math.max(1, maxX - minX);
  let newH = Math.max(1, maxY - minY);

  if (options.preserveAspectRatio && w0 > 0 && h0 > 0) {
    const aspect = w0 / h0;
    if (movesLeft || movesRight) {
      if (movesTop || movesBottom) {
        if (newW / newH > aspect) {
          newH = Math.max(1, newW / aspect);
        } else {
          newW = Math.max(1, newH * aspect);
        }
        if (movesLeft) minX = maxX - newW;
        else maxX = minX + newW;
        if (movesTop) minY = maxY - newH;
        else maxY = minY + newH;
      }
    }
  }

  const localCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const initialLocalMat = createNodeLocalMatrix(
    initialNode.transform.x,
    initialNode.transform.y,
    w0,
    h0,
    initialNode.transform.rotation
  );
  const parentCenter = applyMatrixToPoint(initialLocalMat, localCenter);

  const newX = parentCenter.x - newW / 2;
  const newY = parentCenter.y - newH / 2;

  const sx = w0 > 0 ? newW / w0 : 1;
  const sy = h0 > 0 ? newH / h0 : 1;

  let updatedNode: SceneNode = {
    ...initialNode,
    transform: { ...initialNode.transform, x: newX, y: newY },
    width: newW,
    height: newH,
  };

  if (updatedNode.type === 'line') {
    updatedNode = {
      ...updatedNode,
      p1: { x: updatedNode.p1.x * sx, y: updatedNode.p1.y * sy },
      p2: { x: updatedNode.p2.x * sx, y: updatedNode.p2.y * sy },
    };
  } else if (updatedNode.type === 'path') {
    updatedNode = {
      ...updatedNode,
      anchors: updatedNode.anchors.map((a) => ({
        x: a.x * sx,
        y: a.y * sy,
        handleIn: a.handleIn
          ? { x: a.handleIn.x * sx, y: a.handleIn.y * sy }
          : undefined,
        handleOut: a.handleOut
          ? { x: a.handleOut.x * sx, y: a.handleOut.y * sy }
          : undefined,
      })),
    };
  }

  const result: Record<string, SceneNode> = {
    [nodeId]: updatedNode,
  };

  if (initialNode.type === 'frame') {
    const tempPage: PageNode = {
      ...initialPage,
      nodes: { ...initialPage.nodes, [nodeId]: updatedNode },
    };
    const constrainedNodes = applyFrameConstraints(
      tempPage,
      nodeId,
      w0,
      h0,
      newW,
      newH
    );
    for (const cid of initialNode.children) {
      if (constrainedNodes[cid]) {
        result[cid] = constrainedNodes[cid];
      }
    }
  }

  return result;
}

/**
 * Computes new rotation (in degrees) for a single node being rotated around its center.
 */
export function rotateSingleNode(
  initialPage: PageNode,
  nodeId: string,
  worldPointer: Point,
  startWorldPointer: Point,
  snap15Deg = false
): Record<string, SceneNode> {
  const initialNode = initialPage.nodes[nodeId];
  if (!initialNode) return {};

  const worldMat = getNodeWorldMatrix(initialPage, nodeId);
  const centerWorld = applyMatrixToPoint(worldMat, {
    x: initialNode.width / 2,
    y: initialNode.height / 2,
  });

  const a0 = Math.atan2(
    startWorldPointer.y - centerWorld.y,
    startWorldPointer.x - centerWorld.x
  );
  const a1 = Math.atan2(
    worldPointer.y - centerWorld.y,
    worldPointer.x - centerWorld.x
  );
  let deltaDeg = radToDeg(a1 - a0);
  let nextRot = initialNode.transform.rotation + deltaDeg;

  if (snap15Deg) {
    nextRot = Math.round(nextRot / 15) * 15;
  }

  return {
    [nodeId]: {
      ...initialNode,
      transform: {
        ...initialNode.transform,
        rotation: nextRot,
      },
    },
  };
}

/**
 * Moves a set of nodes by a world-space delta `(worldDx, worldDy)`,
 * converting the delta into each node's parent space so nested & rotated parents work.
 */
export function moveNodesByWorldDelta(
  initialPage: PageNode,
  nodeIds: string[],
  worldDx: number,
  worldDy: number
): Record<string, SceneNode> {
  const result: Record<string, SceneNode> = {};
  for (const id of nodeIds) {
    const node = initialPage.nodes[id];
    if (!node || node.locked) continue;

    const parentWorld = getParentWorldMatrix(initialPage, id);
    const invParent = invertMatrix(parentWorld);
    // Delta vector ignores translation components tx, ty
    const localDx = invParent[0] * worldDx + invParent[2] * worldDy;
    const localDy = invParent[1] * worldDx + invParent[3] * worldDy;

    result[id] = {
      ...node,
      transform: {
        ...node.transform,
        x: node.transform.x + localDx,
        y: node.transform.y + localDy,
      },
    };
  }
  return result;
}

/**
 * Resizes multiple selected nodes proportionally using the combined axis-aligned bounding box.
 */
export function resizeMultiSelection(
  initialPage: PageNode,
  initialAABB: Rect,
  nodeIds: string[],
  handle: HandleKind,
  worldPointer: Point
): Record<string, SceneNode> {
  if (handle === 'rotate') return {};

  let minX = initialAABB.x;
  let minY = initialAABB.y;
  let maxX = initialAABB.x + initialAABB.width;
  let maxY = initialAABB.y + initialAABB.height;

  if (handle === 'nw' || handle === 'w' || handle === 'sw') {
    minX = Math.min(maxX - 1, worldPointer.x);
  }
  if (handle === 'ne' || handle === 'e' || handle === 'se') {
    maxX = Math.max(minX + 1, worldPointer.x);
  }
  if (handle === 'nw' || handle === 'n' || handle === 'ne') {
    minY = Math.min(maxY - 1, worldPointer.y);
  }
  if (handle === 'sw' || handle === 's' || handle === 'se') {
    maxY = Math.max(minY + 1, worldPointer.y);
  }

  const newW = Math.max(1, maxX - minX);
  const newH = Math.max(1, maxY - minY);
  const sx = initialAABB.width > 0 ? newW / initialAABB.width : 1;
  const sy = initialAABB.height > 0 ? newH / initialAABB.height : 1;

  const result: Record<string, SceneNode> = {};
  for (const id of nodeIds) {
    const node = initialPage.nodes[id];
    if (!node || node.locked) continue;
    const relX = node.transform.x - initialAABB.x;
    const relY = node.transform.y - initialAABB.y;
    result[id] = {
      ...node,
      transform: {
        ...node.transform,
        x: minX + relX * sx,
        y: minY + relY * sy,
      },
      width: Math.max(1, node.width * sx),
      height: Math.max(1, node.height * sy),
    };
  }
  return result;
}

