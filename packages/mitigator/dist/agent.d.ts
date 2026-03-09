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
export declare function runAgentLoop(client: OpenAI, model: string, messages: OpenAI.ChatCompletionMessageParam[], tools: OpenAI.ChatCompletionTool[], maxTurns: number): Promise<AgentLoopResult>;
