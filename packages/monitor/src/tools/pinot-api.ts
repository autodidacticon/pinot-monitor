import { z } from "zod";
import { controllerUrl, brokerUrl, serverUrl } from "../config.js";
import { defineTool } from "@pinot-agents/shared";

// Shared fetch helper with timeout and graceful error handling
async function pinotFetch(url: string, timeoutMs = 10_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      return `HTTP ${res.status}: ${text}`;
    }
    return text;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return `Error: request to ${url} timed out after ${timeoutMs}ms`;
    }
    return `Error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    clearTimeout(timer);
  }
}

// 1. Health checks across controller, broker, server
export const pinotHealth = defineTool(
  "pinot_health",
  "Check health/readiness of Pinot controller, broker, and server. Returns status for each component.",
  z.object({}),
  async () => {
    const checks = [
      { name: "controller", url: controllerUrl("/health") },
      { name: "broker", url: brokerUrl("/health") },
      { name: "server", url: serverUrl("/health/readiness") },
    ];

    const results = await Promise.allSettled(
      checks.map(async (c) => ({
        component: c.name,
        response: await pinotFetch(c.url),
      })),
    );

    const lines = results.map((r) => {
      if (r.status === "fulfilled") {
        return `${r.value.component}: ${r.value.response}`;
      }
      return `unknown: ${r.reason}`;
    });

    return lines.join("\n");
  },
);

// 2. List tables or get table config
export const pinotTables = defineTool(
  "pinot_tables",
  "List all Pinot tables, or get config for a specific table.",
  z.object({
    tableName: z.string().optional().describe("If provided, get config for this table. Otherwise list all tables."),
  }),
  async ({ tableName }) => {
    const path = tableName ? `/tables/${tableName}` : "/tables";
    return pinotFetch(controllerUrl(path));
  },
);

// 3. Get segments for a table (includes table type to avoid false positives)
export const pinotSegments = defineTool(
  "pinot_segments",
  "Get segment info for a Pinot table. Returns table type (REALTIME/OFFLINE/HYBRID) and segment metadata. IMPORTANT: OFFLINE segments in OFFLINE-type tables are normal — only flag segments in ERROR state or OFFLINE segments in REALTIME tables.",
  z.object({
    tableName: z.string().describe("The table name to inspect segments for"),
  }),
  async ({ tableName }) => {
    // Fetch table config to determine table type
    const configResp = await pinotFetch(controllerUrl(`/tables/${tableName}`));
    let tableType = "UNKNOWN";
    try {
      const parsed = JSON.parse(configResp);
      if (parsed.OFFLINE) tableType = parsed.REALTIME ? "HYBRID" : "OFFLINE";
      else if (parsed.REALTIME) tableType = "REALTIME";
    } catch {
      // If config fetch fails, proceed with UNKNOWN type
    }

    const segments = await pinotFetch(controllerUrl(`/segments/${tableName}`));
    return `Table type: ${tableType}\n\n${segments}`;
  },
);

// 4. Cluster info and instances
export const pinotClusterInfo = defineTool(
  "pinot_cluster_info",
  "Get Pinot cluster metadata (/cluster/info) and instance list (/instances).",
  z.object({}),
  async () => {
    const [info, instances] = await Promise.all([
      pinotFetch(controllerUrl("/cluster/info")),
      pinotFetch(controllerUrl("/instances")),
    ]);
    return `=== Cluster Info ===\n${info}\n\n=== Instances ===\n${instances}`;
  },
);

// 5. Debug table diagnostics
export const pinotDebugTable = defineTool(
  "pinot_debug_table",
  "Run deep diagnostics on a specific Pinot table via /debug/tables/{name}. Only use when issues are detected.",
  z.object({
    tableName: z.string().describe("The table name to debug"),
  }),
  async ({ tableName }) => {
    return pinotFetch(controllerUrl(`/debug/tables/${tableName}`));
  },
);

// 6. Table size info
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const pinotTableSize = defineTool(
  "pinot_table_size",
  "Get storage size for one or all Pinot tables. Returns reported and estimated sizes in human-readable format. Use to detect storage pressure or capacity issues. WARNING threshold: 1GB per table, CRITICAL threshold: 5GB per table.",
  z.object({
    tableName: z.string().optional().describe("If provided, get size for this table. Otherwise get sizes for all tables."),
  }),
  async ({ tableName }) => {
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
        } else if (reported >= WARNING_BYTES) {
          result += `⚠ WARNING: Table exceeds 1GB threshold\n`;
        }

        // Per-replica breakdown if available
        if (data.reportedSizePerReplicaInBytes && typeof data.reportedSizePerReplicaInBytes === "object") {
          result += `\nPer-replica sizes:\n`;
          for (const [server, size] of Object.entries(data.reportedSizePerReplicaInBytes)) {
            result += `  ${server}: ${formatBytes(size as number)}\n`;
          }
        }

        return result;
      } catch {
        return raw;
      }
    }

    // No tableName — get sizes for all tables
    const tablesRaw = await pinotFetch(controllerUrl("/tables"));
    let tableNames: string[];
    try {
      const parsed = JSON.parse(tablesRaw);
      tableNames = parsed.tables ?? [];
    } catch {
      return `Error listing tables: ${tablesRaw}`;
    }

    if (tableNames.length === 0) {
      return "No tables found in cluster.";
    }

    const WARNING_BYTES = 1024 * 1024 * 1024; // 1 GB
    const CRITICAL_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
    let totalBytes = 0;
    const lines: string[] = [`Storage report for ${tableNames.length} table(s):\n`];

    for (const name of tableNames) {
      const raw = await pinotFetch(controllerUrl(`/tables/${name}/size`));
      try {
        const data = JSON.parse(raw);
        const reported = data.reportedSizeInBytes ?? 0;
        totalBytes += reported;
        let flag = "";
        if (reported >= CRITICAL_BYTES) flag = " ⚠ CRITICAL";
        else if (reported >= WARNING_BYTES) flag = " ⚠ WARNING";
        lines.push(`  ${data.tableName ?? name}: ${formatBytes(reported)}${flag}`);
      } catch {
        lines.push(`  ${name}: Error fetching size`);
      }
    }

    lines.push(`\nTotal storage: ${formatBytes(totalBytes)} (${totalBytes} bytes)`);
    if (totalBytes >= CRITICAL_BYTES) {
      lines.push(`⚠ CRITICAL: Total cluster storage exceeds 5GB!`);
    } else if (totalBytes >= WARNING_BYTES) {
      lines.push(`⚠ WARNING: Total cluster storage exceeds 1GB`);
    }

    return lines.join("\n");
  },
);

// 7. Broker query latency probe
export const pinotBrokerLatency = defineTool(
  "pinot_broker_latency",
  "Measure Pinot broker query latency by running a lightweight COUNT(*) query against one or all tables. Reports WARNING if latency exceeds 5s, CRITICAL if over 30s. Use to detect query overload or broker performance issues.",
  z.object({
    tableName: z.string().optional().describe("If provided, probe this table only. Otherwise probe all tables."),
  }),
  async ({ tableName }) => {
    // Helper: probe a single table and measure latency
    async function probeTable(table: string): Promise<{ table: string; latencyMs: number; status: string; error?: string }> {
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
        if (finalLatency >= 30_000) status = "CRITICAL";
        else if (finalLatency >= 5_000) status = "WARNING";

        return { table, latencyMs: finalLatency, status };
      } catch (err: unknown) {
        const latencyMs = Date.now() - start;
        if (err instanceof Error && err.name === "AbortError") {
          return { table, latencyMs, status: "CRITICAL", error: "Query timed out after 60s" };
        }
        return { table, latencyMs, status: "ERROR", error: err instanceof Error ? err.message : String(err) };
      } finally {
        clearTimeout(timer);
      }
    }

    // Determine which tables to probe
    let tableNames: string[];
    if (tableName) {
      tableNames = [tableName];
    } else {
      const tablesRaw = await pinotFetch(controllerUrl("/tables"));
      try {
        const parsed = JSON.parse(tablesRaw);
        tableNames = parsed.tables ?? [];
      } catch {
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

    const lines: string[] = [`Broker query latency report (${results.length} table(s)):\n`];
    let worstStatus = "OK";
    for (const r of results) {
      let line = `  ${r.table}: ${r.latencyMs}ms [${r.status}]`;
      if (r.error) line += ` — ${r.error}`;
      lines.push(line);
      if (r.status === "CRITICAL") worstStatus = "CRITICAL";
      else if (r.status === "WARNING" && worstStatus !== "CRITICAL") worstStatus = "WARNING";
      else if (r.status === "ERROR" && worstStatus === "OK") worstStatus = "ERROR";
    }

    lines.push(`\nOverall broker latency status: ${worstStatus}`);
    if (worstStatus === "WARNING") {
      lines.push("WARNING: Some queries exceeded 5s latency threshold");
    } else if (worstStatus === "CRITICAL") {
      lines.push("CRITICAL: Some queries exceeded 30s latency threshold — possible query overload");
    }

    return lines.join("\n");
  },
);

// 8. SQL query via broker
export const pinotQuery = defineTool(
  "pinot_query",
  "Execute a read-only SQL query against Pinot via the broker. Only SELECT statements are allowed. Use for data-level health checks (row counts, freshness, null ratios).",
  z.object({
    sql: z.string().describe("The SQL query to execute (SELECT only)"),
  }),
  async ({ sql }) => {
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
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return "Error: SQL query timed out after 30s";
      }
      return `Error executing query: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      clearTimeout(timer);
    }
  },
);
