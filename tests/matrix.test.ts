import { describe, expect, it } from 'vitest';
import {
  applyMatrixToPoint,
  createNodeLocalMatrix,
  IDENTITY_MATRIX,
  invertMatrix,
  multiplyMatrices,
} from '../src/math/matrix';
import { screenToWorld, worldToScreen } from '../src/math/geometry';

describe('Matrix2D math', () => {
  it('inverts a combined translation and rotation matrix', () => {
    const m = createNodeLocalMatrix(100, 50, 200, 100, 45);
    const inv = invertMatrix(m);
    const prod = multiplyMatrices(m, inv);

    for (let i = 0; i < 6; i++) {
      expect(prod[i]).toBeCloseTo(IDENTITY_MATRIX[i], 5);
    }
  });

  it('rotates around the local center (width/2, height/2)', () => {
    const m = createNodeLocalMatrix(10, 20, 100, 60, 90);
    const center = applyMatrixToPoint(m, { x: 50, y: 30 });
    expect(center.x).toBeCloseTo(60, 5);
    expect(center.y).toBeCloseTo(50, 5);

    const topLeft = applyMatrixToPoint(m, { x: 0, y: 0 });
    // (-50, -30) rotated +90deg -> (30, -50), plus center (60, 50) -> (90, 0)
    expect(topLeft.x).toBeCloseTo(90, 5);
    expect(topLeft.y).toBeCloseTo(0, 5);
  });

  it('converts between screen and world space accurately', () => {
    const vp = { panX: 120, panY: -40, zoom: 2.5 };
    const world = { x: 84, y: 112 };
    const screen = worldToScreen(world, vp);
    const back = screenToWorld(screen, vp);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
  });
});

