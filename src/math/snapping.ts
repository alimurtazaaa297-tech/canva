import { Rect } from './geometry';

export interface SnapGuide {
  orientation: 'vertical' | 'horizontal';
  position: number; // x for vertical, y for horizontal (world space)
  start: number; // minY for vertical, minX for horizontal
  end: number; // maxY for vertical, maxX for horizontal
  kind: 'align' | 'spacing';
  label?: string;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

/**
 * Computes smart-guide snapping for a moving AABB (`movingRect`) against `targetRects`.
 * Snaps left/center/right edges vertically and top/center/bottom edges horizontally,
 * plus equal-spacing detection between adjacent shapes.
 */
export function computeSmartGuides(
  movingRect: Rect,
  targetRects: Rect[],
  thresholdWorld: number
): SnapResult {
  if (targetRects.length === 0) {
    return { dx: 0, dy: 0, guides: [] };
  }

  const mLeft = movingRect.x;
  const mCenterX = movingRect.x + movingRect.width / 2;
  const mRight = movingRect.x + movingRect.width;

  const mTop = movingRect.y;
  const mCenterY = movingRect.y + movingRect.height / 2;
  const mBottom = movingRect.y + movingRect.height;

  let bestDx = 0;
  let bestDistX = thresholdWorld + 1e-6;
  let bestXTargets: { pos: number; minY: number; maxY: number }[] = [];

  let bestDy = 0;
  let bestDistY = thresholdWorld + 1e-6;
  let bestYTargets: { pos: number; minX: number; maxX: number }[] = [];

  const movingXs = [mLeft, mCenterX, mRight];
  const movingYs = [mTop, mCenterY, mBottom];

  for (const t of targetRects) {
    const tXs = [t.x, t.x + t.width / 2, t.x + t.width];
    const tYs = [t.y, t.y + t.height / 2, t.y + t.height];

    for (const mx of movingXs) {
      for (const tx of tXs) {
        const diff = tx - mx;
        const absDiff = Math.abs(diff);
        if (absDiff < bestDistX - 1e-4) {
          bestDistX = absDiff;
          bestDx = diff;
          bestXTargets = [
            {
              pos: tx,
              minY: Math.min(mTop, t.y),
              maxY: Math.max(mBottom, t.y + t.height),
            },
          ];
        } else if (Math.abs(absDiff - bestDistX) < 1e-4 && Math.abs(diff - bestDx) < 1e-4) {
          bestXTargets.push({
            pos: tx,
            minY: Math.min(mTop, t.y),
            maxY: Math.max(mBottom, t.y + t.height),
          });
        }
      }
    }

    for (const my of movingYs) {
      for (const ty of tYs) {
        const diff = ty - my;
        const absDiff = Math.abs(diff);
        if (absDiff < bestDistY - 1e-4) {
          bestDistY = absDiff;
          bestDy = diff;
          bestYTargets = [
            {
              pos: ty,
              minX: Math.min(mLeft, t.x),
              maxX: Math.max(mRight, t.x + t.width),
            },
          ];
        } else if (Math.abs(absDiff - bestDistY) < 1e-4 && Math.abs(diff - bestDy) < 1e-4) {
          bestYTargets.push({
            pos: ty,
            minX: Math.min(mLeft, t.x),
            maxX: Math.max(mRight, t.x + t.width),
          });
        }
      }
    }
  }

  const guides: SnapGuide[] = [];

  if (bestDistX <= thresholdWorld) {
    for (const g of bestXTargets) {
      guides.push({
        orientation: 'vertical',
        position: g.pos,
        start: g.minY + (bestDistY <= thresholdWorld ? Math.min(0, bestDy) : 0),
        end: g.maxY + (bestDistY <= thresholdWorld ? Math.max(0, bestDy) : 0),
        kind: 'align',
      });
    }
  } else {
    bestDx = 0;
  }

  if (bestDistY <= thresholdWorld) {
    for (const g of bestYTargets) {
      guides.push({
        orientation: 'horizontal',
        position: g.pos,
        start: g.minX + bestDx,
        end: g.maxX + bestDx,
        kind: 'align',
      });
    }
  } else {
    bestDy = 0;
  }

  // Equal-spacing detection on X for horizontally overlapping rows
  if (targetRects.length >= 2) {
    const snappedRect: Rect = {
      x: movingRect.x + bestDx,
      y: movingRect.y + bestDy,
      width: movingRect.width,
      height: movingRect.height,
    };

    const rowTargets = targetRects
      .filter(
        (t) =>
          t.y < snappedRect.y + snappedRect.height &&
          t.y + t.height > snappedRect.y
      )
      .sort((a, b) => a.x - b.x);

    for (let i = 0; i < rowTargets.length - 1; i++) {
      const left = rowTargets[i];
      const right = rowTargets[i + 1];
      if (snappedRect.x >= left.x + left.width && snappedRect.x + snappedRect.width <= right.x) {
        const gapLeft = snappedRect.x - (left.x + left.width);
        const gapRight = right.x - (snappedRect.x + snappedRect.width);
        if (Math.abs(gapLeft - gapRight) <= thresholdWorld) {
          const midY = snappedRect.y + snappedRect.height / 2;
          guides.push(
            {
              orientation: 'horizontal',
              position: midY,
              start: left.x + left.width,
              end: snappedRect.x,
              kind: 'spacing',
              label: `${Math.round((gapLeft + gapRight) / 2)}`,
            },
            {
              orientation: 'horizontal',
              position: midY,
              start: snappedRect.x + snappedRect.width,
              end: right.x,
              kind: 'spacing',
              label: `${Math.round((gapLeft + gapRight) / 2)}`,
            }
          );
        }
      }
    }
  }

  return { dx: bestDx, dy: bestDy, guides };
}

