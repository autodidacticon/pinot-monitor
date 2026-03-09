import { z } from "zod";
export const Severity = z.enum(["CRITICAL", "WARNING", "INFO"]);
export const Incident = z.object({
    id: z.string(),
    severity: Severity,
    component: z.string(),
    evidence: z.array(z.string()),
    suggestedAction: z.string(),
    timestamp: z.string(),
});
export const IncidentReport = z.object({
    report: z.string(),
    incidents: z.array(Incident),
});
