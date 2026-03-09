import { z } from "zod";
const registry = new Map();
/**
 * Define a tool with an OpenAI function-calling spec and a handler.
 * Uses Zod 4's built-in toJsonSchema() for schema conversion,
 * and Zod at runtime to validate arguments before calling the handler.
 */
export function defineTool(name, description, schema, handler) {
    const { $schema, ...parameters } = z.toJSONSchema(schema);
    const def = {
        spec: {
            type: "function",
            function: {
                name,
                description,
                parameters: parameters,
            },
        },
        handler: async (rawArgs) => {
            const parsed = schema.parse(rawArgs);
            return handler(parsed);
        },
    };
    registry.set(name, def);
    return def;
}
/** All registered tool specs for the OpenAI API `tools` parameter. */
export function getToolSpecs() {
    return Array.from(registry.values()).map((t) => t.spec);
}
/** Look up a tool handler by name. */
export function getToolHandler(name) {
    return registry.get(name)?.handler;
}
