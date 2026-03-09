import { z } from "zod";
export declare const Severity: z.ZodEnum<{
    CRITICAL: "CRITICAL";
    WARNING: "WARNING";
    INFO: "INFO";
}>;
export type Severity = z.infer<typeof Severity>;
export declare const Incident: z.ZodObject<{
    id: z.ZodString;
    severity: z.ZodEnum<{
        CRITICAL: "CRITICAL";
        WARNING: "WARNING";
        INFO: "INFO";
    }>;
    component: z.ZodString;
    evidence: z.ZodArray<z.ZodString>;
    suggestedAction: z.ZodString;
    timestamp: z.ZodString;
}, z.core.$strip>;
export type Incident = z.infer<typeof Incident>;
export declare const IncidentReport: z.ZodObject<{
    report: z.ZodString;
    incidents: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        severity: z.ZodEnum<{
            CRITICAL: "CRITICAL";
            WARNING: "WARNING";
            INFO: "INFO";
        }>;
        component: z.ZodString;
        evidence: z.ZodArray<z.ZodString>;
        suggestedAction: z.ZodString;
        timestamp: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type IncidentReport = z.infer<typeof IncidentReport>;
