import { z } from "zod";
import { defineTool } from "@pinot-agents/shared";
import { config, controllerUrl } from "../config.js";
import { recordAction } from "../rollback.js";
async function pinotPost(url, body, timeoutMs = 15_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: body ? { "Content-Type": "application/json" } : {},
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
        const text = await res.text();
        if (!res.ok) {
            return `HTTP ${res.status}: ${text}`;
        }
        return text;
    }
    catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
            return `Error: request timed out after ${timeoutMs}ms`;
        }
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
    finally {
        clearTimeout(timer);
    }
}
async function pinotPut(url, body, timeoutMs = 15_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: "PUT",
            headers: body ? { "Content-Type": "application/json" } : {},
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
        const text = await res.text();
        if (!res.ok) {
            return `HTTP ${res.status}: ${text}`;
        }
        return text;
    }
    catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
            return `Error: request timed out after ${timeoutMs}ms`;
        }
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
    finally {
        clearTimeout(timer);
    }
}
export const pinotRebalance = defineTool("pinot_rebalance", "Trigger a table rebalance via the Pinot controller. Use to redistribute segments after server changes.", z.object({
    tableName: z.string().describe("Table name (e.g., myTable_OFFLINE)"),
    tableType: z.enum(["OFFLINE", "REALTIME"]).describe("Table type"),
}), async ({ tableName, tableType }) => {
    const url = controllerUrl(`/tables/${tableName}/rebalance?type=${tableType}`);
    if (config.dryRun) {
        console.log(`[DRY RUN] pinot_rebalance: POST ${url}`);
        return JSON.stringify({ dryRun: true, action: "pinot_rebalance", url, tableName, tableType, timestamp: new Date().toISOString() });
    }
    return pinotPost(url);
});
export const pinotReloadSegment = defineTool("pinot_reload_segment", "Reload a specific segment or all segments for a table. Use to fix OFFLINE or ERROR segments.", z.object({
    tableName: z.string().describe("Table name"),
    segmentName: z.string().optional().describe("Specific segment to reload. Omit to reload all."),
    tableType: z.enum(["OFFLINE", "REALTIME"]).describe("Table type"),
}), async ({ tableName, segmentName, tableType }) => {
    const fullName = `${tableName}_${tableType}`;
    const url = segmentName
        ? controllerUrl(`/segments/${fullName}/${segmentName}/reload`)
        : controllerUrl(`/segments/${fullName}/reload`);
    if (config.dryRun) {
        console.log(`[DRY RUN] pinot_reload_segment: POST ${url}`);
        return JSON.stringify({ dryRun: true, action: "pinot_reload_segment", url, tableName, segmentName, tableType, timestamp: new Date().toISOString() });
    }
    // Capture before state: current segment status
    let beforeState = "(could not capture before state)";
    try {
        const statusUrl = segmentName
            ? controllerUrl(`/segments/${fullName}/${segmentName}/metadata`)
            : controllerUrl(`/segments/${fullName}`);
        const statusRes = await fetch(statusUrl, { signal: AbortSignal.timeout(10_000) });
        beforeState = await statusRes.text();
    }
    catch {
        // keep default
    }
    const result = await pinotPost(url);
    // Record rollback entry (reload is idempotent, no undo needed)
    recordAction("pinot_reload_segment", { tableName, segmentName: segmentName ?? "(all)", tableType }, beforeState, null);
    return result;
});
export const pinotUpdateConfig = defineTool("pinot_update_config", "Update a table's configuration via the Pinot controller PUT /tables/{tableName}. Use with caution.", z.object({
    tableName: z.string().describe("Table name"),
    config: z.record(z.string(), z.unknown()).describe("Table config JSON to apply"),
}), async ({ tableName, config: tableConfig }) => {
    const url = controllerUrl(`/tables/${tableName}`);
    if (config.dryRun) {
        console.log(`[DRY RUN] pinot_update_config: PUT ${url}`);
        return JSON.stringify({ dryRun: true, action: "pinot_update_config", url, tableName, timestamp: new Date().toISOString() });
    }
    // Capture before state: current table config via GET
    let beforeState = "(could not capture before state)";
    try {
        const getRes = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        beforeState = await getRes.text();
    }
    catch {
        // keep default
    }
    const result = await pinotPut(url, tableConfig);
    // Record rollback entry with undo action (restore previous config)
    let undoAction = null;
    if (beforeState !== "(could not capture before state)") {
        undoAction = {
            tool: "pinot_update_config",
            args: { tableName, config: beforeState },
        };
    }
    recordAction("pinot_update_config", { tableName, config: JSON.stringify(tableConfig) }, beforeState, undoAction);
    return result;
});
