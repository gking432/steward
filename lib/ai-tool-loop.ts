/** Stateless Responses tool loop. Provider transport is injected for meaningful timeout/tool tests. */
export type FunctionTool = {
  type: "function";
  name: string;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
};
type Output = {
  type: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  content?: { type: string; text?: string }[];
};
type ProviderResult = {
  status: string;
  id: string;
  model: string;
  output: Output[];
  usage?: { input_tokens?: number; output_tokens?: number };
};
export async function runToolLoop(
  input: unknown,
  instructions: string,
  tools: FunctionTool[],
  execute: (name: string, args: unknown) => unknown,
  request: (body: Record<string, unknown>) => Promise<ProviderResult>,
) {
  const history: unknown[] = [
    { role: "developer", content: instructions },
    { role: "user", content: JSON.stringify(input) },
  ];
  const trace: string[] = [],
    responses: string[] = [];
  let inputTokens = 0,
    outputTokens = 0;
  for (let round = 0; round < 4; round++) {
    const result = await request({
      input: history,
      tools,
      parallel_tool_calls: false,
      tool_choice: round === 3 ? "none" : "auto",
    });
    if (result.status !== "completed")
      throw Error("Incomplete provider response");
    responses.push(result.id);
    inputTokens += result.usage?.input_tokens ?? 0;
    outputTokens += result.usage?.output_tokens ?? 0;
    history.push(...result.output);
    const calls = result.output.filter((o) => o.type === "function_call");
    if (!calls.length) {
      const message =
        result.output
          .flatMap((o) => o.content ?? [])
          .find((o) => o.type === "output_text")?.text ?? "";
      return {
        message,
        trace,
        model: result.model,
        responseId: result.id,
        responseIds: responses,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      };
    }
    for (const call of calls) {
      if (
        !call.name ||
        !tools.some((t) => t.name === call.name) ||
        trace.length >= 6
      )
        throw Error("Unsupported tool or call limit");
      const output = execute(call.name, JSON.parse(call.arguments ?? "{}"));
      trace.push(call.name);
      history.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(output),
      });
    }
  }
  throw Error("Tool round limit");
}
