// Phase 2: Self-improvement loop — track unhandled failure patterns
import { randomUUID } from "node:crypto";
const novelIncidents = new Map();
const MAX_EXAMPLES = 5;
function buildPattern(incident) {
    const keywords = incident.evidence
        .join(" ")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 5)
        .sort()
        .join("_");
    return `${incident.component}:${keywords}`;
}
export function recordNovelIncident(incident) {
    const pattern = buildPattern(incident);
    const now = new Date().toISOString();
    const existing = novelIncidents.get(pattern);
    if (existing) {
        existing.occurrences++;
        existing.lastSeen = now;
        if (existing.examples.length < MAX_EXAMPLES) {
            existing.examples.push({ timestamp: now, evidence: incident.evidence });
        }
        console.log(`[NOVEL] Recurring unhandled pattern: ${pattern} (${existing.occurrences} occurrences)`);
        return existing;
    }
    const novel = {
        id: randomUUID(),
        pattern,
        component: incident.component,
        severity: incident.severity,
        occurrences: 1,
        firstSeen: now,
        lastSeen: now,
        examples: [{ timestamp: now, evidence: incident.evidence }],
        status: "new",
    };
    novelIncidents.set(pattern, novel);
    console.log(`[NOVEL] New unhandled pattern detected: ${pattern}`);
    return novel;
}
export function getNovelIncidents() {
    return Array.from(novelIncidents.values()).sort((a, b) => b.occurrences - a.occurrences);
}
export function acknowledgeNovelIncident(id) {
    for (const incident of novelIncidents.values()) {
        if (incident.id === id) {
            incident.status = "acknowledged";
            return true;
        }
    }
    return false;
}
export function markRunbookCreated(id) {
    for (const incident of novelIncidents.values()) {
        if (incident.id === id) {
            incident.status = "runbook_created";
            return true;
        }
    }
    return false;
}
