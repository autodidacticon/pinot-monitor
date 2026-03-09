import type OpenAI from "openai";
export interface Session {
    id: string;
    messages: OpenAI.ChatCompletionMessageParam[];
    createdAt: number;
    lastAccessedAt: number;
}
/** Get an existing session or create a new one. Returns the session. */
export declare function getOrCreateSession(sessionId?: string): Session;
/** Lazily purge expired sessions. Call periodically. */
export declare function purgeExpired(): number;
export declare function sessionCount(): number;
