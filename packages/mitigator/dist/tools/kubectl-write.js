import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { defineTool } from "@pinot-agents/shared";
import { config } from "../config.js";
import { recordAction } from "../rollback.js";
const execFileAsync = promisify(execFile);
export const kubectlDelete = defineTool("kubectl_delete", "Delete a Kubernetes resource (typically a pod to force restart via controller). Logs before/after state.", z.object({
    resource: z.string().describe("Resource type (e.g., pod)"),
    name: z.string().describe("Resource name"),
    namespace: z.enum(config.namespaces).describe("Kubernetes namespace"),
    selector: z.string().optional().describe("Label selector instead of name (e.g., component=broker)"),
}), async ({ resource, name, namespace, selector }) => {
    // Blast radius guard: refuse selectors or wildcards that could match multiple pods
    if (selector) {
        return "Error: kubectl_delete refuses to delete by label selector — this could match multiple resources. Delete one resource at a time by name.";
    }
    if (name.includes("*") || name.includes("?")) {
        return "Error: kubectl_delete refuses wildcard names — this could match multiple resources. Specify an exact resource name.";
    }
    if (config.dryRun) {
        console.log(`[DRY RUN] kubectl_delete: ${resource} ${name} -n ${namespace}`);
        return JSON.stringify({ dryRun: true, action: "kubectl_delete", resource, name, namespace, timestamp: new Date().toISOString() });
    }
    // Capture before state (YAML for manual recovery)
    const beforeArgs = ["get", resource, name, "-n", namespace, "-o", "yaml"];
    let beforeState;
    try {
        const { stdout } = await execFileAsync("kubectl", beforeArgs, { timeout: 10_000 });
        beforeState = stdout;
    }
    catch {
        beforeState = "(could not capture before state)";
    }
    // Delete
    const deleteArgs = ["delete", resource, name, "-n", namespace, "--wait=false"];
    try {
        const { stdout, stderr } = await execFileAsync("kubectl", deleteArgs, { timeout: 30_000 });
        const output = stdout || stderr || "(no output)";
        // Record rollback entry (undo is null — can't undo a delete, but beforeState is captured)
        recordAction("kubectl_delete", { resource, name, namespace }, beforeState.trim(), null);
        return JSON.stringify({
            action: "kubectl_delete",
            beforeState: beforeState.trim(),
            result: output.trim(),
            timestamp: new Date().toISOString(),
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error: kubectl delete failed: ${msg}`;
    }
});
export const kubectlExec = defineTool("kubectl_exec", "Execute a command inside a running pod. Use for diagnostics or config reloads.", z.object({
    pod: z.string().describe("Pod name"),
    namespace: z.enum(config.namespaces).describe("Kubernetes namespace"),
    command: z.array(z.string()).describe("Command and arguments to run"),
    container: z.string().optional().describe("Container name if pod has multiple"),
}), async ({ pod, namespace, command, container }) => {
    if (config.dryRun) {
        console.log(`[DRY RUN] kubectl_exec: ${pod} -n ${namespace} -- ${command.join(" ")}`);
        return JSON.stringify({ dryRun: true, action: "kubectl_exec", pod, namespace, command, container, timestamp: new Date().toISOString() });
    }
    const args = ["exec", pod, "-n", namespace];
    if (container) {
        args.push("-c", container);
    }
    args.push("--", ...command);
    try {
        const { stdout, stderr } = await execFileAsync("kubectl", args, {
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
        });
        return stdout || stderr || "(no output)";
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error: kubectl exec failed: ${msg}`;
    }
});
export const kubectlGet = defineTool("kubectl_get_mitigator", "Read-only kubectl for the mitigator to capture state before/after mutations.", z.object({
    subcommand: z.enum(["get", "describe"]).describe("kubectl subcommand"),
    namespace: z.enum(config.namespaces).describe("Kubernetes namespace"),
    args: z.array(z.string()).describe("Additional arguments"),
}), async ({ subcommand, namespace, args }) => {
    try {
        const { stdout, stderr } = await execFileAsync("kubectl", [subcommand, "-n", namespace, ...args], {
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
        });
        return stdout || stderr || "(no output)";
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `kubectl error: ${msg}`;
    }
});
