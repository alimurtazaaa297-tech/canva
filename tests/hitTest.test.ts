import { describe, expect, it } from 'vitest';
import {
  createEllipseNode,
  createFrameNode,
  createRectNode,
} from '../src/model/document';
import { PageNode } from '../src/model/types';
import { hitTestPage } from '../src/render/hitTest';

describe('Hit-testing', () => {
  it('hits a rotated rectangle accurately and misses outside its rotated corners', () => {
    const rect = createRectNode(100, 100, 100, 20);
    rect.transform.rotation = 45;

    const page: PageNode = {
      id: 'p1',
      type: 'page',
      name: 'P1',
      backgroundColor: '#fff',
      children: [rect.id],
      nodes: { [rect.id]: rect },
    };

    // Center is (150, 110) -> should hit
    expect(hitTestPage(page, { x: 150, y: 110 }, 1)).toBe(rect.id);
    // Unrotated top-left (100, 100) is outside after 45deg rotation of thin bar
    expect(hitTestPage(page, { x: 100, y: 100 }, 1)).toBeNull();
  });

  it('hits an ellipse inside its radius and misses the bounding-box corner', () => {
    const ellipse = createEllipseNode(0, 0, 100, 100);
    const page: PageNode = {
      id: 'p1',
      type: 'page',
      name: 'P1',
      backgroundColor: '#fff',
      children: [ellipse.id],
      nodes: { [ellipse.id]: ellipse },
    };

    expect(hitTestPage(page, { x: 50, y: 50 }, 1)).toBe(ellipse.id);
    expect(hitTestPage(page, { x: 2, y: 2 }, 1)).toBeNull();
  });

  it('respects frame clipContent when hit-testing nested children', () => {
    const frame = createFrameNode(0, 0, 100, 100);
    frame.clipContent = true;
    const child = createRectNode(80, 80, 100, 100, frame.id);
    frame.children = [child.id];

    const page: PageNode = {
      id: 'p1',
      type: 'page',
      name: 'P1',
      backgroundColor: '#fff',
      children: [frame.id],
      nodes: { [frame.id]: frame, [child.id]: child },
    };

    // Inside frame & child
    expect(hitTestPage(page, { x: 90, y: 90 }, 1)).toBe(child.id);
    // Inside child bounds, but clipped outside frame
    expect(hitTestPage(page, { x: 140, y: 140 }, 1)).toBeNull();
  });
});

