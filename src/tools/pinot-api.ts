import { z } from "zod";
import { controllerUrl, brokerUrl, serverUrl } from "../config.js";
import { defineTool } from "./registry.js";

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

// 3. Get segments for a table
export const pinotSegments = defineTool(
  "pinot_segments",
  "Get segment info for a Pinot table. Use to detect ERROR or OFFLINE segments.",
  z.object({
    tableName: z.string().describe("The table name to inspect segments for"),
  }),
  async ({ tableName }) => {
    return pinotFetch(controllerUrl(`/segments/${tableName}`));
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
