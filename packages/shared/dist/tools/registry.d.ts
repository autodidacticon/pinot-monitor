import { z } from "zod";
import type { ChatCompletionTool } from "openai/resources/chat/completions.js";
export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;
export interface ToolDefinition {
    spec: ChatCompletionTool;
    handler: ToolHandler;
}
/**
 * Define a tool with an OpenAI function-calling spec and a handler.
 * Uses Zod 4's built-in toJsonSchema() for schema conversion,
 * and Zod at runtime to validate arguments before calling the handler.
 */
export declare function defineTool<T extends z.ZodType>(name: string, description: string, schema: T, handler: (args: z.infer<T>) => Promise<string>): ToolDefinition;
/** All registered tool specs for the OpenAI API `tools` parameter. */
export declare function getToolSpecs(): ChatCompletionTool[];
/** Look up a tool handler by name. */
export declare function getToolHandler(name: string): ToolHandler | undefined;
