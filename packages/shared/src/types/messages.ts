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
export type MessageType = z.infer<typeof MessageType>;

export const AgentName = z.enum([
  "monitor",
  "mitigator",
  "operator",
]);
export type AgentName = z.infer<typeof AgentName>;

export const AgentMessage = z.object({
  from: AgentName,
  to: AgentName,
  type: MessageType,
  correlationId: z.string(),
  timestamp: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export type AgentMessage = z.infer<typeof AgentMessage>;

// Typed payloads for each message type

export const IncidentMessage = AgentMessage.extend({
  type: z.literal("incident"),
  payload: z.object({
    incidents: z.array(Incident),
    sweepReport: z.string().optional(),
  }),
});
export type IncidentMessage = z.infer<typeof IncidentMessage>;

export const DispatchMessage = AgentMessage.extend({
  type: z.literal("dispatch"),
  payload: z.object({
    incident: Incident,
    runbookId: z.string(),
  }),
});
export type DispatchMessage = z.infer<typeof DispatchMessage>;

export const VerifyMessage = AgentMessage.extend({
  type: z.literal("verify"),
  payload: z.object({
    check: z.string(),
    context: z.string().optional(),
  }),
});
export type VerifyMessage = z.infer<typeof VerifyMessage>;

export const VerifyResultMessage = AgentMessage.extend({
  type: z.literal("verify_result"),
  payload: z.object({
    passed: z.boolean(),
    details: z.string(),
  }),
});
export type VerifyResultMessage = z.infer<typeof VerifyResultMessage>;

export const AuditMessage = AgentMessage.extend({
  type: z.literal("audit"),
  payload: z.object({
    action: z.string(),
    target: z.string(),
    inputSummary: z.string(),
    outputSummary: z.string(),
  }),
});
export type AuditMessage = z.infer<typeof AuditMessage>;

export const AlertMessage = AgentMessage.extend({
  type: z.literal("alert"),
  payload: z.object({
    severity: z.enum(["CRITICAL", "WARNING"]),
    summary: z.string(),
    incident: Incident.optional(),
  }),
});
export type AlertMessage = z.infer<typeof AlertMessage>;
