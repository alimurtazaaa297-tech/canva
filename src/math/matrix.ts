export interface Point {
  x: number;
  y: number;
}

/**
 * 2D Affine Transformation Matrix represented as [a, b, c, d, tx, ty]:
 * | a  c  tx |
 * | b  d  ty |
 * | 0  0  1  |
 */
export type Matrix2D = [number, number, number, number, number, number];

export const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0];

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function translationMatrix(tx: number, ty: number): Matrix2D {
  return [1, 0, 0, 1, tx, ty];
}

export function scaleMatrix(sx: number, sy: number): Matrix2D {
  return [sx, 0, 0, sy, 0, 0];
}

export function rotationMatrix(angleDeg: number): Matrix2D {
  const rad = degToRad(angleDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [cos, sin, -sin, cos, 0, 0];
}

export function multiplyMatrices(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  const [a1, b1, c1, d1, tx1, ty1] = m1;
  const [a2, b2, c2, d2, tx2, ty2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * tx2 + c1 * ty2 + tx1,
    b1 * tx2 + d1 * ty2 + ty1,
  ];
}

export function invertMatrix(m: Matrix2D): Matrix2D {
  const [a, b, c, d, tx, ty] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-10) {
    return [...IDENTITY_MATRIX];
  }
  const invDet = 1 / det;
  return [
    d * invDet,
    -b * invDet,
    -c * invDet,
    a * invDet,
    (c * ty - d * tx) * invDet,
    (b * tx - a * ty) * invDet,
  ];
}

export function applyMatrixToPoint(m: Matrix2D, p: Point): Point {
  const [a, b, c, d, tx, ty] = m;
  return {
    x: a * p.x + c * p.y + tx,
    y: b * p.x + d * p.y + ty,
  };
}

/**
 * Builds a node's local-to-parent matrix.
 * Rotation is applied around the node's local center (width/2, height/2).
 */
export function createNodeLocalMatrix(
  x: number,
  y: number,
  width: number,
  height: number,
  rotationDeg: number
): Matrix2D {
  if (rotationDeg === 0) {
    return translationMatrix(x, y);
  }
  const cx = width / 2;
  const cy = height / 2;
  const m1 = translationMatrix(x + cx, y + cy);
  const m2 = rotationMatrix(rotationDeg);
  const m3 = translationMatrix(-cx, -cy);
  return multiplyMatrices(multiplyMatrices(m1, m2), m3);
}

/**
 * Extracts total rotation angle in degrees from a 2D affine matrix.
 */
export function getMatrixRotationDeg(m: Matrix2D): number {
  return radToDeg(Math.atan2(m[1], m[0]));
}

