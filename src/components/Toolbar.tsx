import React from 'react';
import {
  Circle,
  Download,
  Frame,
  Minus,
  MousePointer2,
  PenTool,
  Redo2,
  Square,
  Type,
  Undo2,
  Upload,
  Zap,
} from 'lucide-react';
import { ToolType } from '../model/types';

interface ToolbarProps {
  docName: string;
  onDocNameChange: (name: string) => void;
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  onUndo: () => void;
  onRedo: () => void;
  onExportJSON: () => void;
  onImportJSON: () => void;
  onExportPNG: () => void;
  onExportSVG: () => void;
  onStressTest: () => void;
}

const TOOLS: { id: ToolType; label: string; shortcut: string; icon: React.ReactNode }[] = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: <MousePointer2 size={16} /> },
  { id: 'frame', label: 'Frame', shortcut: 'F', icon: <Frame size={16} /> },
  { id: 'rect', label: 'Rectangle', shortcut: 'R', icon: <Square size={16} /> },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: <Circle size={16} /> },
  { id: 'line', label: 'Line', shortcut: 'L', icon: <Minus size={16} /> },
  { id: 'text', label: 'Text', shortcut: 'T', icon: <Type size={16} /> },
  { id: 'pen', label: 'Pen', shortcut: 'P', icon: <PenTool size={16} /> },
];

export const Toolbar: React.FC<ToolbarProps> = ({
  docName,
  onDocNameChange,
  activeTool,
  onToolChange,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
  onExportJSON,
  onImportJSON,
  onExportPNG,
  onExportSVG,
  onStressTest,
}) => {
  return (
    <header className="toolbar" role="toolbar" aria-label="Editor Toolbar">
      <div className="toolbar-group">
        <div className="brand-badge">MF</div>
        <input
          className="doc-name-input"
          value={docName}
          onChange={(e) => onDocNameChange(e.target.value)}
          aria-label="Document Name"
        />
      </div>

      <div className="toolbar-group tool-buttons">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tool-btn ${activeTool === t.id ? 'active' : ''}`}
            onClick={() => onToolChange(t.id)}
            title={`${t.label} (${t.shortcut})`}
            aria-label={t.label}
            aria-pressed={activeTool === t.id}
          >
            {t.icon}
          </button>
        ))}

        <div className="toolbar-divider" />

        <button
          type="button"
          className="tool-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}
          aria-label="Undo"
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={onRedo}
          disabled={!canRedo}
          title={redoLabel ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)'}
          aria-label="Redo"
        >
          <Redo2 size={16} />
        </button>
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          className="action-btn"
          onClick={onStressTest}
          title="Spawn 500 shapes to test performance"
        >
          <Zap size={14} />
          <span>+500</span>
        </button>

        <div className="zoom-controls">
          <button type="button" className="zoom-btn" onClick={onZoomOut} title="Zoom Out">
            −
          </button>
          <button
            type="button"
            className="zoom-readout"
            onClick={onZoomReset}
            title="Reset Zoom to 100%"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="zoom-btn" onClick={onZoomIn} title="Zoom In">
            +
          </button>
        </div>

        <button
          type="button"
          className="action-btn"
          onClick={onImportJSON}
          title="Import JSON Document"
        >
          <Upload size={14} />
          <span>Load</span>
        </button>
        <button
          type="button"
          className="action-btn"
          onClick={onExportJSON}
          title="Save JSON Document"
        >
          <Download size={14} />
          <span>JSON</span>
        </button>
        <button
          type="button"
          className="action-btn primary"
          onClick={onExportSVG}
          title="Export Selection or Page as SVG"
        >
          SVG
        </button>
        <button
          type="button"
          className="action-btn primary"
          onClick={onExportPNG}
          title="Export Selection or Page as PNG (2x)"
        >
          PNG
        </button>
      </div>
    </header>
  );
};

