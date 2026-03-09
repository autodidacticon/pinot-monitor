const attempts = new Map();
function makeKey(runbookId, component) {
    return `${runbookId}:${component}`;
}
export function canAttempt(runbookId, component, maxRetries, cooldownMs) {
    const key = makeKey(runbookId, component);
    const record = attempts.get(key);
    if (!record)
        return true;
    // Cooldown elapsed — reset
    if (Date.now() - record.lastAttemptAt > cooldownMs) {
        attempts.delete(key);
        return true;
    }
    return record.attempts < maxRetries;
}
export function recordAttempt(runbookId, component, cooldownMs) {
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
export function getAttemptCount(runbookId, component) {
    const key = makeKey(runbookId, component);
    return attempts.get(key)?.attempts ?? 0;
}
