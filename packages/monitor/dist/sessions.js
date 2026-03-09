import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { CHAT_SYSTEM_PROMPT } from "./prompts/monitor.js";
const sessions = new Map();
/** Get an existing session or create a new one. Returns the session. */
export function getOrCreateSession(sessionId) {
    if (sessionId) {
        const existing = sessions.get(sessionId);
        if (existing) {
            if (Date.now() - existing.lastAccessedAt > config.session.ttlMs) {
                // Expired — remove and create fresh
                sessions.delete(sessionId);
            }
            else {
                existing.lastAccessedAt = Date.now();
                return existing;
            }
        }
    }
    const id = sessionId ?? randomUUID();
    const session = {
        id,
        messages: [{ role: "system", content: CHAT_SYSTEM_PROMPT }],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };
    sessions.set(id, session);
    return session;
}
/** Lazily purge expired sessions. Call periodically. */
export function purgeExpired() {
    const now = Date.now();
    let purged = 0;
    for (const [id, session] of sessions) {
        if (now - session.lastAccessedAt > config.session.ttlMs) {
            sessions.delete(id);
            purged++;
        }
    }
    return purged;
}
export function sessionCount() {
    return sessions.size;
}
