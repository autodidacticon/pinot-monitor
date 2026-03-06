import type OpenAI from "openai";
import { getToolHandler } from "./tools/registry.js";

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
export async function runAgentLoop(
  client: OpenAI,
  model: string,
  messages: OpenAI.ChatCompletionMessageParam[],
  tools: OpenAI.ChatCompletionTool[],
  maxTurns: number,
): Promise<AgentLoopResult> {
  const toolCallLog: ToolCallLog[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    console.log(`[turn ${turn + 1}/${maxTurns}]`);

    const response = await client.chat.completions.create({
      model,
      messages,
      tools,
    });

    const choice = response.choices[0];
    if (!choice) {
      throw new Error("No choice returned from model");
    }

    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    if (choice.finish_reason === "tool_calls" || assistantMessage.tool_calls?.length) {
      const calls = assistantMessage.tool_calls ?? [];

      for (const toolCall of calls) {
        const { name } = toolCall.function;
        const handler = getToolHandler(name);

        if (!handler) {
          console.error(`Unknown tool: ${name}`);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Error: unknown tool "${name}"`,
          });
          toolCallLog.push({ name, args: {}, result: `Error: unknown tool "${name}"` });
          continue;
        }

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          console.error(`Invalid JSON args for ${name}: ${toolCall.function.arguments}`);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: "Error: invalid JSON arguments",
          });
          toolCallLog.push({ name, args: {}, result: "Error: invalid JSON arguments" });
          continue;
        }

        console.log(`  → ${name}(${JSON.stringify(args)})`);

        try {
          const result = await handler(args);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: result,
          });
          toolCallLog.push({ name, args, result });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  ✗ ${name} failed: ${msg}`);
          const errorResult = `Error executing ${name}: ${msg}`;
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: errorResult,
          });
          toolCallLog.push({ name, args, result: errorResult });
        }
      }

      continue; // Next turn — model will process tool results
    }

    // Model finished (stop or unexpected reason)
    if (choice.finish_reason !== "stop") {
      console.warn(`Unexpected finish_reason: ${choice.finish_reason}`);
    }

    return {
      response: assistantMessage.content ?? "",
      toolCalls: toolCallLog,
    };
  }

  // Exhausted maxTurns
  return {
    response: "Agent reached maximum turns without completing.",
    toolCalls: toolCallLog,
  };
}
