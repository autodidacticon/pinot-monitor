// Phase 2: Self-improvement loop — track unhandled failure patterns
import { randomUUID } from "node:crypto";
import type { Incident } from "@pinot-agents/shared";

export interface NovelIncident {
  id: string;
  pattern: string;
  component: string;
  severity: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  examples: Array<{ timestamp: string; evidence: string[] }>;
  status: "new" | "acknowledged" | "runbook_created";
}

const novelIncidents = new Map<string, NovelIncident>();
const MAX_EXAMPLES = 5;

function buildPattern(incident: Incident): string {
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

export function recordNovelIncident(incident: Incident): NovelIncident {
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

  const novel: NovelIncident = {
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

export function getNovelIncidents(): NovelIncident[] {
  return Array.from(novelIncidents.values()).sort(
    (a, b) => b.occurrences - a.occurrences,
  );
}

export function acknowledgeNovelIncident(id: string): boolean {
  for (const incident of novelIncidents.values()) {
    if (incident.id === id) {
      incident.status = "acknowledged";
      return true;
    }
  }
  return false;
}

export function markRunbookCreated(id: string): boolean {
  for (const incident of novelIncidents.values()) {
    if (incident.id === id) {
      incident.status = "runbook_created";
      return true;
    }
  }
  return false;
}
