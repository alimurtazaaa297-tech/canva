import {
  isContainerNode,
  updateActivePage,
} from '../model/document';
import { DocumentModel, PageNode, SceneNode } from '../model/types';

export interface Command {
  label: string;
  do(doc: DocumentModel): DocumentModel;
  undo(doc: DocumentModel): DocumentModel;
}

/**
 * Snapshot of a page's node map and root children list.
 * Used for structural operations (group, ungroup, reorder, delete) to guarantee
 * exact, lossless undo/redo across nested trees.
 */
export interface PageTreeSnapshot {
  children: string[];
  nodes: Record<string, SceneNode>;
}

export function capturePageTree(page: PageNode): PageTreeSnapshot {
  return {
    children: [...page.children],
    nodes: { ...page.nodes },
  };
}

export class PageTreeCommand implements Command {
  constructor(
    public readonly label: string,
    private readonly before: PageTreeSnapshot,
    private readonly after: PageTreeSnapshot
  ) {}

  do(doc: DocumentModel): DocumentModel {
    return updateActivePage(doc, (page) => ({
      ...page,
      children: [...this.after.children],
      nodes: { ...this.after.nodes },
    }));
  }

  undo(doc: DocumentModel): DocumentModel {
    return updateActivePage(doc, (page) => ({
      ...page,
      children: [...this.before.children],
      nodes: { ...this.before.nodes },
    }));
  }
}

/**
 * Updates a subset of nodes on the active page (e.g. move, resize, rotate, style).
 * Only stores before/after references for the modified node IDs.
 */
export class UpdateNodesCommand implements Command {
  constructor(
    public readonly label: string,
    private readonly beforeNodes: Record<string, SceneNode>,
    private readonly afterNodes: Record<string, SceneNode>
  ) {}

  do(doc: DocumentModel): DocumentModel {
    return updateActivePage(doc, (page) => ({
      ...page,
      nodes: {
        ...page.nodes,
        ...this.afterNodes,
      },
    }));
  }

  undo(doc: DocumentModel): DocumentModel {
    return updateActivePage(doc, (page) => ({
      ...page,
      nodes: {
        ...page.nodes,
        ...this.beforeNodes,
      },
    }));
  }
}

export class AddNodesCommand implements Command {
  constructor(
    public readonly label: string,
    private readonly nodesToAdd: SceneNode[],
    private readonly parentId: string | null = null
  ) {}

  do(doc: DocumentModel): DocumentModel {
    return updateActivePage(doc, (page) => {
      const nextNodes = { ...page.nodes };
      const addedIds: string[] = [];
      for (const n of this.nodesToAdd) {
        nextNodes[n.id] = n;
        if (n.parentId === this.parentId) {
          addedIds.push(n.id);
        }
      }

      if (this.parentId === null) {
        return {
          ...page,
          children: [...page.children, ...addedIds],
          nodes: nextNodes,
        };
      }

      const parent = nextNodes[this.parentId];
      if (parent && isContainerNode(parent)) {
        nextNodes[this.parentId] = {
          ...parent,
          children: [...parent.children, ...addedIds],
        };
      }
      return { ...page, nodes: nextNodes };
    });
  }

  undo(doc: DocumentModel): DocumentModel {
    return updateActivePage(doc, (page) => {
      const idsToRemove = new Set(this.nodesToAdd.map((n) => n.id));
      const nextNodes = { ...page.nodes };
      for (const id of idsToRemove) {
        delete nextNodes[id];
      }

      if (this.parentId === null) {
        return {
          ...page,
          children: page.children.filter((id) => !idsToRemove.has(id)),
          nodes: nextNodes,
        };
      }

      const parent = nextNodes[this.parentId];
      if (parent && isContainerNode(parent)) {
        nextNodes[this.parentId] = {
          ...parent,
          children: parent.children.filter((id) => !idsToRemove.has(id)),
        };
      }
      return { ...page, nodes: nextNodes };
    });
  }
}

export class RenamePageCommand implements Command {
  constructor(
    private readonly pageId: string,
    private readonly oldName: string,
    private readonly newName: string
  ) {}

  readonly label = 'Rename Page';

  do(doc: DocumentModel): DocumentModel {
    return {
      ...doc,
      pages: doc.pages.map((p) =>
        p.id === this.pageId ? { ...p, name: this.newName } : p
      ),
    };
  }

  undo(doc: DocumentModel): DocumentModel {
    return {
      ...doc,
      pages: doc.pages.map((p) =>
        p.id === this.pageId ? { ...p, name: this.oldName } : p
      ),
    };
  }
}

