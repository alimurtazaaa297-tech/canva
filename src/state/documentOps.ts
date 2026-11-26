import { nanoid } from 'nanoid';
import {
  collectSubtreeIds,
  createGroupNode,
  createRectNode,
  createEllipseNode,
  getSelectionWorldAABB,
  isContainerNode,
} from '../model/document';
import { DocumentModel, PageNode, SceneNode } from '../model/types';
import { capturePageTree, PageTreeCommand } from '../history/commands';

export function deleteNodesInPage(
  page: PageNode,
  idsToDelete: string[]
): { command: PageTreeCommand | null } {
  if (idsToDelete.length === 0) return { command: null };
  const before = capturePageTree(page);

  const allRemoveIds = new Set<string>();
  for (const id of idsToDelete) {
    for (const subId of collectSubtreeIds(page, id)) {
      allRemoveIds.add(subId);
    }
  }

  const nextNodes: Record<string, SceneNode> = {};
  for (const [id, node] of Object.entries(page.nodes)) {
    if (allRemoveIds.has(id)) continue;
    if (isContainerNode(node)) {
      nextNodes[id] = {
        ...node,
        children: node.children.filter((cid) => !allRemoveIds.has(cid)),
      };
    } else {
      nextNodes[id] = node;
    }
  }

  const nextChildren = page.children.filter((cid) => !allRemoveIds.has(cid));
  const after = { children: nextChildren, nodes: nextNodes };
  return {
    command: new PageTreeCommand('Delete Layers', before, after),
  };
}

export function cloneSubtreesForPaste(
  sourceNodes: Record<string, SceneNode>,
  rootIds: string[],
  offsetX: number,
  offsetY: number,
  targetParentId: string | null = null
): { clonedNodes: SceneNode[]; newRootIds: string[] } {
  const clonedNodes: SceneNode[] = [];
  const newRootIds: string[] = [];

  const cloneRecursive = (
    oldId: string,
    newParentId: string | null,
    isRoot: boolean
  ): string | null => {
    const src = sourceNodes[oldId];
    if (!src) return null;
    const newId = nanoid(8);
    if (isRoot) newRootIds.push(newId);

    let cloned: SceneNode = {
      ...structuredClone(src),
      id: newId,
      parentId: newParentId,
      transform: isRoot
        ? {
            ...src.transform,
            x: src.transform.x + offsetX,
            y: src.transform.y + offsetY,
          }
        : { ...src.transform },
    };

    if (isContainerNode(src) && isContainerNode(cloned)) {
      const childIds: string[] = [];
      for (const cid of src.children) {
        const clonedCid = cloneRecursive(cid, newId, false);
        if (clonedCid) childIds.push(clonedCid);
      }
      cloned = { ...cloned, children: childIds };
    }

    clonedNodes.push(cloned);
    return newId;
  };

  for (const rid of rootIds) {
    cloneRecursive(rid, targetParentId, true);
  }

  return { clonedNodes, newRootIds };
}

export function groupSelectedNodes(
  page: PageNode,
  selectedIds: string[]
): { command: PageTreeCommand; groupId: string } | null {
  if (selectedIds.length < 2) return null;
  const first = page.nodes[selectedIds[0]];
  if (!first) return null;
  const commonParentId = first.parentId;
  // Only group siblings with the same parent for clean tree semantics
  const validIds = selectedIds.filter(
    (id) => page.nodes[id] && page.nodes[id].parentId === commonParentId
  );
  if (validIds.length < 2) return null;

  const aabb = getSelectionWorldAABB(page, validIds);
  if (!aabb) return null;

  const before = capturePageTree(page);
  const nextNodes = { ...page.nodes };

  // Compute group position in parent space
  const parentNode = commonParentId ? page.nodes[commonParentId] : null;
  let groupX = aabb.x;
  let groupY = aabb.y;
  if (parentNode) {
    groupX = Math.min(...validIds.map((id) => page.nodes[id].transform.x));
    groupY = Math.min(...validIds.map((id) => page.nodes[id].transform.y));
  }

  const group = createGroupNode(
    groupX,
    groupY,
    aabb.width,
    aabb.height,
    validIds,
    commonParentId
  );

  for (const id of validIds) {
    const n = nextNodes[id];
    nextNodes[id] = {
      ...n,
      parentId: group.id,
      transform: {
        ...n.transform,
        x: n.transform.x - groupX,
        y: n.transform.y - groupY,
      },
    };
  }
  nextNodes[group.id] = group;

  const selectedSet = new Set(validIds);
  let nextPageChildren = [...page.children];

  if (commonParentId === null) {
    const insertAt = page.children.findIndex((id) => selectedSet.has(id));
    nextPageChildren = page.children.filter((id) => !selectedSet.has(id));
    nextPageChildren.splice(Math.max(0, insertAt), 0, group.id);
  } else if (parentNode && isContainerNode(parentNode)) {
    const insertAt = parentNode.children.findIndex((id) => selectedSet.has(id));
    const filtered = parentNode.children.filter((id) => !selectedSet.has(id));
    filtered.splice(Math.max(0, insertAt), 0, group.id);
    nextNodes[commonParentId] = { ...parentNode, children: filtered };
  }

  return {
    command: new PageTreeCommand('Group Layers', before, {
      children: nextPageChildren,
      nodes: nextNodes,
    }),
    groupId: group.id,
  };
}

export function ungroupNode(
  page: PageNode,
  groupId: string
): { command: PageTreeCommand; childIds: string[] } | null {
  const group = page.nodes[groupId];
  if (!group || group.type !== 'group') return null;

  const before = capturePageTree(page);
  const nextNodes = { ...page.nodes };
  const childIds = [...group.children];

  for (const cid of childIds) {
    const child = nextNodes[cid];
    if (!child) continue;
    nextNodes[cid] = {
      ...child,
      parentId: group.parentId,
      transform: {
        ...child.transform,
        x: child.transform.x + group.transform.x,
        y: child.transform.y + group.transform.y,
        rotation: child.transform.rotation + group.transform.rotation,
      },
    };
  }
  delete nextNodes[groupId];

  let nextPageChildren = [...page.children];
  if (group.parentId === null) {
    const idx = nextPageChildren.indexOf(groupId);
    if (idx !== -1) {
      nextPageChildren.splice(idx, 1, ...childIds);
    }
  } else {
    const parent = nextNodes[group.parentId];
    if (parent && isContainerNode(parent)) {
      const idx = parent.children.indexOf(groupId);
      const updated = [...parent.children];
      if (idx !== -1) updated.splice(idx, 1, ...childIds);
      nextNodes[group.parentId] = { ...parent, children: updated };
    }
  }

  return {
    command: new PageTreeCommand('Ungroup', before, {
      children: nextPageChildren,
      nodes: nextNodes,
    }),
    childIds,
  };
}

export function reorderLayer(
  page: PageNode,
  draggedId: string,
  targetId: string,
  position: 'before' | 'after' | 'inside'
): PageTreeCommand | null {
  if (draggedId === targetId) return null;
  const dragged = page.nodes[draggedId];
  const target = page.nodes[targetId];
  if (!dragged || !target) return null;

  // Prevent dropping a container into its own descendant
  const subtree = new Set(collectSubtreeIds(page, draggedId));
  if (subtree.has(targetId)) return null;

  const before = capturePageTree(page);
  const nextNodes = { ...page.nodes };
  let nextPageChildren = [...page.children];

  // Remove dragged from old parent
  if (dragged.parentId === null) {
    nextPageChildren = nextPageChildren.filter((id) => id !== draggedId);
  } else {
    const oldParent = nextNodes[dragged.parentId];
    if (oldParent && isContainerNode(oldParent)) {
      nextNodes[dragged.parentId] = {
        ...oldParent,
        children: oldParent.children.filter((id) => id !== draggedId),
      };
    }
  }

  // Insert into new parent
  const newParentId = position === 'inside' && isContainerNode(target) ? targetId : target.parentId;
  nextNodes[draggedId] = { ...dragged, parentId: newParentId };

  if (newParentId === null) {
    const idx = nextPageChildren.indexOf(targetId);
    const insertIdx = position === 'after' ? idx + 1 : idx;
    nextPageChildren.splice(Math.max(0, insertIdx), 0, draggedId);
  } else {
    const newParent = nextNodes[newParentId];
    if (newParent && isContainerNode(newParent)) {
      const arr = [...newParent.children];
      if (position === 'inside') {
        arr.push(draggedId);
      } else {
        const idx = arr.indexOf(targetId);
        const insertIdx = position === 'after' ? idx + 1 : idx;
        arr.splice(Math.max(0, insertIdx), 0, draggedId);
      }
      nextNodes[newParentId] = { ...newParent, children: arr };
    }
  }

  return new PageTreeCommand('Reorder Layer', before, {
    children: nextPageChildren,
    nodes: nextNodes,
  });
}

export function createStressTestNodes(count = 500): SceneNode[] {
  const palette = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
  const nodes: SceneNode[] = [];
  const cols = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = 100 + col * 72;
    const y = 600 + row * 72;
    const color = palette[i % palette.length];
    const node =
      i % 2 === 0
        ? createRectNode(x, y, 52, 52)
        : createEllipseNode(x, y, 52, 52);
    node.name = `Stress ${i + 1}`;
    node.fill = { color, enabled: true };
    node.transform.rotation = (i * 7) % 45;
    nodes.push(node);
  }
  return nodes;
}

export function validateImportedDocument(data: unknown): DocumentModel | null {
  if (!data || typeof data !== 'object') return null;
  const doc = data as Partial<DocumentModel>;
  if (
    typeof doc.id !== 'string' ||
    typeof doc.name !== 'string' ||
    !Array.isArray(doc.pages) ||
    doc.pages.length === 0 ||
    typeof doc.activePageId !== 'string'
  ) {
    return null;
  }
  for (const p of doc.pages) {
    if (!p || p.type !== 'page' || !Array.isArray(p.children) || typeof p.nodes !== 'object') {
      return null;
    }
  }
  return doc as DocumentModel;
}

