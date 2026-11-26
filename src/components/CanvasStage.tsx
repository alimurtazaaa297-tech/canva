import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyMatrixToPoint,
  invertMatrix,
  Point,
} from '../math/matrix';
import {
  distance,
  Rect,
  screenToWorld,
  Viewport,
  worldToScreen,
} from '../math/geometry';
import { computeSmartGuides, SnapGuide } from '../math/snapping';
import {
  moveNodesByWorldDelta,
  resizeMultiSelection,
  resizeSingleNode,
  rotateSingleNode,
} from '../math/transform';
import {
  createEllipseNode,
  createFrameNode,
  createLineNode,
  createPathNode,
  createRectNode,
  createTextNode,
  getNodeWorldAABB,
  getNodeWorldMatrix,
  getSelectionWorldAABB,
} from '../model/document';
import {
  DocumentModel,
  PageNode,
  PathAnchor,
  PathNode,
  SceneNode,
  TextNode,
  ToolType,
} from '../model/types';
import {
  AddNodesCommand,
  Command,
  UpdateNodesCommand,
} from '../history/commands';
import { renderCanvas, RenderOverlayState } from '../render/canvasRenderer';
import {
  findFrameAtPoint,
  HandleKind,
  hitTestPage,
  hitTestSelectionHandles,
  marqueeSelectPage,
} from '../render/hitTest';

interface CanvasStageProps {
  doc: DocumentModel;
  page: PageNode;
  activeTool: ToolType;
  selectedIds: string[];
  viewport: Viewport;
  onViewportChange: (vp: Viewport) => void;
  onSelect: (ids: string[]) => void;
  onToolChange: (tool: ToolType) => void;
  onLivePageChange: (updater: (page: PageNode) => PageNode) => void;
  onCommitCommand: (cmd: Command) => void;
  onPushExecutedCommand: (cmd: Command) => void;
}

type InteractionState =
  | { kind: 'idle' }
  | { kind: 'pan'; startScreen: Point; startPan: Point }
  | { kind: 'marquee'; startWorld: Point }
  | {
      kind: 'move';
      startWorld: Point;
      initialPage: PageNode;
      movingIds: string[];
      initialAABB: Rect;
      otherRects: Rect[];
      lastUpdates: Record<string, SceneNode>;
    }
  | {
      kind: 'resize';
      handle: HandleKind;
      initialPage: PageNode;
      initialAABB: Rect | null;
      lastUpdates: Record<string, SceneNode>;
    }
  | {
      kind: 'rotate';
      startWorld: Point;
      initialPage: PageNode;
      lastUpdates: Record<string, SceneNode>;
    }
  | {
      kind: 'draw';
      tool: Exclude<ToolType, 'select' | 'pen' | 'text'>;
      startWorld: Point;
      nodeId: string;
      initialPage: PageNode;
      parentId: string | null;
      lastNode: SceneNode;
    }
  | {
      kind: 'pen-drag-handle';
      anchorIndex: number;
    }
  | {
      kind: 'edit-path-handle';
      nodeId: string;
      anchorIndex: number;
      part: 'anchor' | 'in' | 'out';
      initialNode: PathNode;
      lastNode: PathNode;
    };

export const CanvasStage: React.FC<CanvasStageProps> = ({
  doc,
  page,
  activeTool,
  selectedIds,
  viewport,
  onViewportChange,
  onSelect,
  onToolChange,
  onLivePageChange,
  onCommitCommand,
  onPushExecutedCommand,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [spacePressed, setSpacePressed] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [cursorStyle, setCursorStyle] = useState('default');

  const interactionRef = useRef<InteractionState>({ kind: 'idle' });
  const overlayRef = useRef<RenderOverlayState>({
    selectedIds,
    hoveredId: null,
    marqueeRect: null,
    snapGuides: [],
    penDraft: null,
    editingPathId: null,
    selectedAnchorIndex: null,
  });

  // Keep overlay.selectedIds synced with prop
  overlayRef.current.selectedIds = selectedIds;
  if (
    overlayRef.current.editingPathId &&
    !selectedIds.includes(overlayRef.current.editingPathId)
  ) {
    overlayRef.current.editingPathId = null;
    overlayRef.current.selectedAnchorIndex = null;
  }

  const rafRef = useRef<number | null>(null);

  const drawNow = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.max(1, Math.floor(rect.width * dpr));
    const targetH = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    renderCanvas(ctx, rect.width, rect.height, dpr, page, viewport, overlayRef.current);
  }, [page, viewport]);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      drawNow();
    });
  }, [drawNow]);

  useEffect(() => {
    scheduleDraw();
  }, [doc, page, viewport, selectedIds, scheduleDraw]);

  useEffect(() => {
    const onResize = () => scheduleDraw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [scheduleDraw]);

  const getPointerScreen = (e: React.PointerEvent | WheelEvent): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Finish pen draft helper
  const finishPenDraft = useCallback(
    (closed: boolean) => {
      const draft = overlayRef.current.penDraft;
      overlayRef.current.penDraft = null;
      if (!draft || draft.anchors.length < 2) {
        scheduleDraw();
        return;
      }
      const pathNode = createPathNode(draft.anchors, closed, null);
      onCommitCommand(new AddNodesCommand('Draw Path', [pathNode], null));
      onSelect([pathNode.id]);
      onToolChange('select');
      scheduleDraw();
    },
    [onCommitCommand, onSelect, onToolChange, scheduleDraw]
  );

  // Spacebar pan + Enter/Escape for pen & path edit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setSpacePressed(true);
      } else if (e.key === 'Enter' && overlayRef.current.penDraft) {
        e.preventDefault();
        finishPenDraft(false);
      } else if (e.key === 'Escape') {
        if (overlayRef.current.penDraft) {
          overlayRef.current.penDraft = null;
          scheduleDraw();
        } else if (overlayRef.current.editingPathId) {
          overlayRef.current.editingPathId = null;
          overlayRef.current.selectedAnchorIndex = null;
          scheduleDraw();
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [finishPenDraft, scheduleDraw]);

  // Wheel zoom (Ctrl + scroll) & pan
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * 0.002);
        const nextZoom = Math.min(16, Math.max(0.05, viewport.zoom * factor));
        const worldX = (sx - viewport.panX) / viewport.zoom;
        const worldY = (sy - viewport.panY) / viewport.zoom;
        onViewportChange({
          zoom: nextZoom,
          panX: sx - worldX * nextZoom,
          panY: sy - worldY * nextZoom,
        });
      } else {
        onViewportChange({
          ...viewport,
          panX: viewport.panX - e.deltaX,
          panY: viewport.panY - e.deltaY,
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewport, onViewportChange]);

  const commitTextEdit = () => {
    if (!editingTextId) return;
    const node = page.nodes[editingTextId];
    if (node && node.type === 'text' && textDraft !== node.text) {
      const updated: TextNode = {
        ...node,
        text: textDraft,
        height: Math.max(
          node.fontSize * 1.4,
          textDraft.split('\n').length * node.fontSize * 1.25 + 8
        ),
      };
      onCommitCommand(
        new UpdateNodesCommand('Edit Text', { [node.id]: node }, { [node.id]: updated })
      );
    }
    setEditingTextId(null);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (editingTextId) {
      commitTextEdit();
    }

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const screenPt = getPointerScreen(e);
    const worldPt = screenToWorld(screenPt, viewport);

    // Pan with Space + drag or Middle mouse
    if (spacePressed || e.button === 1) {
      interactionRef.current = {
        kind: 'pan',
        startScreen: screenPt,
        startPan: { x: viewport.panX, y: viewport.panY },
      };
      setCursorStyle('grabbing');
      return;
    }

    if (e.button !== 0) return;

    // Pen tool
    if (activeTool === 'pen') {
      const draft = overlayRef.current.penDraft ?? { anchors: [], previewPoint: null };
      // Check if clicking first anchor to close path
      if (
        draft.anchors.length >= 3 &&
        distance(worldPt, draft.anchors[0]) <= 10 / viewport.zoom
      ) {
        finishPenDraft(true);
        return;
      }
      const newAnchors: PathAnchor[] = [
        ...draft.anchors,
        { x: worldPt.x, y: worldPt.y },
      ];
      overlayRef.current.penDraft = {
        anchors: newAnchors,
        previewPoint: worldPt,
      };
      interactionRef.current = {
        kind: 'pen-drag-handle',
        anchorIndex: newAnchors.length - 1,
      };
      scheduleDraw();
      return;
    }

    // Text tool
    if (activeTool === 'text') {
      const parentId = findFrameAtPoint(page, worldPt);
      let localX = worldPt.x;
      let localY = worldPt.y;
      if (parentId) {
        const localPt = applyMatrixToPoint(
          invertMatrix(getNodeWorldMatrix(page, parentId)),
          worldPt
        );
        localX = localPt.x;
        localY = localPt.y;
      }
      const textNode = createTextNode(localX, localY, 'Type here', parentId);
      onCommitCommand(new AddNodesCommand('Add Text', [textNode], parentId));
      onSelect([textNode.id]);
      onToolChange('select');
      setEditingTextId(textNode.id);
      setTextDraft(textNode.text);
      return;
    }

    // Shape drawing tools
    if (
      activeTool === 'rect' ||
      activeTool === 'ellipse' ||
      activeTool === 'frame' ||
      activeTool === 'line'
    ) {
      const parentId =
        activeTool === 'frame' ? null : findFrameAtPoint(page, worldPt);
      let localPt = worldPt;
      if (parentId) {
        localPt = applyMatrixToPoint(
          invertMatrix(getNodeWorldMatrix(page, parentId)),
          worldPt
        );
      }

      let newNode: SceneNode;
      if (activeTool === 'rect') {
        newNode = createRectNode(localPt.x, localPt.y, 1, 1, parentId);
      } else if (activeTool === 'ellipse') {
        newNode = createEllipseNode(localPt.x, localPt.y, 1, 1, parentId);
      } else if (activeTool === 'frame') {
        newNode = createFrameNode(localPt.x, localPt.y, 1, 1, null);
      } else {
        newNode = createLineNode(localPt.x, localPt.y, localPt.x + 1, localPt.y + 1, parentId);
      }

      const initialPage = page;
      onLivePageChange((p) => {
        const nextNodes = { ...p.nodes, [newNode.id]: newNode };
        if (parentId === null) {
          return { ...p, children: [...p.children, newNode.id], nodes: nextNodes };
        }
        const parent = nextNodes[parentId];
        if (parent && (parent.type === 'frame' || parent.type === 'group')) {
          nextNodes[parentId] = {
            ...parent,
            children: [...parent.children, newNode.id],
          };
        }
        return { ...p, nodes: nextNodes };
      });

      interactionRef.current = {
        kind: 'draw',
        tool: activeTool,
        startWorld: worldPt,
        nodeId: newNode.id,
        initialPage,
        parentId,
        lastNode: newNode,
      };
      onSelect([newNode.id]);
      return;
    }

    // Select tool: 1) Check path anchor editing if active
    if (overlayRef.current.editingPathId) {
      const pathNode = page.nodes[overlayRef.current.editingPathId];
      if (pathNode && pathNode.type === 'path') {
        const localPt = applyMatrixToPoint(
          invertMatrix(getNodeWorldMatrix(page, pathNode.id)),
          worldPt
        );
        const tol = 8 / viewport.zoom;
        for (let i = 0; i < pathNode.anchors.length; i++) {
          const a = pathNode.anchors[i];
          if (a.handleIn && distance(localPt, a.handleIn) <= tol) {
            overlayRef.current.selectedAnchorIndex = i;
            interactionRef.current = {
              kind: 'edit-path-handle',
              nodeId: pathNode.id,
              anchorIndex: i,
              part: 'in',
              initialNode: pathNode,
              lastNode: pathNode,
            };
            scheduleDraw();
            return;
          }
          if (a.handleOut && distance(localPt, a.handleOut) <= tol) {
            overlayRef.current.selectedAnchorIndex = i;
            interactionRef.current = {
              kind: 'edit-path-handle',
              nodeId: pathNode.id,
              anchorIndex: i,
              part: 'out',
              initialNode: pathNode,
              lastNode: pathNode,
            };
            scheduleDraw();
            return;
          }
          if (distance(localPt, a) <= tol) {
            overlayRef.current.selectedAnchorIndex = i;
            interactionRef.current = {
              kind: 'edit-path-handle',
              nodeId: pathNode.id,
              anchorIndex: i,
              part: 'anchor',
              initialNode: pathNode,
              lastNode: pathNode,
            };
            scheduleDraw();
            return;
          }
        }
      }
      overlayRef.current.editingPathId = null;
      overlayRef.current.selectedAnchorIndex = null;
    }

    // Select tool: 2) Check transform handles
    const handleHit = hitTestSelectionHandles(page, selectedIds, worldPt, viewport.zoom);
    if (handleHit) {
      if (handleHit.kind === 'rotate') {
        interactionRef.current = {
          kind: 'rotate',
          startWorld: worldPt,
          initialPage: page,
          lastUpdates: {},
        };
        return;
      }
      interactionRef.current = {
        kind: 'resize',
        handle: handleHit.kind,
        initialPage: page,
        initialAABB:
          selectedIds.length > 1 ? getSelectionWorldAABB(page, selectedIds) : null,
        lastUpdates: {},
      };
      return;
    }

    // Select tool: 3) Hit-test shapes
    const hitId = hitTestPage(page, worldPt, viewport.zoom, {
      deepSelect: e.ctrlKey || e.metaKey,
    });

    if (hitId) {
      let nextSelection = selectedIds;
      if (e.shiftKey) {
        if (selectedIds.includes(hitId)) {
          nextSelection = selectedIds.filter((id) => id !== hitId);
        } else {
          nextSelection = [...selectedIds, hitId];
        }
        onSelect(nextSelection);
      } else if (!selectedIds.includes(hitId)) {
        nextSelection = [hitId];
        onSelect(nextSelection);
      }

      if (nextSelection.length > 0 && nextSelection.includes(hitId)) {
        const movingSet = new Set(nextSelection);
        const otherRects: Rect[] = [];
        for (const rootId of page.children) {
          if (movingSet.has(rootId)) continue;
          const n = page.nodes[rootId];
          if (n && n.visible) {
            otherRects.push(getNodeWorldAABB(page, rootId));
          }
        }
        const initialAABB = getSelectionWorldAABB(page, nextSelection) ?? {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        };
        interactionRef.current = {
          kind: 'move',
          startWorld: worldPt,
          initialPage: page,
          movingIds: nextSelection,
          initialAABB,
          otherRects,
          lastUpdates: {},
        };
      }
      return;
    }

    // Select tool: 4) Empty space -> Marquee selection
    if (!e.shiftKey) {
      onSelect([]);
    }
    interactionRef.current = { kind: 'marquee', startWorld: worldPt };
    overlayRef.current.marqueeRect = { x: worldPt.x, y: worldPt.y, width: 0, height: 0 };
    scheduleDraw();
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const screenPt = getPointerScreen(e);
    const worldPt = screenToWorld(screenPt, viewport);
    const state = interactionRef.current;

    if (state.kind === 'pan') {
      onViewportChange({
        ...viewport,
        panX: state.startPan.x + (screenPt.x - state.startScreen.x),
        panY: state.startPan.y + (screenPt.y - state.startScreen.y),
      });
      return;
    }

    if (state.kind === 'pen-drag-handle') {
      const draft = overlayRef.current.penDraft;
      if (draft) {
        const anchor = draft.anchors[state.anchorIndex];
        const dx = worldPt.x - anchor.x;
        const dy = worldPt.y - anchor.y;
        if (Math.hypot(dx, dy) > 3 / viewport.zoom) {
          draft.anchors[state.anchorIndex] = {
            ...anchor,
            handleOut: { x: anchor.x + dx, y: anchor.y + dy },
            handleIn: { x: anchor.x - dx, y: anchor.y - dy },
          };
          scheduleDraw();
        }
      }
      return;
    }

    if (state.kind === 'edit-path-handle') {
      const localPt = applyMatrixToPoint(
        invertMatrix(getNodeWorldMatrix(page, state.nodeId)),
        worldPt
      );
      const nextAnchors = state.initialNode.anchors.map((a, idx) => {
        if (idx !== state.anchorIndex) return a;
        if (state.part === 'anchor') {
          const dx = localPt.x - a.x;
          const dy = localPt.y - a.y;
          return {
            x: localPt.x,
            y: localPt.y,
            handleIn: a.handleIn
              ? { x: a.handleIn.x + dx, y: a.handleIn.y + dy }
              : undefined,
            handleOut: a.handleOut
              ? { x: a.handleOut.x + dx, y: a.handleOut.y + dy }
              : undefined,
          };
        }
        if (state.part === 'in') {
          return { ...a, handleIn: localPt };
        }
        return { ...a, handleOut: localPt };
      });
      const updated: PathNode = { ...state.initialNode, anchors: nextAnchors };
      state.lastNode = updated;
      onLivePageChange((p) => ({
        ...p,
        nodes: { ...p.nodes, [state.nodeId]: updated },
      }));
      return;
    }

    if (state.kind === 'marquee') {
      const x = Math.min(state.startWorld.x, worldPt.x);
      const y = Math.min(state.startWorld.y, worldPt.y);
      const width = Math.abs(worldPt.x - state.startWorld.x);
      const height = Math.abs(worldPt.y - state.startWorld.y);
      overlayRef.current.marqueeRect = { x, y, width, height };
      scheduleDraw();
      return;
    }

    if (state.kind === 'move') {
      let dx = worldPt.x - state.startWorld.x;
      let dy = worldPt.y - state.startWorld.y;

      let guides: SnapGuide[] = [];
      if (!e.altKey) {
        const candidateAABB: Rect = {
          x: state.initialAABB.x + dx,
          y: state.initialAABB.y + dy,
          width: state.initialAABB.width,
          height: state.initialAABB.height,
        };
        const snap = computeSmartGuides(
          candidateAABB,
          state.otherRects,
          6 / viewport.zoom
        );
        dx += snap.dx;
        dy += snap.dy;
        guides = snap.guides;
      }

      overlayRef.current.snapGuides = guides;
      const updates = moveNodesByWorldDelta(state.initialPage, state.movingIds, dx, dy);
      state.lastUpdates = updates;
      onLivePageChange((p) => ({
        ...p,
        nodes: { ...p.nodes, ...updates },
      }));
      return;
    }

    if (state.kind === 'resize') {
      let updates: Record<string, SceneNode>;
      if (selectedIds.length === 1) {
        updates = resizeSingleNode(
          state.initialPage,
          selectedIds[0],
          state.handle,
          worldPt,
          { preserveAspectRatio: e.shiftKey }
        );
      } else if (state.initialAABB) {
        updates = resizeMultiSelection(
          state.initialPage,
          state.initialAABB,
          selectedIds,
          state.handle,
          worldPt
        );
      } else {
        updates = {};
      }
      state.lastUpdates = updates;
      onLivePageChange((p) => ({
        ...p,
        nodes: { ...p.nodes, ...updates },
      }));
      return;
    }

    if (state.kind === 'rotate' && selectedIds.length === 1) {
      const updates = rotateSingleNode(
        state.initialPage,
        selectedIds[0],
        worldPt,
        state.startWorld,
        e.shiftKey
      );
      state.lastUpdates = updates;
      onLivePageChange((p) => ({
        ...p,
        nodes: { ...p.nodes, ...updates },
      }));
      return;
    }

    if (state.kind === 'draw') {
      let p0 = state.startWorld;
      let p1 = worldPt;
      if (state.parentId) {
        const inv = invertMatrix(getNodeWorldMatrix(state.initialPage, state.parentId));
        p0 = applyMatrixToPoint(inv, p0);
        p1 = applyMatrixToPoint(inv, p1);
      }
      if (state.tool === 'line') {
        const minX = Math.min(p0.x, p1.x);
        const minY = Math.min(p0.y, p1.y);
        const w = Math.max(1, Math.abs(p1.x - p0.x));
        const h = Math.max(1, Math.abs(p1.y - p0.y));
        const base = state.lastNode;
        if (base.type === 'line') {
          const updated: SceneNode = {
            ...base,
            transform: { ...base.transform, x: minX, y: minY },
            width: w,
            height: h,
            p1: { x: p0.x - minX, y: p0.y - minY },
            p2: { x: p1.x - minX, y: p1.y - minY },
          };
          state.lastNode = updated;
          onLivePageChange((p) => ({
            ...p,
            nodes: { ...p.nodes, [updated.id]: updated },
          }));
        }
      } else {
        let w = Math.abs(p1.x - p0.x);
        let h = Math.abs(p1.y - p0.y);
        if (e.shiftKey) {
          const side = Math.max(w, h);
          w = side;
          h = side;
        }
        const x = p1.x < p0.x ? p0.x - w : p0.x;
        const y = p1.y < p0.y ? p0.y - h : p0.y;
        const updated: SceneNode = {
          ...state.lastNode,
          transform: { ...state.lastNode.transform, x, y },
          width: Math.max(1, w),
          height: Math.max(1, h),
        };
        state.lastNode = updated;
        onLivePageChange((p) => ({
          ...p,
          nodes: { ...p.nodes, [updated.id]: updated },
        }));
      }
      return;
    }

    // Idle hover state
    if (activeTool === 'pen' && overlayRef.current.penDraft) {
      overlayRef.current.penDraft.previewPoint = worldPt;
      scheduleDraw();
      return;
    }

    if (spacePressed) {
      setCursorStyle('grab');
      return;
    }

    if (activeTool !== 'select') {
      setCursorStyle('crosshair');
      return;
    }

    const handleHit = hitTestSelectionHandles(page, selectedIds, worldPt, viewport.zoom);
    if (handleHit) {
      const map: Record<HandleKind, string> = {
        nw: 'nwse-resize',
        se: 'nwse-resize',
        ne: 'nesw-resize',
        sw: 'nesw-resize',
        n: 'ns-resize',
        s: 'ns-resize',
        e: 'ew-resize',
        w: 'ew-resize',
        rotate: 'grab',
      };
      setCursorStyle(map[handleHit.kind]);
      return;
    }

    setCursorStyle('default');
    const hitId = hitTestPage(page, worldPt, viewport.zoom);
    if (overlayRef.current.hoveredId !== hitId) {
      overlayRef.current.hoveredId = hitId;
      scheduleDraw();
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const state = interactionRef.current;
    interactionRef.current = { kind: 'idle' };
    overlayRef.current.snapGuides = [];

    if (state.kind === 'pan') {
      setCursorStyle(spacePressed ? 'grab' : 'default');
    }

    if (state.kind === 'marquee') {
      const rect = overlayRef.current.marqueeRect;
      overlayRef.current.marqueeRect = null;
      if (rect && (rect.width > 2 || rect.height > 2)) {
        const hits = marqueeSelectPage(page, rect);
        if (e.shiftKey) {
          onSelect(Array.from(new Set([...selectedIds, ...hits])));
        } else {
          onSelect(hits);
        }
      }
      scheduleDraw();
      return;
    }

    if (
      state.kind === 'move' ||
      state.kind === 'resize' ||
      state.kind === 'rotate'
    ) {
      const changedIds = Object.keys(state.lastUpdates);
      if (changedIds.length > 0) {
        const before: Record<string, SceneNode> = {};
        for (const id of changedIds) {
          before[id] = state.initialPage.nodes[id];
        }
        const label =
          state.kind === 'move'
            ? 'Move Layers'
            : state.kind === 'resize'
            ? 'Resize Layers'
            : 'Rotate Layer';
        onPushExecutedCommand(new UpdateNodesCommand(label, before, state.lastUpdates));
      }
      scheduleDraw();
      return;
    }

    if (state.kind === 'edit-path-handle') {
      if (state.lastNode !== state.initialNode) {
        onPushExecutedCommand(
          new UpdateNodesCommand(
            'Edit Path Point',
            { [state.nodeId]: state.initialNode },
            { [state.nodeId]: state.lastNode }
          )
        );
      }
      scheduleDraw();
      return;
    }

    if (state.kind === 'draw') {
      let finalNode = state.lastNode;
      if (finalNode.width < 4 && finalNode.height < 4) {
        // Click-to-drop default size
        finalNode = {
          ...finalNode,
          width: finalNode.type === 'frame' ? 320 : 100,
          height: finalNode.type === 'frame' ? 240 : finalNode.type === 'line' ? 1 : 100,
        };
        if (finalNode.type === 'line') {
          finalNode = { ...finalNode, p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } };
        }
        onLivePageChange((p) => ({
          ...p,
          nodes: { ...p.nodes, [finalNode.id]: finalNode },
        }));
      }
      onPushExecutedCommand(
        new AddNodesCommand(`Add ${finalNode.type}`, [finalNode], state.parentId)
      );
      onToolChange('select');
      scheduleDraw();
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (activeTool === 'pen' && overlayRef.current.penDraft) {
      finishPenDraft(false);
      return;
    }
    if (activeTool !== 'select') return;

    const rect = containerRef.current!.getBoundingClientRect();
    const worldPt = screenToWorld(
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      viewport
    );
    const hitId = hitTestPage(page, worldPt, viewport.zoom, { deepSelect: true });
    if (!hitId) return;
    const node = page.nodes[hitId];
    if (!node) return;

    if (node.type === 'text') {
      onSelect([node.id]);
      setEditingTextId(node.id);
      setTextDraft(node.text);
    } else if (node.type === 'path') {
      onSelect([node.id]);
      overlayRef.current.editingPathId = node.id;
      overlayRef.current.selectedAnchorIndex = null;
      scheduleDraw();
    } else {
      onSelect([node.id]);
    }
  };

  // Compute screen position for inline text editor overlay
  const editingTextNode =
    editingTextId && page.nodes[editingTextId]?.type === 'text'
      ? (page.nodes[editingTextId] as TextNode)
      : null;

  let textEditorStyle: React.CSSProperties | undefined;
  if (editingTextNode) {
    const worldOrigin = applyMatrixToPoint(
      getNodeWorldMatrix(page, editingTextNode.id),
      { x: 0, y: 0 }
    );
    const screenOrigin = worldToScreen(worldOrigin, viewport);
    textEditorStyle = {
      position: 'absolute',
      left: screenOrigin.x,
      top: screenOrigin.y,
      minWidth: Math.max(120, editingTextNode.width * viewport.zoom),
      minHeight: Math.max(32, editingTextNode.height * viewport.zoom),
      fontSize: editingTextNode.fontSize * viewport.zoom,
      fontFamily: editingTextNode.fontFamily,
      fontWeight: editingTextNode.fontWeight,
      color: editingTextNode.fill.color,
      transform: `rotate(${editingTextNode.transform.rotation}deg)`,
      transformOrigin: 'top left',
    };
  }

  return (
    <div
      ref={containerRef}
      className="canvas-stage"
      style={{ cursor: cursorStyle }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    >
      <canvas ref={canvasRef} className="canvas-element" />

      {editingTextNode && textEditorStyle && (
        <textarea
          autoFocus
          className="inline-text-editor"
          style={textEditorStyle}
          value={textDraft}
          onChange={(e) => setTextDraft(e.target.value)}
          onBlur={commitTextEdit}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
              commitTextEdit();
            }
          }}
        />
      )}

      {overlayRef.current.penDraft && (
        <div className="canvas-hint-pill">
          Pen tool: Click to add point, drag for curves, click first point or press Enter to finish
        </div>
      )}
      {overlayRef.current.editingPathId && (
        <div className="canvas-hint-pill">
          Editing Path: Drag anchor points or Bezier handles, press Esc to exit
        </div>
      )}
    </div>
  );
};

