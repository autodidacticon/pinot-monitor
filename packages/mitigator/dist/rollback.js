import { randomUUID } from "node:crypto";
const MAX_ENTRIES = 50;
const rollbackLog = [];
export function recordAction(tool, args, beforeState, undoAction) {
    const entry = {
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
export function getRollbackLog() {
    return [...rollbackLog];
}
export function getUndoAction(id) {
    const entry = rollbackLog.find((e) => e.id === id);
    if (!entry)
        return undefined;
    return entry.undoAction;
}
