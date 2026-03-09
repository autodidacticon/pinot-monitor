import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { config } from "../config.js";
import { defineTool } from "@pinot-agents/shared";
const execFileAsync = promisify(execFile);
export const kubectlEvents = defineTool("kubectl_events", "Get recent warning/error Kubernetes events (OOMKills, evictions, scheduling failures, image pull errors, etc.) in a namespace.", z.object({
    namespace: z.enum(config.namespaces).describe("Kubernetes namespace"),
    sinceMinutes: z.number().optional().default(30).describe("Only show events newer than N minutes (default 30)"),
}), async ({ namespace, sinceMinutes }) => {
    const cmdArgs = [
        "get", "events",
        "-n", namespace,
        "--sort-by=.lastTimestamp",
        "--field-selector=type!=Normal",
        "-o", "custom-columns=TIMESTAMP:.lastTimestamp,TYPE:.type,REASON:.reason,OBJECT:.involvedObject.kind/.involvedObject.name,MESSAGE:.message",
        "--no-headers",
    ];
    try {
        const { stdout, stderr } = await execFileAsync("kubectl", cmdArgs, {
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
        });
        const raw = stdout || stderr || "";
        if (!raw.trim()) {
            return `No warning/error events found in namespace "${namespace}" (last ${sinceMinutes} minutes)`;
        }
        // Filter events by age (sinceMinutes)
        const cutoff = new Date(Date.now() - sinceMinutes * 60 * 1000);
        const lines = raw.trim().split("\n");
        const filtered = lines.filter((line) => {
            const tsMatch = line.match(/^(\S+)/);
            if (!tsMatch)
                return false;
            const ts = new Date(tsMatch[1]);
            return !isNaN(ts.getTime()) && ts >= cutoff;
        });
        if (filtered.length === 0) {
            return `No warning/error events in the last ${sinceMinutes} minutes in namespace "${namespace}"`;
        }
        return `Warning/Error events in "${namespace}" (last ${sinceMinutes}min):\n${filtered.join("\n")}`;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `kubectl events error: ${msg}`;
    }
});
const ALLOWED_SUBCOMMANDS = ["get", "describe", "top", "logs"];
const DANGEROUS_FLAGS = ["--force", "-f", "--delete", "--cascade", "--grace-period=0"];
export const kubectlGet = defineTool("kubectl_get", "Run a read-only kubectl command (get, describe, top, logs) against whitelisted namespaces. Returns stdout.", z.object({
    subcommand: z.enum(ALLOWED_SUBCOMMANDS).describe("kubectl subcommand"),
    namespace: z.enum(config.namespaces).describe("Kubernetes namespace"),
    args: z.array(z.string()).describe("Additional arguments (resource type, name, flags like -o json)"),
}), async ({ subcommand, namespace, args }) => {
    // Reject dangerous flags
    for (const arg of args) {
        const lower = arg.toLowerCase();
        if (DANGEROUS_FLAGS.some((f) => lower.startsWith(f))) {
            return `Error: flag "${arg}" is not allowed (read-only mode)`;
        }
    }
    const cmdArgs = [subcommand, "-n", namespace, ...args];
    try {
        const { stdout, stderr } = await execFileAsync("kubectl", cmdArgs, {
            timeout: 30_000,
            maxBuffer: 1024 * 1024, // 1MB
        });
        return stdout || stderr || "(no output)";
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `kubectl error: ${msg}`;
    }
});
