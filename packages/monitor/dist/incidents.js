import { randomUUID } from "node:crypto";
import { Incident as IncidentSchema } from "@pinot-agents/shared";
const MAX_INCIDENTS = 500;
const incidentStore = [];
/** Counter for incidents dropped due to validation failures. */
let droppedIncidentCount = 0;
export function getDroppedIncidentCount() {
    return droppedIncidentCount;
}
/** Validate a single incident against the schema and business rules. Returns null if invalid. */
function validateIncident(raw) {
    // Validate against Zod schema
    const result = IncidentSchema.safeParse(raw);
    if (!result.success) {
        console.warn(JSON.stringify({
            level: "validation",
            action: "dropped_invalid_incident",
            reason: result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "),
            raw,
        }));
        droppedIncidentCount++;
        return null;
    }
    const incident = result.data;
    // Validate component is non-empty
    if (!incident.component.trim()) {
        console.warn(JSON.stringify({
            level: "validation",
            action: "dropped_invalid_incident",
            reason: "component is empty",
            raw,
        }));
        droppedIncidentCount++;
        return null;
    }
    // Validate evidence is non-empty
    if (incident.evidence.length === 0) {
        console.warn(JSON.stringify({
            level: "validation",
            action: "dropped_invalid_incident",
            reason: "evidence array is empty",
            raw,
        }));
        droppedIncidentCount++;
        return null;
    }
    return incident;
}
/** Store incidents from a sweep. Trims to MAX_INCIDENTS. */
export function storeIncidents(incidents) {
    incidentStore.push(...incidents);
    if (incidentStore.length > MAX_INCIDENTS) {
        incidentStore.splice(0, incidentStore.length - MAX_INCIDENTS);
    }
}
/** Retrieve recent incidents, optionally filtered by severity. */
export function getIncidents(severity) {
    if (severity) {
        return incidentStore.filter((i) => i.severity === severity);
    }
    return [...incidentStore];
}
/** Parse incidents from the LLM response. Expects a JSON block with incidents array. */
export function parseIncidents(response) {
    // Look for a JSON code block containing incidents
    const jsonBlockMatch = response.match(/```json\s*\n([\s\S]*?)\n\s*```/);
    if (!jsonBlockMatch) {
        return extractFromReport(response);
    }
    try {
        const parsed = JSON.parse(jsonBlockMatch[1]);
        const raw = Array.isArray(parsed) ? parsed : parsed.incidents;
        if (!Array.isArray(raw))
            return [];
        return raw.map(normalizeIncident).filter((i) => validateIncident(i) !== null);
    }
    catch {
        return extractFromReport(response);
    }
}
/** Fallback: extract incidents from the text report's Issues section. */
function extractFromReport(response) {
    const incidents = [];
    // Determine overall status to decide severity
    const statusMatch = response.match(/Overall Status:\s*(HEALTHY|DEGRADED|CRITICAL)/i);
    const overallStatus = statusMatch?.[1]?.toUpperCase();
    if (overallStatus === "HEALTHY")
        return [];
    // Look for the Issues section
    const issuesMatch = response.match(/── Issues ──+\n([\s\S]*?)(?=\n── |═{3,})/);
    if (!issuesMatch)
        return [];
    const issuesText = issuesMatch[1].trim();
    if (/none detected/i.test(issuesText))
        return [];
    // Each line starting with - or * or a number is an issue
    const lines = issuesText.split("\n").filter((l) => /^\s*[-*\d]/.test(l));
    for (const line of lines) {
        const text = line.replace(/^\s*[-*\d.)\s]+/, "").trim();
        if (!text)
            continue;
        incidents.push({
            id: randomUUID(),
            severity: overallStatus === "CRITICAL" ? "CRITICAL" : "WARNING",
            component: guessComponent(text),
            evidence: [text],
            suggestedAction: "",
            timestamp: new Date().toISOString(),
        });
    }
    return incidents.filter((i) => validateIncident(i) !== null);
}
function guessComponent(text) {
    const lower = text.toLowerCase();
    if (lower.includes("controller"))
        return "pinot-controller";
    if (lower.includes("broker"))
        return "pinot-broker";
    if (lower.includes("server"))
        return "pinot-server";
    if (lower.includes("segment"))
        return "pinot-segments";
    if (lower.includes("zookeeper"))
        return "zookeeper";
    if (lower.includes("pod") || lower.includes("crash"))
        return "kubernetes";
    return "unknown";
}
function normalizeIncident(raw) {
    return {
        id: raw.id ?? randomUUID(),
        severity: (["CRITICAL", "WARNING", "INFO"].includes(raw.severity)
            ? raw.severity
            : "WARNING"),
        component: raw.component ?? "unknown",
        evidence: Array.isArray(raw.evidence) ? raw.evidence.map(String) : [],
        suggestedAction: raw.suggestedAction ?? "",
        timestamp: raw.timestamp ?? new Date().toISOString(),
    };
}
