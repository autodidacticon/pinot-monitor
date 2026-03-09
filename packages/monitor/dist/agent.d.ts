import type OpenAI from "openai";
export interface ToolCallLog {
    name: string;
    args: Record<string, unknown>;
    result: string;
}
export interface AgentLoopResult {
    response: string;
    toolCalls: ToolCallLog[];
}
/**
 * Run the agent loop: repeatedly call the model, handle tool calls,
 * until the model stops or maxTurns is reached.
 *
 * Mutates `messages` in place (appends assistant and tool messages).
 */
export declare function runAgentLoop(client: OpenAI, model: string, messages: OpenAI.ChatCompletionMessageParam[], tools: OpenAI.ChatCompletionTool[], maxTurns: number): Promise<AgentLoopResult>;
