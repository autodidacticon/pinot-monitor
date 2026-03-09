interface AttemptRecord {
  runbookId: string;
  incidentKey: string;
  attempts: number;
  lastAttemptAt: number;
  cooldownMs: number;
}

const attempts = new Map<string, AttemptRecord>();

function makeKey(runbookId: string, component: string): string {
  return `${runbookId}:${component}`;
}

export function canAttempt(runbookId: string, component: string, maxRetries: number, cooldownMs: number): boolean {
  const key = makeKey(runbookId, component);
  const record = attempts.get(key);
  if (!record) return true;

  // Cooldown elapsed — reset
  if (Date.now() - record.lastAttemptAt > cooldownMs) {
    attempts.delete(key);
    return true;
  }

  return record.attempts < maxRetries;
}

export function recordAttempt(runbookId: string, component: string, cooldownMs: number): number {
  const key = makeKey(runbookId, component);
  const record = attempts.get(key);
  if (record) {
    record.attempts++;
    record.lastAttemptAt = Date.now();
    return record.attempts;
  }
  attempts.set(key, {
    runbookId,
    incidentKey: key,
    attempts: 1,
    lastAttemptAt: Date.now(),
    cooldownMs,
  });
  return 1;
}

export function getAttemptCount(runbookId: string, component: string): number {
  const key = makeKey(runbookId, component);
  return attempts.get(key)?.attempts ?? 0;
}
