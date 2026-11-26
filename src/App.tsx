import React, { useCallback, useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { CanvasStage } from './components/CanvasStage';
import { LayersPanel } from './components/LayersPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Toolbar } from './components/Toolbar';
import { exportToPNG, exportToSVG } from './export/exporter';
import { AddNodesCommand, Command } from './history/commands';
import { HistoryManager } from './history/historyManager';
import { Viewport } from './math/geometry';
import {
  collectSubtreeIds,
  createEmptyDocument,
  getActivePage,
  updateActivePage,
} from './model/document';
import { DocumentModel, PageNode, SceneNode, ToolType } from './model/types';
import {
  cloneSubtreesForPaste,
  createStressTestNodes,
  deleteNodesInPage,
  groupSelectedNodes,
  reorderLayer,
  ungroupNode,
  validateImportedDocument,
} from './state/documentOps';

const STORAGE_KEY = 'mini-figma-doc-v1';

interface ClipboardData {
  rootIds: string[];
  nodes: Record<string, SceneNode>;
}

function loadInitialDocument(): DocumentModel {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = validateImportedDocument(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch {
    // ignore corrupted localStorage
  }
  return createEmptyDocument();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const App: React.FC = () => {
  const [doc, setDoc] = useState<DocumentModel>(loadInitialDocument);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [viewport, setViewport] = useState<Viewport>({
    panX: 80,
    panY: 60,
    zoom: 1,
  });
  const [, setHistoryTick] = useState(0);

  const historyRef = useRef(new HistoryManager(100));
  const clipboardRef = useRef<ClipboardData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const page = getActivePage(doc);

  // Persist document to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    } catch {
      // ignore quota errors
    }
  }, [doc]);

  const commitCommand = useCallback((cmd: Command) => {
    setDoc((prev) => historyRef.current.execute(cmd, prev));
    setHistoryTick((t) => t + 1);
  }, []);

  const pushExecutedCommand = useCallback((cmd: Command) => {
    historyRef.current.pushExecuted(cmd);
    setHistoryTick((t) => t + 1);
  }, []);

  const handleLivePageChange = useCallback((updater: (p: PageNode) => PageNode) => {
    setDoc((prev) => updateActivePage(prev, updater));
  }, []);

  const handleUndo = useCallback(() => {
    setDoc((prev) => {
      const next = historyRef.current.undo(prev);
      if (!next) return prev;
      setHistoryTick((t) => t + 1);
      return next;
    });
  }, []);

  const handleRedo = useCallback(() => {
    setDoc((prev) => {
      const next = historyRef.current.redo(prev);
      if (!next) return prev;
      setHistoryTick((t) => t + 1);
      return next;
    });
  }, []);

  const handleDelete = useCallback(() => {
    if (selectedIds.length === 0) return;
    const { command } = deleteNodesInPage(page, selectedIds);
    if (command) {
      commitCommand(command);
      setSelectedIds([]);
    }
  }, [page, selectedIds, commitCommand]);

  const handleDuplicate = useCallback(() => {
    if (selectedIds.length === 0) return;
    const parentId = page.nodes[selectedIds[0]]?.parentId ?? null;
    const { clonedNodes, newRootIds } = cloneSubtreesForPaste(
      page.nodes,
      selectedIds,
      20,
      20,
      parentId
    );
    if (clonedNodes.length > 0) {
      commitCommand(new AddNodesCommand('Duplicate', clonedNodes, parentId));
      setSelectedIds(newRootIds);
    }
  }, [page, selectedIds, commitCommand]);

  const handleCopy = useCallback(() => {
    if (selectedIds.length === 0) return;
    const nodes: Record<string, SceneNode> = {};
    for (const rid of selectedIds) {
      for (const sid of collectSubtreeIds(page, rid)) {
        if (page.nodes[sid]) nodes[sid] = structuredClone(page.nodes[sid]);
      }
    }
    clipboardRef.current = { rootIds: [...selectedIds], nodes };
  }, [page, selectedIds]);

  const handleCut = useCallback(() => {
    if (selectedIds.length === 0) return;
    handleCopy();
    handleDelete();
  }, [selectedIds, handleCopy, handleDelete]);

  const handlePaste = useCallback(
    (inPlace: boolean) => {
      const clip = clipboardRef.current;
      if (!clip || clip.rootIds.length === 0) return;
      const offset = inPlace ? 0 : 20;
      const { clonedNodes, newRootIds } = cloneSubtreesForPaste(
        clip.nodes,
        clip.rootIds,
        offset,
        offset,
        null
      );
      if (clonedNodes.length > 0) {
        commitCommand(
          new AddNodesCommand(inPlace ? 'Paste in Place' : 'Paste', clonedNodes, null)
        );
        setSelectedIds(newRootIds);
      }
    },
    [commitCommand]
  );

  const handleGroup = useCallback(() => {
    const res = groupSelectedNodes(page, selectedIds);
    if (res) {
      commitCommand(res.command);
      setSelectedIds([res.groupId]);
    }
  }, [page, selectedIds, commitCommand]);

  const handleUngroup = useCallback(() => {
    if (selectedIds.length !== 1) return;
    const res = ungroupNode(page, selectedIds[0]);
    if (res) {
      commitCommand(res.command);
      setSelectedIds(res.childIds);
    }
  }, [page, selectedIds, commitCommand]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleDuplicate();
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleCopy();
        return;
      }
      if (mod && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        handleCut();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handlePaste(e.shiftKey);
        return;
      }
      if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) handleUngroup();
        else handleGroup();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds(page.children.filter((id) => !page.nodes[id]?.locked));
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        handleDelete();
        return;
      }

      if (!mod) {
        switch (e.key.toLowerCase()) {
          case 'v':
            setActiveTool('select');
            break;
          case 'f':
            setActiveTool('frame');
            break;
          case 'r':
            setActiveTool('rect');
            break;
          case 'o':
            setActiveTool('ellipse');
            break;
          case 'l':
            setActiveTool('line');
            break;
          case 't':
            setActiveTool('text');
            break;
          case 'p':
            setActiveTool('pen');
            break;
          case 'escape':
            setActiveTool('select');
            setSelectedIds([]);
            break;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    page,
    handleUndo,
    handleRedo,
    handleDelete,
    handleDuplicate,
    handleCopy,
    handleCut,
    handlePaste,
    handleGroup,
    handleUngroup,
  ]);

  const handleExportJSON = () => {
    const json = JSON.stringify(doc, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, `${doc.name || 'design'}.json`);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const valid = validateImportedDocument(parsed);
        if (valid) {
          historyRef.current.clear();
          setDoc(valid);
          setSelectedIds([]);
          setHistoryTick((t) => t + 1);
        } else {
          alert('Invalid Mini Figma JSON file.');
        }
      } catch {
        alert('Could not parse JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExportSVG = () => {
    const svg = exportToSVG(page, selectedIds);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    downloadBlob(blob, `${doc.name || 'export'}.svg`);
  };

  const handleExportPNG = async () => {
    const blob = await exportToPNG(page, selectedIds, 2);
    downloadBlob(blob, `${doc.name || 'export'}@2x.png`);
  };

  const handleStressTest = () => {
    const nodes = createStressTestNodes(500);
    commitCommand(new AddNodesCommand('Add 500 Stress Shapes', nodes, null));
  };

  const handleAddPage = () => {
    const newPage: PageNode = {
      id: nanoid(8),
      type: 'page',
      name: `Page ${doc.pages.length + 1}`,
      backgroundColor: '#f1f5f9',
      children: [],
      nodes: {},
    };
    historyRef.current.clear();
    setDoc((prev) => ({
      ...prev,
      pages: [...prev.pages, newPage],
      activePageId: newPage.id,
    }));
    setSelectedIds([]);
  };

  return (
    <div className="editor-root">
      <Toolbar
        docName={doc.name}
        onDocNameChange={(name) => setDoc((d) => ({ ...d, name }))}
        activeTool={activeTool}
        onToolChange={setActiveTool}
        zoom={viewport.zoom}
        onZoomIn={() =>
          setViewport((v) => ({ ...v, zoom: Math.min(16, v.zoom * 1.25) }))
        }
        onZoomOut={() =>
          setViewport((v) => ({ ...v, zoom: Math.max(0.05, v.zoom / 1.25) }))
        }
        onZoomReset={() => setViewport({ panX: 80, panY: 60, zoom: 1 })}
        canUndo={historyRef.current.canUndo}
        canRedo={historyRef.current.canRedo}
        undoLabel={historyRef.current.undoLabel}
        redoLabel={historyRef.current.redoLabel}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onExportJSON={handleExportJSON}
        onImportJSON={() => fileInputRef.current?.click()}
        onExportPNG={handleExportPNG}
        onExportSVG={handleExportSVG}
        onStressTest={handleStressTest}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      <main className="editor-workspace">
        <LayersPanel
          doc={doc}
          page={page}
          selectedIds={selectedIds}
          onSelect={setSelectedIds}
          onCommitCommand={commitCommand}
          onReorder={(draggedId, targetId, pos) => {
            const cmd = reorderLayer(page, draggedId, targetId, pos);
            if (cmd) commitCommand(cmd);
          }}
          onGroup={handleGroup}
          onUngroup={handleUngroup}
          onSwitchPage={(pageId) => {
            setDoc((d) => ({ ...d, activePageId: pageId }));
            setSelectedIds([]);
          }}
          onAddPage={handleAddPage}
        />

        <CanvasStage
          doc={doc}
          page={page}
          activeTool={activeTool}
          selectedIds={selectedIds}
          viewport={viewport}
          onViewportChange={setViewport}
          onSelect={setSelectedIds}
          onToolChange={setActiveTool}
          onLivePageChange={handleLivePageChange}
          onCommitCommand={commitCommand}
          onPushExecutedCommand={pushExecutedCommand}
        />

        <PropertiesPanel
          page={page}
          selectedIds={selectedIds}
          onLivePageChange={handleLivePageChange}
          onCommitCommand={commitCommand}
          onPushExecutedCommand={pushExecutedCommand}
        />
      </main>
    </div>
  );
};

export default App;

