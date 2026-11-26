import React, { useRef } from 'react';
import { applyFrameConstraints } from '../model/document';
import {
  HorizontalConstraint,
  PageNode,
  SceneNode,
  ShadowStyle,
  VerticalConstraint,
} from '../model/types';
import { Command, UpdateNodesCommand } from '../history/commands';

interface PropertiesPanelProps {
  page: PageNode;
  selectedIds: string[];
  onLivePageChange: (updater: (page: PageNode) => PageNode) => void;
  onCommitCommand: (cmd: Command) => void;
  onPushExecutedCommand: (cmd: Command) => void;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  page,
  selectedIds,
  onLivePageChange,
  onCommitCommand,
  onPushExecutedCommand,
}) => {
  const sliderBeforeRef = useRef<Record<string, SceneNode> | null>(null);

  if (selectedIds.length === 0) {
    return (
      <aside className="panel right-panel" aria-label="Properties Panel">
        <div className="panel-header">
          <span>Design</span>
        </div>
        <div className="empty-properties">
          <p className="muted-title">No selection</p>
          <p className="muted-desc">Select a layer to inspect or edit its properties.</p>
          <div className="shortcuts-card">
            <div className="shortcut-title">Shortcuts</div>
            <div className="shortcut-row"><span>Select / Move</span><kbd>V</kbd></div>
            <div className="shortcut-row"><span>Frame / Rect / Ellipse</span><kbd>F / R / O</kbd></div>
            <div className="shortcut-row"><span>Line / Text / Pen</span><kbd>L / T / P</kbd></div>
            <div className="shortcut-row"><span>Pan</span><kbd>Space + Drag</kbd></div>
            <div className="shortcut-row"><span>Zoom</span><kbd>Ctrl + Scroll</kbd></div>
            <div className="shortcut-row"><span>Undo / Redo</span><kbd>Ctrl+Z / Shift+Z</kbd></div>
            <div className="shortcut-row"><span>Group / Ungroup</span><kbd>Ctrl+G / Shift+G</kbd></div>
            <div className="shortcut-row"><span>Duplicate</span><kbd>Ctrl+D</kbd></div>
            <div className="shortcut-row"><span>Copy / Paste in Place</span><kbd>Ctrl+C / Shift+V</kbd></div>
          </div>
        </div>
      </aside>
    );
  }

  const primary = page.nodes[selectedIds[0]];
  if (!primary) return null;

  const updateSelected = (
    label: string,
    updater: (node: SceneNode) => SceneNode
  ) => {
    const before: Record<string, SceneNode> = {};
    const after: Record<string, SceneNode> = {};
    for (const id of selectedIds) {
      const n = page.nodes[id];
      if (!n) continue;
      before[id] = n;
      after[id] = updater(n);
    }
    onCommitCommand(new UpdateNodesCommand(label, before, after));
  };

  const beginLiveEdit = () => {
    if (!sliderBeforeRef.current) {
      const before: Record<string, SceneNode> = {};
      for (const id of selectedIds) {
        if (page.nodes[id]) before[id] = page.nodes[id];
      }
      sliderBeforeRef.current = before;
    }
  };

  const applyLiveEdit = (updater: (node: SceneNode) => SceneNode) => {
    beginLiveEdit();
    onLivePageChange((p) => {
      const nextNodes = { ...p.nodes };
      for (const id of selectedIds) {
        if (nextNodes[id]) nextNodes[id] = updater(nextNodes[id]);
      }
      return { ...p, nodes: nextNodes };
    });
  };

  const commitLiveEdit = (label: string) => {
    if (!sliderBeforeRef.current) return;
    const before = sliderBeforeRef.current;
    sliderBeforeRef.current = null;
    const after: Record<string, SceneNode> = {};
    for (const id of Object.keys(before)) {
      if (page.nodes[id]) after[id] = page.nodes[id];
    }
    onPushExecutedCommand(new UpdateNodesCommand(label, before, after));
  };

  const updateDimension = (field: 'x' | 'y' | 'width' | 'height' | 'rotation', val: number) => {
    if (Number.isNaN(val)) return;
    const before: Record<string, SceneNode> = {};
    const after: Record<string, SceneNode> = {};

    for (const id of selectedIds) {
      const n = page.nodes[id];
      if (!n) continue;
      before[id] = n;

      if (field === 'x' || field === 'y' || field === 'rotation') {
        after[id] = {
          ...n,
          transform: { ...n.transform, [field]: val },
        };
      } else {
        const nextW = field === 'width' ? Math.max(1, val) : n.width;
        const nextH = field === 'height' ? Math.max(1, val) : n.height;
        const updated = { ...n, width: nextW, height: nextH };
        after[id] = updated;

        if (n.type === 'frame') {
          const tempPage: PageNode = {
            ...page,
            nodes: { ...page.nodes, [id]: updated },
          };
          const constrained = applyFrameConstraints(
            tempPage,
            id,
            n.width,
            n.height,
            nextW,
            nextH
          );
          for (const cid of n.children) {
            if (page.nodes[cid] && constrained[cid]) {
              before[cid] = page.nodes[cid];
              after[cid] = constrained[cid];
            }
          }
        }
      }
    }
    onCommitCommand(new UpdateNodesCommand(`Update ${field}`, before, after));
  };

  const hasFill = 'fill' in primary;
  const hasStroke = 'stroke' in primary;
  const hasShadow = 'shadow' in primary;
  const hasCornerRadius = primary.type === 'rect' || primary.type === 'frame';
  const parentNode = primary.parentId ? page.nodes[primary.parentId] : null;
  const isInsideFrame = parentNode?.type === 'frame';

  const shadow: ShadowStyle | null = hasShadow ? primary.shadow : null;

  return (
    <aside className="panel right-panel" aria-label="Properties Panel">
      <div className="panel-header">
        <span>
          {selectedIds.length > 1
            ? `${selectedIds.length} Layers`
            : primary.name}
        </span>
        <span className="node-type-badge">{primary.type}</span>
      </div>

      <div className="props-scroll">
        {/* Transform */}
        <div className="prop-section">
          <div className="prop-section-title">Transform</div>
          <div className="prop-grid-2">
            <label className="prop-field">
              <span>X</span>
              <input
                type="number"
                value={Math.round(primary.transform.x * 10) / 10}
                onChange={(e) => updateDimension('x', parseFloat(e.target.value))}
              />
            </label>
            <label className="prop-field">
              <span>Y</span>
              <input
                type="number"
                value={Math.round(primary.transform.y * 10) / 10}
                onChange={(e) => updateDimension('y', parseFloat(e.target.value))}
              />
            </label>
            <label className="prop-field">
              <span>W</span>
              <input
                type="number"
                min={1}
                value={Math.round(primary.width * 10) / 10}
                onChange={(e) => updateDimension('width', parseFloat(e.target.value))}
              />
            </label>
            <label className="prop-field">
              <span>H</span>
              <input
                type="number"
                min={1}
                value={Math.round(primary.height * 10) / 10}
                onChange={(e) => updateDimension('height', parseFloat(e.target.value))}
              />
            </label>
            <label className="prop-field">
              <span>Rot°</span>
              <input
                type="number"
                value={Math.round(primary.transform.rotation * 10) / 10}
                onChange={(e) => updateDimension('rotation', parseFloat(e.target.value))}
              />
            </label>
            {hasCornerRadius && (
              <label className="prop-field">
                <span>Rad</span>
                <input
                  type="number"
                  min={0}
                  value={primary.cornerRadius}
                  onChange={(e) => {
                    const r = Math.max(0, parseFloat(e.target.value) || 0);
                    updateSelected('Change Corner Radius', (n) =>
                      n.type === 'rect' || n.type === 'frame'
                        ? { ...n, cornerRadius: r }
                        : n
                    );
                  }}
                />
              </label>
            )}
          </div>
        </div>

        {/* Constraints (when inside a Frame) */}
        {isInsideFrame && (
          <div className="prop-section">
            <div className="prop-section-title">Constraints</div>
            <div className="prop-grid-2">
              <label className="prop-field-col">
                <span>Horizontal</span>
                <select
                  value={primary.constraints.horizontal}
                  onChange={(e) =>
                    updateSelected('Change Horizontal Constraint', (n) => ({
                      ...n,
                      constraints: {
                        ...n.constraints,
                        horizontal: e.target.value as HorizontalConstraint,
                      },
                    }))
                  }
                >
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="center">Center</option>
                  <option value="left-right">Left & Right</option>
                  <option value="scale">Scale</option>
                </select>
              </label>
              <label className="prop-field-col">
                <span>Vertical</span>
                <select
                  value={primary.constraints.vertical}
                  onChange={(e) =>
                    updateSelected('Change Vertical Constraint', (n) => ({
                      ...n,
                      constraints: {
                        ...n.constraints,
                        vertical: e.target.value as VerticalConstraint,
                      },
                    }))
                  }
                >
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                  <option value="center">Center</option>
                  <option value="top-bottom">Top & Bottom</option>
                  <option value="scale">Scale</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {/* Layer Opacity */}
        <div className="prop-section">
          <div className="prop-section-title">
            <span>Opacity</span>
            <span>{Math.round(primary.opacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={primary.opacity}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              applyLiveEdit((n) => ({ ...n, opacity: val }));
            }}
            onPointerUp={() => commitLiveEdit('Change Opacity')}
            onBlur={() => commitLiveEdit('Change Opacity')}
          />
        </div>

        {/* Fill */}
        {hasFill && (
          <div className="prop-section">
            <div className="prop-section-title">
              <span>Fill</span>
              <input
                type="checkbox"
                checked={primary.fill.enabled}
                onChange={(e) =>
                  updateSelected('Toggle Fill', (n) =>
                    'fill' in n
                      ? { ...n, fill: { ...n.fill, enabled: e.target.checked } }
                      : n
                  )
                }
              />
            </div>
            {primary.fill.enabled && (
              <div className="color-row">
                <input
                  type="color"
                  value={primary.fill.color}
                  onChange={(e) => {
                    const color = e.target.value;
                    applyLiveEdit((n) =>
                      'fill' in n ? { ...n, fill: { ...n.fill, color } } : n
                    );
                  }}
                  onBlur={() => commitLiveEdit('Change Fill Color')}
                />
                <input
                  type="text"
                  className="hex-input"
                  value={primary.fill.color}
                  onChange={(e) =>
                    updateSelected('Change Fill Color', (n) =>
                      'fill' in n
                        ? { ...n, fill: { ...n.fill, color: e.target.value } }
                        : n
                    )
                  }
                />
              </div>
            )}
          </div>
        )}

        {/* Stroke */}
        {hasStroke && (
          <div className="prop-section">
            <div className="prop-section-title">
              <span>Stroke</span>
              <input
                type="checkbox"
                checked={primary.stroke.enabled}
                onChange={(e) =>
                  updateSelected('Toggle Stroke', (n) =>
                    'stroke' in n
                      ? { ...n, stroke: { ...n.stroke, enabled: e.target.checked } }
                      : n
                  )
                }
              />
            </div>
            {primary.stroke.enabled && (
              <div className="prop-grid-2">
                <div className="color-row">
                  <input
                    type="color"
                    value={primary.stroke.color}
                    onChange={(e) => {
                      const color = e.target.value;
                      applyLiveEdit((n) =>
                        'stroke' in n ? { ...n, stroke: { ...n.stroke, color } } : n
                      );
                    }}
                    onBlur={() => commitLiveEdit('Change Stroke Color')}
                  />
                  <input
                    type="text"
                    className="hex-input"
                    value={primary.stroke.color}
                    onChange={(e) =>
                      updateSelected('Change Stroke Color', (n) =>
                        'stroke' in n
                          ? { ...n, stroke: { ...n.stroke, color: e.target.value } }
                          : n
                      )
                    }
                  />
                </div>
                <label className="prop-field">
                  <span>W</span>
                  <input
                    type="number"
                    min={0}
                    max={64}
                    value={primary.stroke.width}
                    onChange={(e) => {
                      const w = Math.max(0, parseFloat(e.target.value) || 0);
                      updateSelected('Change Stroke Width', (n) =>
                        'stroke' in n
                          ? { ...n, stroke: { ...n.stroke, width: w } }
                          : n
                      );
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {/* Text */}
        {primary.type === 'text' && (
          <div className="prop-section">
            <div className="prop-section-title">Typography</div>
            <div className="prop-grid-2">
              <label className="prop-field">
                <span>Size</span>
                <input
                  type="number"
                  min={8}
                  max={200}
                  value={primary.fontSize}
                  onChange={(e) => {
                    const fs = Math.max(8, parseFloat(e.target.value) || 16);
                    updateSelected('Change Font Size', (n) =>
                      n.type === 'text' ? { ...n, fontSize: fs } : n
                    );
                  }}
                />
              </label>
              <label className="prop-field">
                <span>Weight</span>
                <select
                  value={primary.fontWeight}
                  onChange={(e) =>
                    updateSelected('Change Font Weight', (n) =>
                      n.type === 'text'
                        ? { ...n, fontWeight: parseInt(e.target.value, 10) }
                        : n
                    )
                  }
                >
                  <option value={400}>Regular</option>
                  <option value={500}>Medium</option>
                  <option value={600}>SemiBold</option>
                  <option value={700}>Bold</option>
                </select>
              </label>
            </div>
            <div className="align-row">
              {(['left', 'center', 'right'] as const).map((align) => (
                <button
                  key={align}
                  type="button"
                  className={`align-btn ${primary.textAlign === align ? 'active' : ''}`}
                  onClick={() =>
                    updateSelected('Change Text Align', (n) =>
                      n.type === 'text' ? { ...n, textAlign: align } : n
                    )
                  }
                >
                  {align}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Drop Shadow */}
        {shadow && (
          <div className="prop-section">
            <div className="prop-section-title">
              <span>Drop Shadow</span>
              <input
                type="checkbox"
                checked={shadow.enabled}
                onChange={(e) =>
                  updateSelected('Toggle Shadow', (n) =>
                    'shadow' in n
                      ? { ...n, shadow: { ...n.shadow, enabled: e.target.checked } }
                      : n
                  )
                }
              />
            </div>
            {shadow.enabled && (
              <div className="prop-grid-2">
                <label className="prop-field">
                  <span>X</span>
                  <input
                    type="number"
                    value={shadow.offsetX}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0;
                      updateSelected('Shadow Offset X', (n) =>
                        'shadow' in n
                          ? { ...n, shadow: { ...n.shadow, offsetX: v } }
                          : n
                      );
                    }}
                  />
                </label>
                <label className="prop-field">
                  <span>Y</span>
                  <input
                    type="number"
                    value={shadow.offsetY}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0;
                      updateSelected('Shadow Offset Y', (n) =>
                        'shadow' in n
                          ? { ...n, shadow: { ...n.shadow, offsetY: v } }
                          : n
                      );
                    }}
                  />
                </label>
                <label className="prop-field">
                  <span>Blur</span>
                  <input
                    type="number"
                    min={0}
                    value={shadow.blur}
                    onChange={(e) => {
                      const v = Math.max(0, parseFloat(e.target.value) || 0);
                      updateSelected('Shadow Blur', (n) =>
                        'shadow' in n
                          ? { ...n, shadow: { ...n.shadow, blur: v } }
                          : n
                      );
                    }}
                  />
                </label>
                <label className="prop-field">
                  <span>Col</span>
                  <input
                    type="text"
                    value={shadow.color}
                    onChange={(e) =>
                      updateSelected('Shadow Color', (n) =>
                        'shadow' in n
                          ? { ...n, shadow: { ...n.shadow, color: e.target.value } }
                          : n
                      )
                    }
                  />
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};

