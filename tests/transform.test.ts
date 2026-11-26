import { describe, expect, it } from 'vitest';
import { applyMatrixToPoint } from '../src/math/matrix';
import {
  moveNodesByWorldDelta,
  resizeSingleNode,
  rotateSingleNode,
} from '../src/math/transform';
import {
  applyFrameConstraints,
  createFrameNode,
  createRectNode,
  getNodeWorldMatrix,
} from '../src/model/document';
import { PageNode } from '../src/model/types';

function makeTestPage(): PageNode {
  const rect = createRectNode(100, 100, 80, 40);
  rect.transform.rotation = 30;
  return {
    id: 'page-1',
    type: 'page',
    name: 'Page 1',
    backgroundColor: '#fff',
    children: [rect.id],
    nodes: { [rect.id]: rect },
  };
}

describe('Transforms', () => {
  it('keeps the opposite corner anchored when resizing a rotated shape', () => {
    const page = makeTestPage();
    const id = page.children[0];
    const initialWorldMat = getNodeWorldMatrix(page, id);
    const nwBefore = applyMatrixToPoint(initialWorldMat, { x: 0, y: 0 });

    // Drag SE handle to a new world position
    const updates = resizeSingleNode(page, id, 'se', { x: 250, y: 220 });
    const nextPage: PageNode = {
      ...page,
      nodes: { ...page.nodes, ...updates },
    };
    const nextWorldMat = getNodeWorldMatrix(nextPage, id);
    const nwAfter = applyMatrixToPoint(nextWorldMat, { x: 0, y: 0 });

    expect(nwAfter.x).toBeCloseTo(nwBefore.x, 4);
    expect(nwAfter.y).toBeCloseTo(nwBefore.y, 4);
    expect(nextPage.nodes[id].width).toBeGreaterThan(80);
  });

  it('snaps rotation to 15-degree increments when snap15Deg is true', () => {
    const page = makeTestPage();
    const id = page.children[0];
    const updates = rotateSingleNode(
      page,
      id,
      { x: 200, y: 120 },
      { x: 140, y: 60 },
      true
    );
    expect(updates[id].transform.rotation % 15).toBeCloseTo(0, 5);
  });

  it('moves a child inside a rotated parent frame in world delta', () => {
    const frame = createFrameNode(0, 0, 200, 200);
    frame.transform.rotation = 90;
    const child = createRectNode(20, 20, 40, 40, frame.id);
    frame.children = [child.id];

    const page: PageNode = {
      id: 'p1',
      type: 'page',
      name: 'P1',
      backgroundColor: '#fff',
      children: [frame.id],
      nodes: { [frame.id]: frame, [child.id]: child },
    };

    const beforeWorld = applyMatrixToPoint(getNodeWorldMatrix(page, child.id), {
      x: 0,
      y: 0,
    });

    const updates = moveNodesByWorldDelta(page, [child.id], 25, -15);
    const nextPage: PageNode = {
      ...page,
      nodes: { ...page.nodes, ...updates },
    };
    const afterWorld = applyMatrixToPoint(
      getNodeWorldMatrix(nextPage, child.id),
      { x: 0, y: 0 }
    );

    expect(afterWorld.x - beforeWorld.x).toBeCloseTo(25, 4);
    expect(afterWorld.y - beforeWorld.y).toBeCloseTo(-15, 4);
  });

  it('applies horizontal and vertical constraints when parent frame resizes', () => {
    const frame = createFrameNode(0, 0, 200, 200);
    const pinnedRight = createRectNode(150, 20, 30, 30, frame.id);
    pinnedRight.constraints = { horizontal: 'right', vertical: 'bottom' };

    const stretched = createRectNode(20, 20, 160, 40, frame.id);
    stretched.constraints = { horizontal: 'left-right', vertical: 'scale' };

    frame.children = [pinnedRight.id, stretched.id];
    const page: PageNode = {
      id: 'p1',
      type: 'page',
      name: 'P1',
      backgroundColor: '#fff',
      children: [frame.id],
      nodes: {
        [frame.id]: frame,
        [pinnedRight.id]: pinnedRight,
        [stretched.id]: stretched,
      },
    };

    const nextNodes = applyFrameConstraints(page, frame.id, 200, 200, 300, 400);
    expect(nextNodes[pinnedRight.id].transform.x).toBe(250);
    expect(nextNodes[pinnedRight.id].transform.y).toBe(220);
    expect(nextNodes[stretched.id].width).toBe(260);
    expect(nextNodes[stretched.id].height).toBe(80);
  });
});

