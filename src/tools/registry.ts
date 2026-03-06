import { z } from "zod";
import type { ChatCompletionTool } from "openai/resources/chat/completions.js";

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface ToolDefinition {
  spec: ChatCompletionTool;
  handler: ToolHandler;
}

const registry = new Map<string, ToolDefinition>();

/**
 * Define a tool with an OpenAI function-calling spec and a handler.
 * Uses Zod 4's built-in toJsonSchema() for schema conversion,
 * and Zod at runtime to validate arguments before calling the handler.
 */
export function defineTool<T extends z.ZodType>(
  name: string,
  description: string,
  schema: T,
  handler: (args: z.infer<T>) => Promise<string>,
): ToolDefinition {
  const { $schema, ...parameters } = z.toJSONSchema(schema) as Record<string, unknown>;

  const def: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name,
        description,
        parameters: parameters as ChatCompletionTool["function"]["parameters"],
      },
    },
    handler: async (rawArgs: Record<string, unknown>) => {
      const parsed = schema.parse(rawArgs);
      return handler(parsed);
    },
  };

  registry.set(name, def);
  return def;
}

/** All registered tool specs for the OpenAI API `tools` parameter. */
export function getToolSpecs(): ChatCompletionTool[] {
  return Array.from(registry.values()).map((t) => t.spec);
}

/** Look up a tool handler by name. */
export function getToolHandler(name: string): ToolHandler | undefined {
  return registry.get(name)?.handler;
}
