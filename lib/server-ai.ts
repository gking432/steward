import { env } from "cloudflare:workers";
import { acquireGeneration } from "./request-limits";

export async function structuredConversation(
  input: unknown,
  schema: Record<string, unknown>,
  instructions: string,
) {
  const runtime = env as unknown as Record<string, string | undefined>;
  if (runtime.STEWARD_AI_ENABLED !== "true" || !runtime.OPENAI_API_KEY)
    return null;
  const release = acquireGeneration(true);
  if (!release) return null;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        authorization: `Bearer ${runtime.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: runtime.OPENAI_MODEL ?? "gpt-5.6-sol",
        store: false,
        max_output_tokens: 2400,
        reasoning: { effort: "low" },
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "steward_conversation",
            strict: true,
            schema,
          },
        },
        input: [
          { role: "developer", content: instructions },
          { role: "user", content: JSON.stringify(input) },
        ],
      }),
    });
    if (!response.ok) {
      console.warn("Steward conversation provider status", response.status);
      return null;
    }
    const result = await response.json();
    if (result.status !== "completed") return null;
    const text = result.output
      ?.flatMap(
        (item: { content?: { type: string; text?: string }[] }) =>
          item.content ?? [],
      )
      .find((item: { type: string }) => item.type === "output_text")?.text;
    if (!text) return null;
    return {
      data: JSON.parse(text),
      model: result.model as string,
      responseId: result.id as string,
      usage: result.usage,
    };
  } catch (error) {
    console.warn(
      "Steward conversation unavailable",
      error instanceof Error ? error.name : "error",
    );
    return null;
  } finally {
    release();
  }
}

/** The model can invoke session-only tools. No tool has persistence credentials. */
export async function planningConversation(
  input: unknown,
  instructions: string,
  tools: import("./ai-tool-loop").FunctionTool[],
  execute: (name: string, args: unknown) => unknown,
) {
  const runtime = env as unknown as Record<string, string | undefined>;
  if (runtime.STEWARD_AI_ENABLED !== "true" || !runtime.OPENAI_API_KEY)
    return null;
  const release = acquireGeneration(true);
  if (!release) return null;
  const signal = AbortSignal.timeout(40000);
  try {
    const { runToolLoop } = await import("./ai-tool-loop");
    return await runToolLoop(
      input,
      instructions,
      tools,
      execute,
      async (body) => {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          signal,
          headers: {
            authorization: `Bearer ${runtime.OPENAI_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: runtime.OPENAI_MODEL ?? "gpt-5.6-sol",
            store: false,
            max_output_tokens: 2400,
            reasoning: { effort: "low" },
            text: { verbosity: "low" },
            ...body,
          }),
        });
        if (!response.ok) throw Error(`Provider status ${response.status}`);
        return response.json();
      },
    );
  } catch (error) {
    console.warn(
      "Steward planning unavailable",
      error instanceof Error ? error.message : "error",
    );
    return null;
  } finally {
    release();
  }
}
