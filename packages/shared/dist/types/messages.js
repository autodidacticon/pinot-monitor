import { z } from "zod";
import { Incident } from "./incident.js";
export const MessageType = z.enum([
    "incident",
    "dispatch",
    "verify",
    "verify_result",
    "audit",
    "alert",
]);
export const AgentName = z.enum([
    "monitor",
    "mitigator",
    "operator",
]);
export const AgentMessage = z.object({
    from: AgentName,
    to: AgentName,
    type: MessageType,
    correlationId: z.string(),
    timestamp: z.string(),
    payload: z.record(z.string(), z.unknown()),
});
// Typed payloads for each message type
export const IncidentMessage = AgentMessage.extend({
    type: z.literal("incident"),
    payload: z.object({
        incidents: z.array(Incident),
        sweepReport: z.string().optional(),
    }),
});
export const DispatchMessage = AgentMessage.extend({
    type: z.literal("dispatch"),
    payload: z.object({
        incident: Incident,
        runbookId: z.string(),
    }),
});
export const VerifyMessage = AgentMessage.extend({
    type: z.literal("verify"),
    payload: z.object({
        check: z.string(),
        context: z.string().optional(),
    }),
});
export const VerifyResultMessage = AgentMessage.extend({
    type: z.literal("verify_result"),
    payload: z.object({
        passed: z.boolean(),
        details: z.string(),
    }),
});
export const AuditMessage = AgentMessage.extend({
    type: z.literal("audit"),
    payload: z.object({
        action: z.string(),
        target: z.string(),
        inputSummary: z.string(),
        outputSummary: z.string(),
    }),
});
export const AlertMessage = AgentMessage.extend({
    type: z.literal("alert"),
    payload: z.object({
        severity: z.enum(["CRITICAL", "WARNING"]),
        summary: z.string(),
        incident: Incident.optional(),
    }),
});
