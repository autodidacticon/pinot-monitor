import { z } from "zod";
import { controllerUrl, brokerUrl, serverUrl } from "../config.js";
import { defineTool } from "@pinot-agents/shared";
// Shared fetch helper with timeout and graceful error handling
async function pinotFetch(url, timeoutMs = 10_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        const text = await res.text();
        if (!res.ok) {
            return `HTTP ${res.status}: ${text}`;
        }
        return text;
    }
    catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
            return `Error: request to ${url} timed out after ${timeoutMs}ms`;
        }
        return `Error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`;
    }
    finally {
        clearTimeout(timer);
    }
}
// 1. Health checks across controller, broker, server
export const pinotHealth = defineTool("pinot_health", "Check health/readiness of Pinot controller, broker, and server. Returns status for each component.", z.object({}), async () => {
    const checks = [
        { name: "controller", url: controllerUrl("/health") },
        { name: "broker", url: brokerUrl("/health") },
        { name: "server", url: serverUrl("/health/readiness") },
    ];
    const results = await Promise.allSettled(checks.map(async (c) => ({
        component: c.name,
        response: await pinotFetch(c.url),
    })));
    const lines = results.map((r) => {
        if (r.status === "fulfilled") {
            return `${r.value.component}: ${r.value.response}`;
        }
        return `unknown: ${r.reason}`;
    });
    return lines.join("\n");
});
// 2. List tables or get table config
export const pinotTables = defineTool("pinot_tables", "List all Pinot tables, or get config for a specific table.", z.object({
    tableName: z.string().optional().describe("If provided, get config for this table. Otherwise list all tables."),
}), async ({ tableName }) => {
    const path = tableName ? `/tables/${tableName}` : "/tables";
    return pinotFetch(controllerUrl(path));
});
// 3. Get segments for a table (includes table type to avoid false positives)
export const pinotSegments = defineTool("pinot_segments", "Get segment info for a Pinot table. Returns table type (REALTIME/OFFLINE/HYBRID) and segment metadata. IMPORTANT: OFFLINE segments in OFFLINE-type tables are normal — only flag segments in ERROR state or OFFLINE segments in REALTIME tables.", z.object({
    tableName: z.string().describe("The table name to inspect segments for"),
}), async ({ tableName }) => {
    // Fetch table config to determine table type
    const configResp = await pinotFetch(controllerUrl(`/tables/${tableName}`));
    let tableType = "UNKNOWN";
    try {
        const parsed = JSON.parse(configResp);
        if (parsed.OFFLINE)
            tableType = parsed.REALTIME ? "HYBRID" : "OFFLINE";
        else if (parsed.REALTIME)
            tableType = "REALTIME";
    }
    catch {
        // If config fetch fails, proceed with UNKNOWN type
    }
    const segments = await pinotFetch(controllerUrl(`/segments/${tableName}`));
    return `Table type: ${tableType}\n\n${segments}`;
});
// 4. Cluster info and instances
export const pinotClusterInfo = defineTool("pinot_cluster_info", "Get Pinot cluster metadata (/cluster/info) and instance list (/instances).", z.object({}), async () => {
    const [info, instances] = await Promise.all([
        pinotFetch(controllerUrl("/cluster/info")),
        pinotFetch(controllerUrl("/instances")),
    ]);
    return `=== Cluster Info ===\n${info}\n\n=== Instances ===\n${instances}`;
});
// 5. Debug table diagnostics
export const pinotDebugTable = defineTool("pinot_debug_table", "Run deep diagnostics on a specific Pinot table via /debug/tables/{name}. Only use when issues are detected.", z.object({
    tableName: z.string().describe("The table name to debug"),
}), async ({ tableName }) => {
    return pinotFetch(controllerUrl(`/debug/tables/${tableName}`));
});
// 6. Table size info
function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
export const pinotTableSize = defineTool("pinot_table_size", "Get storage size for one or all Pinot tables. Returns reported and estimated sizes in human-readable format. Use to detect storage pressure or capacity issues. WARNING threshold: 1GB per table, CRITICAL threshold: 5GB per table.", z.object({
    tableName: z.string().optional().describe("If provided, get size for this table. Otherwise get sizes for all tables."),
}), async ({ tableName }) => {
    if (tableName) {
        const raw = await pinotFetch(controllerUrl(`/tables/${tableName}/size?detailed=true`));
        try {
            const data = JSON.parse(raw);
            const reported = data.reportedSizeInBytes ?? 0;
            const estimated = data.estimatedSizeInBytes ?? 0;
            let result = `Table: ${data.tableName ?? tableName}\n`;
            result += `Reported size: ${formatBytes(reported)} (${reported} bytes)\n`;
            result += `Estimated size: ${formatBytes(estimated)} (${estimated} bytes)\n`;
            // Size thresholds
            const WARNING_BYTES = 1024 * 1024 * 1024; // 1 GB
            const CRITICAL_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
            if (reported >= CRITICAL_BYTES) {
                result += `⚠ CRITICAL: Table exceeds 5GB threshold!\n`;
            }
            else if (reported >= WARNING_BYTES) {
                result += `⚠ WARNING: Table exceeds 1GB threshold\n`;
            }
            // Per-replica breakdown if available
            if (data.reportedSizePerReplicaInBytes && typeof data.reportedSizePerReplicaInBytes === "object") {
                result += `\nPer-replica sizes:\n`;
                for (const [server, size] of Object.entries(data.reportedSizePerReplicaInBytes)) {
                    result += `  ${server}: ${formatBytes(size)}\n`;
                }
            }
            return result;
        }
        catch {
            return raw;
        }
    }
    // No tableName — get sizes for all tables
    const tablesRaw = await pinotFetch(controllerUrl("/tables"));
    let tableNames;
    try {
        const parsed = JSON.parse(tablesRaw);
        tableNames = parsed.tables ?? [];
    }
    catch {
        return `Error listing tables: ${tablesRaw}`;
    }
    if (tableNames.length === 0) {
        return "No tables found in cluster.";
    }
    const WARNING_BYTES = 1024 * 1024 * 1024; // 1 GB
    const CRITICAL_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
    let totalBytes = 0;
    const lines = [`Storage report for ${tableNames.length} table(s):\n`];
    for (const name of tableNames) {
        const raw = await pinotFetch(controllerUrl(`/tables/${name}/size`));
        try {
            const data = JSON.parse(raw);
            const reported = data.reportedSizeInBytes ?? 0;
            totalBytes += reported;
            let flag = "";
            if (reported >= CRITICAL_BYTES)
                flag = " ⚠ CRITICAL";
            else if (reported >= WARNING_BYTES)
                flag = " ⚠ WARNING";
            lines.push(`  ${data.tableName ?? name}: ${formatBytes(reported)}${flag}`);
        }
        catch {
            lines.push(`  ${name}: Error fetching size`);
        }
    }
    lines.push(`\nTotal storage: ${formatBytes(totalBytes)} (${totalBytes} bytes)`);
    if (totalBytes >= CRITICAL_BYTES) {
        lines.push(`⚠ CRITICAL: Total cluster storage exceeds 5GB!`);
    }
    else if (totalBytes >= WARNING_BYTES) {
        lines.push(`⚠ WARNING: Total cluster storage exceeds 1GB`);
    }
    return lines.join("\n");
});
// 7. Broker query latency probe
export const pinotBrokerLatency = defineTool("pinot_broker_latency", "Measure Pinot broker query latency by running a lightweight COUNT(*) query against one or all tables. Reports WARNING if latency exceeds 5s, CRITICAL if over 30s. Use to detect query overload or broker performance issues.", z.object({
    tableName: z.string().optional().describe("If provided, probe this table only. Otherwise probe all tables."),
}), async ({ tableName }) => {
    // Helper: probe a single table and measure latency
    async function probeTable(table) {
        const sql = `SELECT COUNT(*) FROM ${table} LIMIT 1`;
        const start = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60_000);
        try {
            const res = await fetch(brokerUrl("/query/sql"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sql }),
                signal: controller.signal,
            });
            const latencyMs = Date.now() - start;
            if (!res.ok) {
                const text = await res.text();
                return { table, latencyMs, status: "ERROR", error: `HTTP ${res.status}: ${text}` };
            }
            // Consume body to complete timing
            await res.text();
            const finalLatency = Date.now() - start;
            let status = "OK";
            if (finalLatency >= 30_000)
                status = "CRITICAL";
            else if (finalLatency >= 5_000)
                status = "WARNING";
            return { table, latencyMs: finalLatency, status };
        }
        catch (err) {
            const latencyMs = Date.now() - start;
            if (err instanceof Error && err.name === "AbortError") {
                return { table, latencyMs, status: "CRITICAL", error: "Query timed out after 60s" };
            }
            return { table, latencyMs, status: "ERROR", error: err instanceof Error ? err.message : String(err) };
        }
        finally {
            clearTimeout(timer);
        }
    }
    // Determine which tables to probe
    let tableNames;
    if (tableName) {
        tableNames = [tableName];
    }
    else {
        const tablesRaw = await pinotFetch(controllerUrl("/tables"));
        try {
            const parsed = JSON.parse(tablesRaw);
            tableNames = parsed.tables ?? [];
        }
        catch {
            return `Error listing tables: ${tablesRaw}`;
        }
        if (tableNames.length === 0) {
            return "No tables found in cluster.";
        }
    }
    const results = [];
    for (const name of tableNames) {
        results.push(await probeTable(name));
    }
    const lines = [`Broker query latency report (${results.length} table(s)):\n`];
    let worstStatus = "OK";
    for (const r of results) {
        let line = `  ${r.table}: ${r.latencyMs}ms [${r.status}]`;
        if (r.error)
            line += ` — ${r.error}`;
        lines.push(line);
        if (r.status === "CRITICAL")
            worstStatus = "CRITICAL";
        else if (r.status === "WARNING" && worstStatus !== "CRITICAL")
            worstStatus = "WARNING";
        else if (r.status === "ERROR" && worstStatus === "OK")
            worstStatus = "ERROR";
    }
    lines.push(`\nOverall broker latency status: ${worstStatus}`);
    if (worstStatus === "WARNING") {
        lines.push("WARNING: Some queries exceeded 5s latency threshold");
    }
    else if (worstStatus === "CRITICAL") {
        lines.push("CRITICAL: Some queries exceeded 30s latency threshold — possible query overload");
    }
    return lines.join("\n");
});
// 8. Ingestion lag / consuming segment status for REALTIME tables
export const pinotIngestionStatus = defineTool("pinot_ingestion_status", "Check consuming segment status and ingestion lag for REALTIME Pinot tables. Detects stuck consumers, high lag, and partition issues. If no tableName is given, checks all REALTIME tables.", z.object({
    tableName: z.string().optional().describe("If provided, check this specific table. Otherwise check all REALTIME tables."),
}), async ({ tableName }) => {
    // Helper: check consuming segments for a single table
    async function checkTable(table) {
        const raw = await pinotFetch(controllerUrl(`/tables/${table}/consumingSegmentsInfo`), 15_000);
        try {
            const data = JSON.parse(raw);
            const segments = data._segmentToConsumingInfoMap ?? data;
            const segmentEntries = Object.entries(segments);
            if (segmentEntries.length === 0) {
                return `  ${table}: No consuming segments found (table may be OFFLINE-only or fully caught up)`;
            }
            const lines = [`  ${table}: ${segmentEntries.length} consuming segment(s)`];
            let hasIssue = false;
            for (const [segName, segInfo] of segmentEntries) {
                const info = segInfo;
                const partitionOffsetInfo = info.partitionOffsetInfo;
                const consumerState = String(info.consumerState ?? info.status ?? "UNKNOWN");
                let lagStr = "";
                if (partitionOffsetInfo) {
                    const currentOffsets = partitionOffsetInfo.currentOffsetsMap;
                    const latestOffsets = partitionOffsetInfo.latestUpstreamOffsetMap;
                    if (currentOffsets && latestOffsets) {
                        const lagParts = [];
                        for (const [partition, current] of Object.entries(currentOffsets)) {
                            const latest = latestOffsets[partition];
                            if (latest !== undefined) {
                                const lag = BigInt(latest) - BigInt(current);
                                lagParts.push(`p${partition}:${lag.toString()}`);
                                if (lag > 10000n)
                                    hasIssue = true;
                            }
                        }
                        if (lagParts.length > 0)
                            lagStr = ` lag=[${lagParts.join(", ")}]`;
                    }
                }
                let statusLabel = "OK";
                if (consumerState === "NOT_CONSUMING" || consumerState === "PAUSED") {
                    statusLabel = "STUCK";
                    hasIssue = true;
                }
                else if (consumerState === "CONSUMING") {
                    statusLabel = "OK";
                }
                else {
                    statusLabel = consumerState;
                }
                lines.push(`    ${segName}: [${statusLabel}] state=${consumerState}${lagStr}`);
            }
            if (hasIssue) {
                lines.push(`    WARNING: Issues detected for ${table} — stuck consumers or high lag`);
            }
            return lines.join("\n");
        }
        catch {
            // If JSON parse fails, it might be an error message or non-REALTIME table
            if (raw.includes("does not have tableType REALTIME") || raw.includes("not found") || raw.includes("404")) {
                return `  ${table}: Not a REALTIME table (skipped)`;
            }
            return `  ${table}: Error fetching consuming info — ${raw.substring(0, 200)}`;
        }
    }
    if (tableName) {
        const result = await checkTable(tableName);
        return `Ingestion status for ${tableName}:\n${result}`;
    }
    // No tableName — discover all tables, filter to REALTIME
    const tablesRaw = await pinotFetch(controllerUrl("/tables"));
    let tableNames;
    try {
        const parsed = JSON.parse(tablesRaw);
        tableNames = parsed.tables ?? [];
    }
    catch {
        return `Error listing tables: ${tablesRaw}`;
    }
    if (tableNames.length === 0) {
        return "No tables found in cluster.";
    }
    const lines = [`Ingestion status report (checking ${tableNames.length} table(s) for REALTIME consumers):\n`];
    let realtimeCount = 0;
    let issuesFound = false;
    for (const name of tableNames) {
        const result = await checkTable(name);
        if (!result.includes("Not a REALTIME table")) {
            realtimeCount++;
            if (result.includes("WARNING") || result.includes("STUCK")) {
                issuesFound = true;
            }
        }
        lines.push(result);
    }
    if (realtimeCount === 0) {
        lines.push("\nNo REALTIME tables found — ingestion lag check not applicable.");
    }
    else if (issuesFound) {
        lines.push(`\nWARNING: Ingestion issues detected in one or more REALTIME tables.`);
    }
    else {
        lines.push(`\nAll ${realtimeCount} REALTIME table(s) consuming normally.`);
    }
    return lines.join("\n");
});
// 9. SQL query via broker
export const pinotQuery = defineTool("pinot_query", "Execute a read-only SQL query against Pinot via the broker. Only SELECT statements are allowed. Use for data-level health checks (row counts, freshness, null ratios).", z.object({
    sql: z.string().describe("The SQL query to execute (SELECT only)"),
}), async ({ sql }) => {
    const trimmed = sql.trim();
    const firstWord = trimmed.split(/\s+/)[0]?.toUpperCase();
    if (firstWord !== "SELECT") {
        return "Error: only SELECT queries are allowed (read-only mode)";
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
        const res = await fetch(brokerUrl("/query/sql"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sql: trimmed }),
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
            return "Error: SQL query timed out after 30s";
        }
        return `Error executing query: ${err instanceof Error ? err.message : String(err)}`;
    }
    finally {
        clearTimeout(timer);
    }
});
// 10. Component-level operational metrics
export const pinotServerMetrics = defineTool("pinot_server_metrics", "Collect operational metrics from Pinot components (controller, broker, server). Reports health status, response times, and key operational indicators like segment counts, routing table info, and error counts. Use to detect performance degradation or component-level issues beyond simple health checks.", z.object({
    component: z
        .enum(["controller", "broker", "server", "all"])
        .optional()
        .default("all")
        .describe('Which component to check: "controller", "broker", "server", or "all" (default)'),
}), async ({ component }) => {
    const sections = [];
    const components = component === "all"
        ? ["controller", "broker", "server"]
        : [component];
    for (const comp of components) {
        const lines = [];
        if (comp === "controller") {
            lines.push("=== Controller Metrics ===");
            // Health + response time
            const healthStart = Date.now();
            const healthResp = await pinotFetch(controllerUrl("/health"));
            const healthLatency = Date.now() - healthStart;
            lines.push(`Health: ${healthResp.trim()} (${healthLatency}ms)`);
            if (healthLatency > 5000)
                lines.push("WARNING: Controller health response > 5s");
            // Instance counts
            const infoResp = await pinotFetch(controllerUrl("/instances"));
            try {
                const parsed = JSON.parse(infoResp);
                const instances = parsed.instances ?? [];
                const brokers = instances.filter((i) => i.startsWith("Broker_"));
                const servers = instances.filter((i) => i.startsWith("Server_"));
                const controllers = instances.filter((i) => i.startsWith("Controller_"));
                lines.push(`Instances: ${controllers.length} controller(s), ${brokers.length} broker(s), ${servers.length} server(s)`);
            }
            catch {
                lines.push(`Instances: unable to parse — ${infoResp.substring(0, 200)}`);
            }
            // Table count + segment summary via externalview
            const tablesResp = await pinotFetch(controllerUrl("/tables"));
            try {
                const parsed = JSON.parse(tablesResp);
                const tableNames = parsed.tables ?? [];
                lines.push(`Tables: ${tableNames.length}`);
                let totalSegments = 0;
                let errorSegments = 0;
                for (const tbl of tableNames) {
                    const extViewResp = await pinotFetch(controllerUrl(`/tables/${tbl}/externalview`), 15_000);
                    try {
                        const extView = JSON.parse(extViewResp);
                        const segmentMap = extView.OFFLINE ?? extView.REALTIME ?? {};
                        const segCount = Object.keys(segmentMap).length;
                        totalSegments += segCount;
                        for (const serverMap of Object.values(segmentMap)) {
                            for (const status of Object.values(serverMap)) {
                                if (status === "ERROR")
                                    errorSegments++;
                            }
                        }
                    }
                    catch {
                        // externalview not parseable, skip
                    }
                }
                lines.push(`Total segments across all tables: ${totalSegments}`);
                if (errorSegments > 0) {
                    lines.push(`CRITICAL: ${errorSegments} segment(s) in ERROR state`);
                }
                else {
                    lines.push("Segment errors: 0");
                }
            }
            catch {
                lines.push(`Tables: unable to parse — ${tablesResp.substring(0, 200)}`);
            }
        }
        if (comp === "broker") {
            lines.push("=== Broker Metrics ===");
            // Health + response time
            const healthStart = Date.now();
            const healthResp = await pinotFetch(brokerUrl("/health"));
            const healthLatency = Date.now() - healthStart;
            lines.push(`Health: ${healthResp.trim()} (${healthLatency}ms)`);
            if (healthLatency > 5000)
                lines.push("WARNING: Broker health response > 5s");
            // Routing table info
            const routingResp = await pinotFetch(brokerUrl("/debug/routingTable"), 15_000);
            try {
                const parsed = JSON.parse(routingResp);
                const tableKeys = Object.keys(parsed);
                lines.push(`Routing tables: ${tableKeys.length}`);
                for (const key of tableKeys) {
                    const entries = parsed[key];
                    if (Array.isArray(entries)) {
                        lines.push(`  ${key}: ${entries.length} routing entries`);
                    }
                    else if (entries && typeof entries === "object") {
                        lines.push(`  ${key}: ${Object.keys(entries).length} routing entries`);
                    }
                }
            }
            catch {
                lines.push(`Routing table: ${routingResp.substring(0, 300)}`);
            }
            // Active queries
            const queriesResp = await pinotFetch(brokerUrl("/debug/queries"), 10_000);
            if (!queriesResp.startsWith("Error")) {
                try {
                    const parsed = JSON.parse(queriesResp);
                    if (Array.isArray(parsed)) {
                        lines.push(`Active queries: ${parsed.length}`);
                    }
                    else if (parsed && typeof parsed === "object") {
                        lines.push(`Active queries info: ${JSON.stringify(parsed).substring(0, 300)}`);
                    }
                }
                catch {
                    lines.push(`Active queries: ${queriesResp.substring(0, 200)}`);
                }
            }
        }
        if (comp === "server") {
            lines.push("=== Server Metrics ===");
            // Health + response time
            const healthStart = Date.now();
            const healthResp = await pinotFetch(serverUrl("/health/readiness"));
            const healthLatency = Date.now() - healthStart;
            lines.push(`Health: ${healthResp.trim()} (${healthLatency}ms)`);
            if (healthLatency > 5000)
                lines.push("WARNING: Server health response > 5s");
            // Tenant info via controller
            const tenantsResp = await pinotFetch(controllerUrl("/tenants"), 10_000);
            try {
                const parsed = JSON.parse(tenantsResp);
                const serverTenants = parsed.SERVER_TENANTS ?? [];
                const brokerTenants = parsed.BROKER_TENANTS ?? [];
                lines.push(`Server tenants: ${serverTenants.join(", ") || "none"}`);
                lines.push(`Broker tenants: ${brokerTenants.join(", ") || "none"}`);
            }
            catch {
                lines.push(`Tenants: ${tenantsResp.substring(0, 200)}`);
            }
        }
        sections.push(lines.join("\n"));
    }
    return sections.join("\n\n");
});
