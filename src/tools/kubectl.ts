import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { config } from "../config.js";
import { defineTool } from "./registry.js";

const execFileAsync = promisify(execFile);

const ALLOWED_SUBCOMMANDS = ["get", "describe", "top", "logs"] as const;
const DANGEROUS_FLAGS = ["--force", "-f", "--delete", "--cascade", "--grace-period=0"];

export const kubectlGet = defineTool(
  "kubectl_get",
  "Run a read-only kubectl command (get, describe, top, logs) against whitelisted namespaces. Returns stdout.",
  z.object({
    subcommand: z.enum(ALLOWED_SUBCOMMANDS).describe("kubectl subcommand"),
    namespace: z.enum(config.namespaces).describe("Kubernetes namespace"),
    args: z.array(z.string()).describe("Additional arguments (resource type, name, flags like -o json)"),
  }),
  async ({ subcommand, namespace, args }) => {
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `kubectl error: ${msg}`;
    }
  },
);
