import { z } from "zod";
export declare const MessageType: z.ZodEnum<{
    incident: "incident";
    dispatch: "dispatch";
    verify: "verify";
    verify_result: "verify_result";
    audit: "audit";
    alert: "alert";
}>;
export type MessageType = z.infer<typeof MessageType>;
export declare const AgentName: z.ZodEnum<{
    monitor: "monitor";
    mitigator: "mitigator";
    operator: "operator";
}>;
export type AgentName = z.infer<typeof AgentName>;
export declare const AgentMessage: z.ZodObject<{
    from: z.ZodEnum<{
        monitor: "monitor";
        mitigator: "mitigator";
        operator: "operator";
    }>;
    to: z.ZodEnum<{
        monitor: "monitor";
        mitigator: "mitigator";
        operator: "operator";
    }>;
    type: z.ZodEnum<{
        incident: "incident";
        dispatch: "dispatch";
        verify: "verify";
        verify_result: "verify_result";
        audit: "audit";
        alert: "alert";
    }>;
    correlationId: z.ZodString;
    timestamp: z.ZodString;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$strip>;
export type AgentMessage = z.infer<typeof AgentMessage>;
export declare const IncidentMessage: z.ZodObject<{
    from: z.ZodEnum<{
        monitor: "monitor";
        mitigator: "mitigator";
        operator: "operator";
    }>;
    to: z.ZodEnum<{
        monitor: "monitor";
        mitigator: "mitigator";
        operator: "operator";
    }>;
    correlationId: z.ZodString;
    timestamp: z.ZodString;
    type: z.ZodLiteral<"incident">;
    payload: z.ZodObject<{
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
        sweepReport: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type IncidentMessage = z.infer<typeof IncidentMessage>;
export declare const DispatchMessage: z.ZodObject<{
    from: z.ZodEnum<{
        monitor: "monitor";
        mitigator: "mitigator";
        operator: "operator";
    }>;
    to: z.ZodEnum<{
        monitor: "monitor";
        mitigator: "mitigator";
        operator: "operator";
    }>;
    correlationId: z.ZodString;
    timestamp: z.ZodString;
    type: z.ZodLiteral<"dispatch">;
    payload: z.ZodObject<{
        incident: z.ZodObject<{
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
        runbookId: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export type DispatchMessage = z.infer<typeof DispatchMessage>;
export declare const VerifyMessage: z.ZodObject<{
    from: z.ZodEnum<{
        monitor: "monitor";
        mitigator: "mitigator";
        operator: "operator";
    }>;
    to: z.ZodEnum<{
        monitor: "monitor";
        mitigator: "mitigator";
        operator: "operator";
    }>;
    correlationId: z.ZodString;
    timestamp: z.ZodString;
    type: z.ZodLiteral<"verify">;
    payload: z.ZodObject<{
        check: z.ZodString;
        context: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type VerifyMessage = z.infer<typeof VerifyMessage>;
export declare const VerifyResultMessage: z.ZodObject<{
    from: z.ZodEnum<{
        monitor: "monitor";
        mitigator: "mitigator";
        operator: "operator";
    }>;
    to: z.ZodEnum<{
        monitor: "monitor";
        mitigator: "mitigator";
        operator: "operator";
    }>;
    correlationId: z.ZodString;
    timestamp: z.ZodString;
    type: z.ZodLiteral<"verify_result">;
    payload: z.ZodObject<{
        passed: z.ZodBoolean;
        details: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export type VerifyResultMessage = z.infer<typeof VerifyResultMessage>;
export declare const AuditMessage: z.ZodObject<{
    from: z.ZodEnum<{
        monitor: "monitor";
        mitigator: "mitigator";
        operator: "operator";
    }>;
    to: z.ZodEnum<{
        monitor: "monitor";
        mitigator: "mitigator";
        operator: "operator";
    }>;
    correlationId: z.ZodString;
    timestamp: z.ZodString;
    type: z.ZodLiteral<"audit">;
    payload: z.ZodObject<{
        action: z.ZodString;
        target: z.ZodString;
        inputSummary: z.ZodString;
        outputSummary: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export type AuditMessage = z.infer<typeof AuditMessage>;
export declare const AlertMessage: z.ZodObject<{
    from: z.ZodEnum<{
        monitor: "monitor";
        mitigator: "mitigator";
        operator: "operator";
    }>;
    to: z.ZodEnum<{
        monitor: "monitor";
        mitigator: "mitigator";
        operator: "operator";
    }>;
    correlationId: z.ZodString;
    timestamp: z.ZodString;
    type: z.ZodLiteral<"alert">;
    payload: z.ZodObject<{
        severity: z.ZodEnum<{
            CRITICAL: "CRITICAL";
            WARNING: "WARNING";
        }>;
        summary: z.ZodString;
        incident: z.ZodOptional<z.ZodObject<{
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
}, z.core.$strip>;
export type AlertMessage = z.infer<typeof AlertMessage>;
