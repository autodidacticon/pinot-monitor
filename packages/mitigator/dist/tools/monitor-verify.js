import { z } from "zod";
import { defineTool } from "@pinot-agents/shared";
import { config } from "../config.js";
export const requestMonitorVerify = defineTool("request_monitor_verify", "Ask the Monitor agent to verify that a remediation action took effect. Posts to Monitor's /chat endpoint and returns the response.", z.object({
    prompt: z.string().describe("What to ask the Monitor to verify (e.g., 'Check if pod X is Running')"),
}), async ({ prompt }) => {
    try {
        const res = await fetch(`${config.services.monitorUrl}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: prompt }),
        });
        if (!res.ok) {
            return `Error: Monitor returned ${res.status}`;
        }
        const data = await res.json();
        return data.response ?? "(no response from monitor)";
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error reaching monitor: ${msg}`;
    }
});
