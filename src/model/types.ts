import { Point } from '../math/matrix';

export type NodeType =
  | 'frame'
  | 'group'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'text'
  | 'path';

export interface NodeTransform {
  x: number;
  y: number;
  rotation: number; // degrees
}

export interface FillStyle {
  color: string;
  enabled: boolean;
}

export interface StrokeStyle {
  color: string;
  width: number;
  enabled: boolean;
}

export interface ShadowStyle {
  enabled: boolean;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

export type HorizontalConstraint = 'left' | 'right' | 'center' | 'left-right' | 'scale';
export type VerticalConstraint = 'top' | 'bottom' | 'center' | 'top-bottom' | 'scale';

export interface Constraints {
  horizontal: HorizontalConstraint;
  vertical: VerticalConstraint;
}

export interface BaseNode {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null; // null = direct child of Page
  transform: NodeTransform;
  width: number;
  height: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  constraints: Constraints;
}

export interface FrameNode extends BaseNode {
  type: 'frame';
  fill: FillStyle;
  stroke: StrokeStyle;
  cornerRadius: number;
  shadow: ShadowStyle;
  clipContent: boolean;
  children: string[];
}

export interface GroupNode extends BaseNode {
  type: 'group';
  children: string[];
}

export interface RectNode extends BaseNode {
  type: 'rect';
  fill: FillStyle;
  stroke: StrokeStyle;
  cornerRadius: number;
  shadow: ShadowStyle;
}

export interface EllipseNode extends BaseNode {
  type: 'ellipse';
  fill: FillStyle;
  stroke: StrokeStyle;
  shadow: ShadowStyle;
}

export interface LineNode extends BaseNode {
  type: 'line';
  p1: Point; // in local space (0..width, 0..height)
  p2: Point;
  stroke: StrokeStyle;
  shadow: ShadowStyle;
}

export interface TextNode extends BaseNode {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  textAlign: 'left' | 'center' | 'right';
  fill: FillStyle;
  shadow: ShadowStyle;
}

export interface PathAnchor {
  x: number;
  y: number;
  handleIn?: Point; // absolute in local space
  handleOut?: Point; // absolute in local space
}

export interface PathNode extends BaseNode {
  type: 'path';
  anchors: PathAnchor[];
  closed: boolean;
  fill: FillStyle;
  stroke: StrokeStyle;
  shadow: ShadowStyle;
}

export type SceneNode =
  | FrameNode
  | GroupNode
  | RectNode
  | EllipseNode
  | LineNode
  | TextNode
  | PathNode;

export type ContainerNode = FrameNode | GroupNode;

export interface PageNode {
  id: string;
  type: 'page';
  name: string;
  backgroundColor: string;
  children: string[]; // root node IDs in z-order (bottom to top)
  nodes: Record<string, SceneNode>;
}

export interface DocumentModel {
  version: number;
  id: string;
  name: string;
  pages: PageNode[];
  activePageId: string;
}

export type ToolType =
  | 'select'
  | 'frame'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'text'
  | 'pen';

