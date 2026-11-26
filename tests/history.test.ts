import { describe, expect, it } from 'vitest';
import { AddNodesCommand, UpdateNodesCommand } from '../src/history/commands';
import { HistoryManager } from '../src/history/historyManager';
import {
  createEmptyDocument,
  createRectNode,
  getActivePage,
} from '../src/model/document';
import { groupSelectedNodes, ungroupNode } from '../src/state/documentOps';

describe('HistoryManager & Commands', () => {
  it('undoes and redoes node addition and property updates', () => {
    const history = new HistoryManager();
    let doc = createEmptyDocument();
    const initialCount = getActivePage(doc).children.length;

    const rect = createRectNode(50, 50, 120, 80);
    doc = history.execute(new AddNodesCommand('Add Rect', [rect], null), doc);
    expect(getActivePage(doc).children.length).toBe(initialCount + 1);

    const updated = { ...rect, transform: { ...rect.transform, x: 200 } };
    doc = history.execute(
      new UpdateNodesCommand('Move Rect', { [rect.id]: rect }, { [rect.id]: updated }),
      doc
    );
    expect(getActivePage(doc).nodes[rect.id].transform.x).toBe(200);

    doc = history.undo(doc)!;
    expect(getActivePage(doc).nodes[rect.id].transform.x).toBe(50);

    doc = history.undo(doc)!;
    expect(getActivePage(doc).children.length).toBe(initialCount);

    doc = history.redo(doc)!;
    expect(getActivePage(doc).children.length).toBe(initialCount + 1);
  });

  it('undoes and redoes grouping and ungrouping cleanly', () => {
    const history = new HistoryManager();
    let doc = createEmptyDocument();
    const r1 = createRectNode(10, 10, 40, 40);
    const r2 = createRectNode(70, 20, 40, 40);
    doc = history.execute(new AddNodesCommand('Add 2 Rects', [r1, r2], null), doc);

    const groupRes = groupSelectedNodes(getActivePage(doc), [r1.id, r2.id])!;
    doc = history.execute(groupRes.command, doc);
    expect(getActivePage(doc).nodes[groupRes.groupId].type).toBe('group');
    expect(getActivePage(doc).nodes[r1.id].parentId).toBe(groupRes.groupId);

    const ungroupRes = ungroupNode(getActivePage(doc), groupRes.groupId)!;
    doc = history.execute(ungroupRes.command, doc);
    expect(getActivePage(doc).nodes[groupRes.groupId]).toBeUndefined();
    expect(getActivePage(doc).nodes[r1.id].parentId).toBeNull();

    // Undo ungroup -> group returns
    doc = history.undo(doc)!;
    expect(getActivePage(doc).nodes[groupRes.groupId].type).toBe('group');
  });
});

