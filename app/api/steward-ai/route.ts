import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  DEVELOPER_PROMPT,
  allowedNumerals,
  fallbackIntent,
  fallbackPhrase,
  outputIsGrounded,
  type IntentDraft,
} from "../../../lib/model/ai";

/**
 * The only AI endpoint. Two narrow modes, both with deterministic fallbacks.
 *
 * The response always carries a usable result. `enhanced: false` means the
 * caller is looking at the deterministic answer — which is a normal outcome,
 * not an error, and is what happens with no API key configured.
 */

export const dynamic = "force-dynamic";

const phraseSchema = z.object({
  kind: z.literal("phrase"),
  headline: z.string().min(1).max(200),
  verdict: z.string().min(1).max(600),
  tradeoff: z.string().max(600),
  checks: z
    .array(z.object({ label: z.string().max(80), detail: z.string().max(400) }))
    .max(8),
});

const intentSchema = z.object({
  kind: z.literal("intent"),
  utterance: z.string().min(1).max(500),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const requestSchema = z.discriminatedUnion("kind", [phraseSchema, intentSchema]);

const intentOutput = z.object({
  name: z.string().max(120),
  amount: z.number().finite().nonnegative().nullable(),
  wantBy: z.string().max(20).nullable(),
  kind: z.enum(["purchase", "fund", "payoff", "commitment"]),
});

async function callModel(input: unknown, schema: Record<string, unknown>) {
  const runtime = env as unknown as Record<string, string | undefined>;
  const apiKey = runtime.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: runtime.OPENAI_MODEL ?? "gpt-5.6-luna",
        reasoning: { effort: "low" },
        text: { verbosity: "low", format: { type: "json_schema", name: "steward", strict: true, schema } },
        input: [
          { role: "developer", content: DEVELOPER_PROMPT },
          { role: "user", content: JSON.stringify(input) },
        ],
        store: false,
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      output_text?: string;
      output?: { content?: { type?: string; text?: string }[] }[];
    };
    const text =
      payload.output_text ??
      payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const input = parsed.data;

  if (input.kind === "phrase") {
    const deterministic = fallbackPhrase(input);
    const result = await callModel(
      {
        task: "Restate this verdict in at most two sentences.",
        verdict: input.headline,
        reasoning: input.checks,
        tradeoff: input.tradeoff,
      },
      {
        type: "object",
        additionalProperties: false,
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    );

    const text = (result as { text?: string } | null)?.text;
    if (!text) return Response.json({ enhanced: false, text: deterministic });

    // Rule 2: any figure Steward did not compute discards the whole response.
    const allowed = allowedNumerals([
      input.headline,
      input.tradeoff,
      ...input.checks.map((check) => check.detail),
    ]);
    if (!outputIsGrounded(text, allowed)) {
      return Response.json({ enhanced: false, text: deterministic, rejected: "ungrounded" });
    }
    return Response.json({ enhanced: true, text });
  }

  // Intent capture. The model only proposes a draft; the user confirms it.
  const deterministic = fallbackIntent(input.utterance, input.today);
  const result = await callModel(
    {
      task: "Extract what the user wants to work toward. Do not invent an amount.",
      utterance: input.utterance,
      today: input.today,
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        amount: { type: ["number", "null"] },
        wantBy: { type: ["string", "null"] },
        kind: { type: "string", enum: ["purchase", "fund", "payoff", "commitment"] },
      },
      required: ["name", "amount", "wantBy", "kind"],
    },
  );

  const draft = intentOutput.safeParse(result);
  if (!draft.success) {
    return Response.json({ enhanced: false, draft: deterministic });
  }
  // An amount the user never said is an invented figure, so it is dropped.
  const allowed = allowedNumerals([input.utterance]);
  const grounded: IntentDraft = {
    ...draft.data,
    amount:
      draft.data.amount !== null && allowed.has(String(draft.data.amount))
        ? draft.data.amount
        : (deterministic?.amount ?? null),
  };
  return Response.json({ enhanced: true, draft: grounded });
}
