import { getToolHandler } from "@pinot-agents/shared";
export async function runAgentLoop(client, model, messages, tools, maxTurns) {
    const toolCallLog = [];
    for (let turn = 0; turn < maxTurns; turn++) {
        console.log(`[mitigator turn ${turn + 1}/${maxTurns}]`);
        const response = await client.chat.completions.create({
            model,
            messages,
            tools,
        });
        const choice = response.choices[0];
        if (!choice)
            throw new Error("No choice returned from model");
        const assistantMessage = choice.message;
        messages.push(assistantMessage);
        if (choice.finish_reason === "tool_calls" || assistantMessage.tool_calls?.length) {
            const calls = assistantMessage.tool_calls ?? [];
            for (const toolCall of calls) {
                const { name } = toolCall.function;
                const handler = getToolHandler(name);
                if (!handler) {
                    messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Error: unknown tool "${name}"` });
                    toolCallLog.push({ name, args: {}, result: `Error: unknown tool "${name}"` });
                    continue;
                }
                let args;
                try {
                    args = JSON.parse(toolCall.function.arguments);
                }
                catch {
                    messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Error: invalid JSON arguments" });
                    toolCallLog.push({ name, args: {}, result: "Error: invalid JSON arguments" });
                    continue;
                }
                console.log(`  → ${name}(${JSON.stringify(args)})`);
                try {
                    const result = await handler(args);
                    messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
                    toolCallLog.push({ name, args, result });
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    const errorResult = `Error executing ${name}: ${msg}`;
                    messages.push({ role: "tool", tool_call_id: toolCall.id, content: errorResult });
                    toolCallLog.push({ name, args, result: errorResult });
                }
            }
            continue;
        }
        return { response: assistantMessage.content ?? "", toolCalls: toolCallLog };
    }
    return { response: "Mitigator reached maximum turns without completing.", toolCalls: toolCallLog };
}
