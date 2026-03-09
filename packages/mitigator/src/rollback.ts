import { randomUUID } from "node:crypto";

export interface RollbackEntry {
  id: string;
  timestamp: string;
  tool: string;
  args: Record<string, string>;
  beforeState: string;
  undoAction: { tool: string; args: Record<string, string> } | null;
}

const MAX_ENTRIES = 50;
const rollbackLog: RollbackEntry[] = [];

export function recordAction(
  tool: string,
  args: Record<string, string>,
  beforeState: string,
  undoAction: { tool: string; args: Record<string, string> } | null,
): RollbackEntry {
  const entry: RollbackEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    tool,
    args,
    beforeState,
    undoAction,
  };

  rollbackLog.push(entry);
  if (rollbackLog.length > MAX_ENTRIES) {
    rollbackLog.shift();
  }

  console.log(JSON.stringify({ level: "rollback", ...entry }));
  return entry;
}

export function getRollbackLog(): RollbackEntry[] {
  return [...rollbackLog];
}

export function getUndoAction(id: string): { tool: string; args: Record<string, string> } | null | undefined {
  const entry = rollbackLog.find((e) => e.id === id);
  if (!entry) return undefined;
  return entry.undoAction;
}
