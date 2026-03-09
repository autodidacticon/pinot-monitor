export interface RollbackEntry {
    id: string;
    timestamp: string;
    tool: string;
    args: Record<string, string>;
    beforeState: string;
    undoAction: {
        tool: string;
        args: Record<string, string>;
    } | null;
}
export declare function recordAction(tool: string, args: Record<string, string>, beforeState: string, undoAction: {
    tool: string;
    args: Record<string, string>;
} | null): RollbackEntry;
export declare function getRollbackLog(): RollbackEntry[];
export declare function getUndoAction(id: string): {
    tool: string;
    args: Record<string, string>;
} | null | undefined;
