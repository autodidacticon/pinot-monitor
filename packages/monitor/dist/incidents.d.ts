import type { Incident, Severity } from "@pinot-agents/shared";
export declare function getDroppedIncidentCount(): number;
/** Store incidents from a sweep. Trims to MAX_INCIDENTS. */
export declare function storeIncidents(incidents: Incident[]): void;
/** Retrieve recent incidents, optionally filtered by severity. */
export declare function getIncidents(severity?: Severity): Incident[];
/** Parse incidents from the LLM response. Expects a JSON block with incidents array. */
export declare function parseIncidents(response: string): Incident[];
