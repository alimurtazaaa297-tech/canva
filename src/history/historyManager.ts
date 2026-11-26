import { DocumentModel } from '../model/types';
import { Command } from './commands';

export class HistoryManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | null {
    return this.undoStack.length > 0
      ? this.undoStack[this.undoStack.length - 1].label
      : null;
  }

  get redoLabel(): string | null {
    return this.redoStack.length > 0
      ? this.redoStack[this.redoStack.length - 1].label
      : null;
  }

  execute(cmd: Command, doc: DocumentModel): DocumentModel {
    const nextDoc = cmd.do(doc);
    this.pushExecuted(cmd);
    return nextDoc;
  }

  /**
   * Pushes an already-applied command onto the undo stack (used for
   * transactions where live updates happened during a drag).
   */
  pushExecuted(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo(doc: DocumentModel): DocumentModel | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    const prevDoc = cmd.undo(doc);
    this.redoStack.push(cmd);
    return prevDoc;
  }

  redo(doc: DocumentModel): DocumentModel | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    const nextDoc = cmd.do(doc);
    this.undoStack.push(cmd);
    return nextDoc;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

