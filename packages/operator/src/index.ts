import http from "node:http";
import { randomUUID } from "node:crypto";
import { Incident as IncidentSchema } from "@pinot-agents/shared";
import type { Incident } from "@pinot-agents/shared";
import { MetricsRegistry, registerGracefulShutdown, SlidingWindowRateLimiter } from "@pinot-agents/shared";
import { config } from "./config.js";
import { matchRunbook } from "./runbooks/definitions.js";
import { canAttempt, recordAttempt } from "./circuit-breaker.js";
import { logAudit, getAuditLog } from "./audit.js";
import { recordNovelIncident, getNovelIncidents, acknowledgeNovelIncident } from "./novel-incidents.js";
import { persistAuditEntry } from "./audit-persistence.js";

// Metrics
const metrics = new MetricsRegistry();
const incidentsReceived = metrics.counter("operator_incidents_received_total", "Total incidents received");
const incidentsDispatched = metrics.counter("operator_incidents_dispatched_total", "Incidents dispatched to mitigator");
const incidentsNoRunbook = metrics.counter("operator_incidents_no_runbook_total", "Incidents with no matching runbook");
const circuitBreakerTrips = metrics.counter("operator_circuit_breaker_trips_total", "Circuit breaker activations");
const triageLatency = metrics.histogram("operator_triage_duration_seconds", "Triage processing time");
const rateLimitRejections = metrics.counter("operator_rate_limit_rejections_total", "Requests rejected by rate limiter");

// Rate limiter for POST /incident
const incidentRateLimiter = new SlidingWindowRateLimiter({
  maxRequests: config.rateLimit.maxRequests,
  windowMs: config.rateLimit.windowMs,
});

// Blast radius controls: track active remediations per component
const MAX_CONCURRENT_REMEDIATIONS = parseInt(process.env.MAX_CONCURRENT_REMEDIATIONS ?? "2", 10);
const activeRemediations = new Map<string, { correlationId: string; runbookId: string; startedAt: string }>();

// Pending approvals for human review checkpoint
interface PendingApproval {
  id: string;
  incident: Incident;
  runbookId: string;
  correlationId: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
}
const pendingApprovals = new Map<string, PendingApproval>();

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

async function dispatchToMitigator(
  incident: Incident,
  runbookId: string,
  correlationId: string,
): Promise<{ success: boolean; message: string }> {
  // Fire-and-forget: send dispatch to mitigator with a short timeout.
  // The mitigator processes LLM calls synchronously (can take minutes),
  // so we don't wait for completion. The mitigator sends an audit callback when done.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${config.services.mitigatorUrl}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "operator",
        to: "mitigator",
        type: "dispatch",
        correlationId,
        timestamp: new Date().toISOString(),
        payload: { incident, runbookId },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await res.text();
    if (!res.ok && res.status !== 202) {
      return { success: false, message: `Mitigator returned ${res.status}: ${text}` };
    }
    return { success: true, message: text };
  } catch (err: unknown) {
    clearTimeout(timeout);
    // AbortError means timeout — mitigator accepted the request but is still processing
    if (err instanceof Error && err.name === "AbortError") {
      return { success: true, message: "Dispatch accepted (mitigator processing async)" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Failed to reach mitigator: ${msg}` };
  }
}

async function sendAlert(incident: Incident, reason: string): Promise<void> {
  console.log(`[ALERT] ${reason} — ${incident.severity} on ${incident.component}: ${incident.evidence.join("; ")}`);
  if (config.alerts.webhookUrl) {
    try {
      await fetch(config.alerts.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incident, reason, timestamp: new Date().toISOString() }),
      });
    } catch {
      console.error("[ALERT] Failed to send webhook");
    }
  }
}

// Pre-dispatch cluster state verification via monitor /chat endpoint
async function verifyIncidentState(incident: Incident): Promise<{ confirmed: boolean; reason: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.verifyTimeoutMs);
  try {
    const res = await fetch(`${config.services.monitorUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Is ${incident.component} currently experiencing issues? Check quickly and respond with JSON only: {"confirmed": true/false, "reason": "..."}`,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      // Non-OK response — fail open, proceed with dispatch
      return { confirmed: true, reason: `Monitor returned HTTP ${res.status}, proceeding with dispatch` };
    }
    const text = await res.text();
    // Try to extract JSON from the response (LLM may wrap it in markdown or extra text)
    const jsonMatch = text.match(/\{[\s\S]*?"confirmed"[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { confirmed?: boolean; reason?: string };
        return {
          confirmed: parsed.confirmed !== false,
          reason: parsed.reason ?? "No reason provided",
        };
      } catch {
        // JSON parse failed — fail open
        return { confirmed: true, reason: "Could not parse monitor response, proceeding with dispatch" };
      }
    }
    // No JSON found — fail open
    return { confirmed: true, reason: "Monitor response not in expected format, proceeding with dispatch" };
  } catch (err: unknown) {
    clearTimeout(timeout);
    // Timeout or network error — fail open
    const msg = err instanceof Error ? err.message : String(err);
    return { confirmed: true, reason: `Verification failed (${msg}), proceeding with dispatch` };
  }
}

interface TriageResult {
  action: "dispatched" | "alerted" | "logged" | "circuit_broken" | "suggested" | "stale";
  runbookId?: string;
  message: string;
}

async function triageIncident(incident: Incident): Promise<TriageResult> {
  const startTime = Date.now();
  incidentsReceived.inc();
  const correlationId = randomUUID();

  // Match runbook
  const runbook = matchRunbook(incident.component, incident.evidence, incident.severity);

  if (incident.severity === "INFO") {
    logAudit({
      timestamp: new Date().toISOString(),
      agent: "operator",
      action: "log_info",
      target: incident.component,
      inputSummary: incident.evidence.join("; "),
      outputSummary: "Logged INFO incident, no action needed",
      correlationId,
    });
    return { action: "logged", message: "INFO severity — logged only" };
  }

  if (!runbook) {
    incidentsNoRunbook.inc();
    recordNovelIncident(incident);
    await sendAlert(incident, "No matching runbook");
    const entry = {
      timestamp: new Date().toISOString(),
      agent: "operator",
      action: "alert_no_runbook",
      target: incident.component,
      inputSummary: incident.evidence.join("; "),
      outputSummary: "No runbook found, alerted human",
      correlationId,
    };
    logAudit(entry);
    persistAuditEntry(entry);
    triageLatency.observe((Date.now() - startTime) / 1000);
    return { action: "alerted", message: "No matching runbook — alert sent" };
  }

  // Check circuit breaker
  if (!canAttempt(runbook.id, incident.component, runbook.maxRetries, runbook.cooldownMs)) {
    circuitBreakerTrips.inc();
    if (runbook.escalateAfterRetries) {
      await sendAlert(incident, `Circuit breaker open: ${runbook.id} exhausted ${runbook.maxRetries} retries`);
    }
    const entry = {
      timestamp: new Date().toISOString(),
      agent: "operator",
      action: "circuit_broken",
      target: incident.component,
      inputSummary: `runbook=${runbook.id}`,
      outputSummary: `Max retries (${runbook.maxRetries}) reached, cooldown active`,
      correlationId,
    };
    logAudit(entry);
    persistAuditEntry(entry);
    triageLatency.observe((Date.now() - startTime) / 1000);
    return { action: "circuit_broken", runbookId: runbook.id, message: `Circuit breaker open for ${runbook.id}` };
  }

  // Trust level gate
  if (config.trustLevel < runbook.minTrustLevel) {
    const proposedAction = `runbook=${runbook.id}, actions=${runbook.actions.map(a => a.tool).join("+")}`;

    if (config.trustLevel === 0) {
      // Observe mode — log only
      logAudit({
        timestamp: new Date().toISOString(),
        agent: "operator",
        action: "observe",
        target: incident.component,
        inputSummary: `runbook=${runbook.id}, trustLevel=${config.trustLevel}, required=${runbook.minTrustLevel}`,
        outputSummary: `Observe mode: would run ${proposedAction}`,
        correlationId,
      });
      return { action: "logged", runbookId: runbook.id, message: `Observe mode (trust ${config.trustLevel} < ${runbook.minTrustLevel}): ${proposedAction}` };
    }

    // Trust level 1 or 2 but below required — suggest but do not dispatch
    await sendAlert(incident, `Suggested action (trust ${config.trustLevel} < ${runbook.minTrustLevel}): ${proposedAction}`);
    logAudit({
      timestamp: new Date().toISOString(),
      agent: "operator",
      action: "suggest",
      target: incident.component,
      inputSummary: `runbook=${runbook.id}, trustLevel=${config.trustLevel}, required=${runbook.minTrustLevel}`,
      outputSummary: `Suggested: ${proposedAction}`,
      correlationId,
    });
    return { action: "suggested", runbookId: runbook.id, message: `Suggested (trust ${config.trustLevel} < ${runbook.minTrustLevel}): ${proposedAction}` };
  }

  // Human review checkpoint: if trust level is 2 (approve mode) and severity is CRITICAL, queue for approval
  if (config.trustLevel === 2 && incident.severity === "CRITICAL") {
    const approvalId = randomUUID();
    pendingApprovals.set(approvalId, {
      id: approvalId,
      incident,
      runbookId: runbook.id,
      correlationId,
      createdAt: new Date().toISOString(),
      status: "pending",
    });
    const entry = {
      timestamp: new Date().toISOString(),
      agent: "operator",
      action: "pending_approval",
      target: incident.component,
      inputSummary: `runbook=${runbook.id}, approvalId=${approvalId}`,
      outputSummary: "Queued for human approval (CRITICAL + trust level 2)",
      correlationId,
    };
    logAudit(entry);
    persistAuditEntry(entry);
    triageLatency.observe((Date.now() - startTime) / 1000);
    return { action: "suggested", runbookId: runbook.id, message: `Queued for human approval: ${approvalId}` };
  }

  // Blast radius check: prevent concurrent remediations on the same component
  if (activeRemediations.has(incident.component)) {
    const active = activeRemediations.get(incident.component)!;
    console.log(`[blast-radius] Remediation already in progress for ${incident.component} (correlation=${active.correlationId}, runbook=${active.runbookId})`);
    const entry = {
      timestamp: new Date().toISOString(),
      agent: "operator",
      action: "skipped_active_remediation",
      target: incident.component,
      inputSummary: `runbook=${runbook.id}, activeRunbook=${active.runbookId}`,
      outputSummary: `Remediation already in progress for ${incident.component}`,
      correlationId,
    };
    logAudit(entry);
    triageLatency.observe((Date.now() - startTime) / 1000);
    return { action: "logged", runbookId: runbook.id, message: `Remediation already in progress for ${incident.component}` };
  }

  // Blast radius check: enforce max concurrent remediations
  if (activeRemediations.size >= MAX_CONCURRENT_REMEDIATIONS) {
    console.log(`[blast-radius] Max concurrent remediations reached (${MAX_CONCURRENT_REMEDIATIONS}), skipping ${incident.component}`);
    const entry = {
      timestamp: new Date().toISOString(),
      agent: "operator",
      action: "skipped_max_concurrent",
      target: incident.component,
      inputSummary: `runbook=${runbook.id}, active=${activeRemediations.size}, max=${MAX_CONCURRENT_REMEDIATIONS}`,
      outputSummary: `Max concurrent remediations (${MAX_CONCURRENT_REMEDIATIONS}) reached`,
      correlationId,
    };
    logAudit(entry);
    triageLatency.observe((Date.now() - startTime) / 1000);
    return { action: "logged", runbookId: runbook.id, message: `Max concurrent remediations (${MAX_CONCURRENT_REMEDIATIONS}) reached` };
  }

  // Pre-dispatch verification: confirm incident is still active
  if (config.verifyBeforeDispatch && (incident.severity === "WARNING" || incident.severity === "CRITICAL")) {
    const verification = await verifyIncidentState(incident);
    if (!verification.confirmed) {
      const entry = {
        timestamp: new Date().toISOString(),
        agent: "operator",
        action: "stale_incident",
        target: incident.component,
        inputSummary: `runbook=${runbook.id}, verification=${verification.reason}`,
        outputSummary: "Incident no longer active, skipping dispatch",
        correlationId,
      };
      logAudit(entry);
      persistAuditEntry(entry);
      console.log(`[verify] Incident on ${incident.component} no longer active: ${verification.reason}`);
      triageLatency.observe((Date.now() - startTime) / 1000);
      return { action: "stale", runbookId: runbook.id, message: `Incident no longer active: ${verification.reason}` };
    }
    console.log(`[verify] Incident on ${incident.component} confirmed: ${verification.reason}`);
  }

  // Dispatch to mitigator
  incidentsDispatched.inc();
  const attempt = recordAttempt(runbook.id, incident.component, runbook.cooldownMs);

  // Track active remediation
  activeRemediations.set(incident.component, { correlationId, runbookId: runbook.id, startedAt: new Date().toISOString() });

  const result = await dispatchToMitigator(incident, runbook.id, correlationId);

  // If dispatch failed, remove from active remediations
  if (!result.success) {
    activeRemediations.delete(incident.component);
  }

  const entry = {
    timestamp: new Date().toISOString(),
    agent: "operator",
    action: "dispatch",
    target: incident.component,
    inputSummary: `runbook=${runbook.id}, attempt=${attempt}`,
    outputSummary: result.success ? "Dispatched to mitigator" : `Dispatch failed: ${result.message}`,
    correlationId,
  };
  logAudit(entry);
  persistAuditEntry(entry);
  triageLatency.observe((Date.now() - startTime) / 1000);

  return {
    action: "dispatched",
    runbookId: runbook.id,
    message: result.success ? `Dispatched runbook ${runbook.id} (attempt ${attempt})` : result.message,
  };
}

async function handleIncident(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!incidentRateLimiter.tryAcquire()) {
    rateLimitRejections.inc();
    console.warn(`[rate-limit] Rejected POST /incident (remaining: ${incidentRateLimiter.remaining})`);
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": String(Math.ceil(config.rateLimit.windowMs / 1000)),
    });
    res.end(JSON.stringify({ error: "Rate limit exceeded. Try again later." }));
    return;
  }

  let body: { from?: string; type?: string; payload?: { action?: string; runbookId?: string }; incidents?: Incident[]; incident?: Incident };
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    jsonResponse(res, 400, { error: "Invalid JSON body" });
    return;
  }

  // Handle audit callback from mitigator: clear active remediation for the component
  if (body.from === "mitigator" && body.type === "audit") {
    // Find and clear the active remediation that matches the runbook
    const runbookId = body.payload?.runbookId;
    for (const [component, active] of activeRemediations) {
      if (active.runbookId === runbookId) {
        activeRemediations.delete(component);
        console.log(`[blast-radius] Cleared active remediation for ${component} (runbook=${runbookId})`);
        break;
      }
    }
    jsonResponse(res, 200, { received: true, type: "audit" });
    return;
  }

  const rawIncidents = body.incidents ?? (body.incident ? [body.incident] : []);
  if (rawIncidents.length === 0) {
    jsonResponse(res, 400, { error: "No incidents provided" });
    return;
  }

  // Validate each incident at the system boundary
  const validIncidents: Incident[] = [];
  const validationErrors: { index: number; errors: string[] }[] = [];

  for (let i = 0; i < rawIncidents.length; i++) {
    const parsed = IncidentSchema.safeParse(rawIncidents[i]);
    if (!parsed.success) {
      validationErrors.push({
        index: i,
        errors: parsed.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`),
      });
      continue;
    }
    const incident = parsed.data;
    // Additional business rule checks
    if (!incident.component.trim()) {
      validationErrors.push({ index: i, errors: ["component must be a non-empty string"] });
      continue;
    }
    if (incident.evidence.length === 0) {
      validationErrors.push({ index: i, errors: ["evidence must be a non-empty array"] });
      continue;
    }
    validIncidents.push(incident);
  }

  if (validIncidents.length === 0) {
    jsonResponse(res, 400, {
      error: "All incidents failed validation",
      validationErrors,
    });
    return;
  }

  const results: TriageResult[] = [];
  for (const incident of validIncidents) {
    const result = await triageIncident(incident);
    results.push(result);
  }

  jsonResponse(res, 200, {
    results,
    ...(validationErrors.length > 0 ? { validationErrors } : {}),
  });
}

async function handleAuditLog(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  jsonResponse(res, 200, { entries: getAuditLog() });
}

async function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  jsonResponse(res, 200, { ok: true, agent: "operator" });
}

async function handleApproval(req: http.IncomingMessage, res: http.ServerResponse, approvalId: string, approve: boolean): Promise<void> {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) {
    jsonResponse(res, 404, { error: "Approval not found" });
    return;
  }
  if (pending.status !== "pending") {
    jsonResponse(res, 409, { error: `Already ${pending.status}` });
    return;
  }

  pending.status = approve ? "approved" : "rejected";

  if (approve) {
    incidentsDispatched.inc();
    const result = await dispatchToMitigator(pending.incident, pending.runbookId, pending.correlationId);
    const entry = {
      timestamp: new Date().toISOString(),
      agent: "operator",
      action: "dispatch_approved",
      target: pending.incident.component,
      inputSummary: `runbook=${pending.runbookId}, approvalId=${approvalId}`,
      outputSummary: result.success ? "Dispatched after human approval" : `Dispatch failed: ${result.message}`,
      correlationId: pending.correlationId,
    };
    logAudit(entry);
    persistAuditEntry(entry);
    jsonResponse(res, 200, { status: "approved", dispatch: result });
  } else {
    const entry = {
      timestamp: new Date().toISOString(),
      agent: "operator",
      action: "dispatch_rejected",
      target: pending.incident.component,
      inputSummary: `runbook=${pending.runbookId}, approvalId=${approvalId}`,
      outputSummary: "Rejected by human",
      correlationId: pending.correlationId,
    };
    logAudit(entry);
    persistAuditEntry(entry);
    jsonResponse(res, 200, { status: "rejected" });
  }
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  const path = url?.split("?")[0];

  try {
    if (method === "GET" && path === "/health") {
      await handleHealth(req, res);
    } else if (method === "POST" && path === "/incident") {
      await handleIncident(req, res);
    } else if (method === "GET" && path === "/audit") {
      await handleAuditLog(req, res);
    } else if (method === "GET" && path === "/metrics") {
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
      res.end(metrics.toPrometheus());
    } else if (method === "GET" && path === "/novel-incidents") {
      jsonResponse(res, 200, { incidents: getNovelIncidents() });
    } else if (method === "GET" && path === "/pending-approvals") {
      const pending = Array.from(pendingApprovals.values()).filter((a) => a.status === "pending");
      jsonResponse(res, 200, { approvals: pending });
    } else if (method === "POST" && path?.startsWith("/approve/")) {
      const id = path.slice("/approve/".length);
      await handleApproval(req, res, id, true);
    } else if (method === "POST" && path?.startsWith("/reject/")) {
      const id = path.slice("/reject/".length);
      await handleApproval(req, res, id, false);
    } else {
      jsonResponse(res, 404, { error: "Not found" });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Unhandled error: ${msg}`);
    if (!res.headersSent) {
      jsonResponse(res, 500, { error: "Internal server error" });
    }
  }
});

const TRUST_LABELS = ["observe", "suggest", "approve", "auto-remediate"] as const;

server.listen(config.server.port, () => {
  console.log(`Operator service listening on port ${config.server.port}`);
  console.log(`Trust level: ${config.trustLevel} (${TRUST_LABELS[config.trustLevel]})`);
  console.log(`Rate limit: ${config.rateLimit.maxRequests} req/${config.rateLimit.windowMs}ms`);
  console.log(`Monitor: ${config.services.monitorUrl} | Mitigator: ${config.services.mitigatorUrl}`);
  console.log("Routes: GET /health, POST /incident, GET /audit, GET /metrics, GET /novel-incidents, GET /pending-approvals, POST /approve/:id, POST /reject/:id");
});

registerGracefulShutdown({
  server,
  agentName: "operator",
  forceTimeout: config.shutdownTimeoutMs,
});
