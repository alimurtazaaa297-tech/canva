import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Eye,
  EyeOff,
  Folder,
  Frame,
  Group,
  Lock,
  Minus,
  PenTool,
  Plus,
  Square,
  Type,
  Ungroup,
  Unlock,
} from 'lucide-react';
import { isContainerNode } from '../model/document';
import { DocumentModel, PageNode, SceneNode } from '../model/types';
import { Command, UpdateNodesCommand } from '../history/commands';

interface LayersPanelProps {
  doc: DocumentModel;
  page: PageNode;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onCommitCommand: (cmd: Command) => void;
  onReorder: (
    draggedId: string,
    targetId: string,
    position: 'before' | 'after' | 'inside'
  ) => void;
  onGroup: () => void;
  onUngroup: () => void;
  onSwitchPage: (pageId: string) => void;
  onAddPage: () => void;
}

function getNodeIcon(node: SceneNode): React.ReactNode {
  switch (node.type) {
    case 'frame':
      return <Frame size={13} />;
    case 'group':
      return <Folder size={13} />;
    case 'rect':
      return <Square size={13} />;
    case 'ellipse':
      return <Circle size={13} />;
    case 'line':
      return <Minus size={13} />;
    case 'text':
      return <Type size={13} />;
    case 'path':
      return <PenTool size={13} />;
  }
}

export const LayersPanel: React.FC<LayersPanelProps> = ({
  doc,
  page,
  selectedIds,
  onSelect,
  onCommitCommand,
  onReorder,
  onGroup,
  onUngroup,
  onSwitchPage,
  onAddPage,
}) => {
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    pos: 'before' | 'after' | 'inside';
  } | null>(null);

  const selectedSet = new Set(selectedIds);
  const canGroup = selectedIds.length >= 2;
  const canUngroup =
    selectedIds.length === 1 && page.nodes[selectedIds[0]]?.type === 'group';

  const toggleCollapse = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleVisible = (node: SceneNode, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = { ...node, visible: !node.visible };
    onCommitCommand(
      new UpdateNodesCommand(
        node.visible ? 'Hide Layer' : 'Show Layer',
        { [node.id]: node },
        { [node.id]: updated }
      )
    );
  };

  const toggleLocked = (node: SceneNode, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = { ...node, locked: !node.locked };
    onCommitCommand(
      new UpdateNodesCommand(
        node.locked ? 'Unlock Layer' : 'Lock Layer',
        { [node.id]: node },
        { [node.id]: updated }
      )
    );
  };

  const commitRename = (node: SceneNode) => {
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== node.name) {
      onCommitCommand(
        new UpdateNodesCommand(
          'Rename Layer',
          { [node.id]: node },
          { [node.id]: { ...node, name: trimmed } }
        )
      );
    }
    setRenamingId(null);
  };

  const renderTree = (ids: string[], depth: number): React.ReactNode => {
    // Render top-to-bottom (reverse z-order)
    const reversed = [...ids].reverse();
    return reversed.map((id) => {
      const node = page.nodes[id];
      if (!node) return null;
      const isContainer = isContainerNode(node);
      const isCollapsed = !!collapsedIds[id];
      const isSelected = selectedSet.has(id);
      const isDropHere = dropTarget?.id === id;

      return (
        <React.Fragment key={id}>
          <div
            className={`layer-row ${isSelected ? 'selected' : ''} ${
              !node.visible ? 'dimmed' : ''
            } ${isDropHere ? `drop-${dropTarget.pos}` : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            draggable={renamingId !== id}
            onDragStart={(e) => {
              e.stopPropagation();
              setDraggedId(id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!draggedId || draggedId === id) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const relY = e.clientY - rect.top;
              let pos: 'before' | 'after' | 'inside' = 'after';
              if (isContainer && relY > rect.height * 0.25 && relY < rect.height * 0.75) {
                pos = 'inside';
              } else if (relY < rect.height / 2) {
                pos = 'before';
              }
              setDropTarget({ id, pos });
            }}
            onDragLeave={() => {
              if (dropTarget?.id === id) setDropTarget(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (draggedId && dropTarget && draggedId !== dropTarget.id) {
                // Visual list is reversed z-order, so 'before' visually means 'after' in z-order array
                const zPos =
                  dropTarget.pos === 'inside'
                    ? 'inside'
                    : dropTarget.pos === 'before'
                    ? 'after'
                    : 'before';
                onReorder(draggedId, dropTarget.id, zPos);
              }
              setDraggedId(null);
              setDropTarget(null);
            }}
            onDragEnd={() => {
              setDraggedId(null);
              setDropTarget(null);
            }}
            onClick={(e) => {
              if (e.shiftKey) {
                if (selectedSet.has(id)) {
                  onSelect(selectedIds.filter((sid) => sid !== id));
                } else {
                  onSelect([...selectedIds, id]);
                }
              } else {
                onSelect([id]);
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenamingId(id);
              setRenameDraft(node.name);
            }}
            role="treeitem"
            aria-selected={isSelected}
          >
            <span className="layer-expand" onClick={(e) => isContainer && toggleCollapse(id, e)}>
              {isContainer ? (
                isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />
              ) : null}
            </span>

            <span className="layer-icon">{getNodeIcon(node)}</span>

            {renamingId === id ? (
              <input
                autoFocus
                className="layer-rename-input"
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => commitRename(node)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(node);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="layer-name">{node.name}</span>
            )}

            <div className="layer-actions">
              <button
                type="button"
                className="icon-btn-tiny"
                onClick={(e) => toggleLocked(node, e)}
                title={node.locked ? 'Unlock' : 'Lock'}
                aria-label={node.locked ? 'Unlock layer' : 'Lock layer'}
              >
                {node.locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
              <button
                type="button"
                className="icon-btn-tiny"
                onClick={(e) => toggleVisible(node, e)}
                title={node.visible ? 'Hide' : 'Show'}
                aria-label={node.visible ? 'Hide layer' : 'Show layer'}
              >
                {node.visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
            </div>
          </div>

          {isContainer && !isCollapsed && renderTree(node.children, depth + 1)}
        </React.Fragment>
      );
    });
  };

  return (
    <aside className="panel left-panel" aria-label="Layers Panel">
      <div className="panel-section">
        <div className="panel-header">
          <span>Pages</span>
          <button
            type="button"
            className="icon-btn-tiny"
            onClick={onAddPage}
            title="Add Page"
            aria-label="Add Page"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="pages-list">
          {doc.pages.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`page-item ${p.id === doc.activePageId ? 'active' : ''}`}
              onClick={() => onSwitchPage(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section layers-section">
        <div className="panel-header">
          <span>Layers</span>
          <div className="header-actions">
            <button
              type="button"
              className="icon-btn-tiny"
              disabled={!canGroup}
              onClick={onGroup}
              title="Group Selection (Ctrl+G)"
              aria-label="Group Selection"
            >
              <Group size={14} />
            </button>
            <button
              type="button"
              className="icon-btn-tiny"
              disabled={!canUngroup}
              onClick={onUngroup}
              title="Ungroup (Ctrl+Shift+G)"
              aria-label="Ungroup"
            >
              <Ungroup size={14} />
            </button>
          </div>
        </div>

        <div className="layers-tree" role="tree">
          {page.children.length === 0 ? (
            <div className="empty-hint">No layers yet. Draw a shape on the canvas!</div>
          ) : (
            renderTree(page.children, 0)
          )}
        </div>
      </div>
    </aside>
  );
};

