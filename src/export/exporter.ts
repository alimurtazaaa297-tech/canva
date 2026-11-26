import { createNodeLocalMatrix } from '../math/matrix';
import { mergeRects, Rect } from '../math/geometry';
import { getNodeWorldAABB } from '../model/document';
import { PageNode, PathNode, SceneNode, ShadowStyle } from '../model/types';
import { renderCanvas } from '../render/canvasRenderer';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pathToSvgD(node: PathNode): string {
  const { anchors, closed } = node;
  if (anchors.length === 0) return '';
  const parts: string[] = [`M ${anchors[0].x.toFixed(2)} ${anchors[0].y.toFixed(2)}`];
  const segCount = closed ? anchors.length : anchors.length - 1;
  for (let i = 0; i < segCount; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % anchors.length];
    const cp1 = a.handleOut ?? { x: a.x, y: a.y };
    const cp2 = b.handleIn ?? { x: b.x, y: b.y };
    parts.push(
      `C ${cp1.x.toFixed(2)} ${cp1.y.toFixed(2)}, ${cp2.x.toFixed(2)} ${cp2.y.toFixed(2)}, ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
    );
  }
  if (closed) parts.push('Z');
  return parts.join(' ');
}

function getTargetBounds(page: PageNode, targetIds: string[]): Rect {
  const ids = targetIds.length > 0 ? targetIds : page.children;
  const rects = ids
    .filter((id) => page.nodes[id])
    .map((id) => getNodeWorldAABB(page, id));
  if (rects.length === 0) {
    return { x: 0, y: 0, width: 800, height: 600 };
  }
  const merged = mergeRects(rects);
  return {
    x: merged.x,
    y: merged.y,
    width: Math.max(1, merged.width),
    height: Math.max(1, merged.height),
  };
}

export function exportToSVG(page: PageNode, targetIds: string[]): string {
  const bounds = getTargetBounds(page, targetIds);
  const rootIds = targetIds.length > 0 ? targetIds : page.children;
  const defs: string[] = [];
  let filterIdx = 0;

  const maybeShadowAttr = (shadow?: ShadowStyle): string => {
    if (!shadow || !shadow.enabled) return '';
    const fid = `shadow-${filterIdx++}`;
    defs.push(
      `<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%">` +
        `<feDropShadow dx="${shadow.offsetX}" dy="${shadow.offsetY}" stdDeviation="${shadow.blur / 2}" flood-color="${escapeXml(shadow.color)}" />` +
      `</filter>`
    );
    return ` filter="url(#${fid})"`;
  };

  const renderSvgNode = (nodeId: string): string => {
    const node: SceneNode | undefined = page.nodes[nodeId];
    if (!node || !node.visible) return '';

    const m = createNodeLocalMatrix(
      node.transform.x,
      node.transform.y,
      node.width,
      node.height,
      node.transform.rotation
    );
    const transformAttr = `matrix(${m.map((v) => v.toFixed(4)).join(' ')})`;
    const opacityAttr = node.opacity < 1 ? ` opacity="${node.opacity.toFixed(3)}"` : '';

    switch (node.type) {
      case 'group': {
        const inner = node.children.map(renderSvgNode).join('\n');
        return `<g transform="${transformAttr}"${opacityAttr}>\n${inner}\n</g>`;
      }
      case 'frame': {
        const fill = node.fill.enabled ? node.fill.color : 'none';
        const stroke = node.stroke.enabled ? node.stroke.color : 'none';
        const sw = node.stroke.enabled ? node.stroke.width : 0;
        const clipId = `clip-${node.id}`;
        if (node.clipContent) {
          defs.push(
            `<clipPath id="${clipId}"><rect width="${node.width}" height="${node.height}" rx="${node.cornerRadius}" ry="${node.cornerRadius}" /></clipPath>`
          );
        }
        const childrenSvg = node.children.map(renderSvgNode).join('\n');
        const shadowAttr = maybeShadowAttr(node.shadow);
        return (
          `<g transform="${transformAttr}"${opacityAttr}${shadowAttr}>\n` +
          `  <rect width="${node.width}" height="${node.height}" rx="${node.cornerRadius}" ry="${node.cornerRadius}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${sw}" />\n` +
          `  <g${node.clipContent ? ` clip-path="url(#${clipId})"` : ''}>\n${childrenSvg}\n  </g>\n` +
          `</g>`
        );
      }
      case 'rect': {
        const fill = node.fill.enabled ? node.fill.color : 'none';
        const stroke = node.stroke.enabled ? node.stroke.color : 'none';
        const sw = node.stroke.enabled ? node.stroke.width : 0;
        return `<rect transform="${transformAttr}"${opacityAttr}${maybeShadowAttr(node.shadow)} width="${node.width}" height="${node.height}" rx="${node.cornerRadius}" ry="${node.cornerRadius}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${sw}" />`;
      }
      case 'ellipse': {
        const fill = node.fill.enabled ? node.fill.color : 'none';
        const stroke = node.stroke.enabled ? node.stroke.color : 'none';
        const sw = node.stroke.enabled ? node.stroke.width : 0;
        return `<ellipse transform="${transformAttr}"${opacityAttr}${maybeShadowAttr(node.shadow)} cx="${node.width / 2}" cy="${node.height / 2}" rx="${node.width / 2}" ry="${node.height / 2}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${sw}" />`;
      }
      case 'line': {
        const stroke = node.stroke.enabled ? node.stroke.color : 'none';
        const sw = node.stroke.enabled ? node.stroke.width : 0;
        return `<line transform="${transformAttr}"${opacityAttr}${maybeShadowAttr(node.shadow)} x1="${node.p1.x}" y1="${node.p1.y}" x2="${node.p2.x}" y2="${node.p2.y}" stroke="${escapeXml(stroke)}" stroke-width="${sw}" stroke-linecap="round" />`;
      }
      case 'text': {
        const fill = node.fill.enabled ? node.fill.color : 'none';
        const lines = node.text.split('\n');
        const anchor =
          node.textAlign === 'center'
            ? 'middle'
            : node.textAlign === 'right'
            ? 'end'
            : 'start';
        const xOff =
          node.textAlign === 'center'
            ? node.width / 2
            : node.textAlign === 'right'
            ? node.width
            : 0;
        const tspans = lines
          .map(
            (line, i) =>
              `<tspan x="${xOff}" dy="${i === 0 ? node.fontSize : node.fontSize * 1.25}">${escapeXml(line)}</tspan>`
          )
          .join('');
        return `<text transform="${transformAttr}"${opacityAttr}${maybeShadowAttr(node.shadow)} fill="${escapeXml(fill)}" font-family="${escapeXml(node.fontFamily)}" font-size="${node.fontSize}" font-weight="${node.fontWeight}" text-anchor="${anchor}">${tspans}</text>`;
      }
      case 'path': {
        const fill = node.closed && node.fill.enabled ? node.fill.color : 'none';
        const stroke = node.stroke.enabled ? node.stroke.color : 'none';
        const sw = node.stroke.enabled ? node.stroke.width : 0;
        return `<path transform="${transformAttr}"${opacityAttr}${maybeShadowAttr(node.shadow)} d="${pathToSvgD(node)}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" />`;
      }
    }
  };

  const body = rootIds.map(renderSvgNode).filter(Boolean).join('\n  ');
  const defsBlock = defs.length > 0 ? `\n  <defs>\n    ${defs.join('\n    ')}\n  </defs>` : '';

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(bounds.width)}" height="${Math.ceil(bounds.height)}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}">${defsBlock}\n  ${body}\n</svg>`
  );
}

export async function exportToPNG(
  page: PageNode,
  targetIds: string[],
  scale = 2
): Promise<Blob> {
  const bounds = getTargetBounds(page, targetIds);
  const w = Math.max(1, Math.ceil(bounds.width));
  const h = Math.max(1, Math.ceil(bounds.height));

  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create 2D context for PNG export');

  const exportPage: PageNode =
    targetIds.length > 0
      ? {
          ...page,
          backgroundColor: 'transparent',
          children: targetIds.filter((id) => page.nodes[id]),
        }
      : page;

  renderCanvas(
    ctx,
    w,
    h,
    scale,
    exportPage,
    { panX: -bounds.x, panY: -bounds.y, zoom: 1 },
    {
      selectedIds: [],
      hoveredId: null,
      marqueeRect: null,
      snapGuides: [],
      penDraft: null,
      editingPathId: null,
      selectedAnchorIndex: null,
    }
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG export failed'));
    }, 'image/png');
  });
}

