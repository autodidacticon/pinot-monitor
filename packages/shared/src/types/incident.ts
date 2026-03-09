import { z } from "zod";

export const Severity = z.enum(["CRITICAL", "WARNING", "INFO"]);
export type Severity = z.infer<typeof Severity>;

export const Incident = z.object({
  id: z.string(),
  severity: Severity,
  component: z.string(),
  evidence: z.array(z.string()),
  suggestedAction: z.string(),
  timestamp: z.string(),
});
export type Incident = z.infer<typeof Incident>;

export const IncidentReport = z.object({
  report: z.string(),
  incidents: z.array(Incident),
});
export type IncidentReport = z.infer<typeof IncidentReport>;
