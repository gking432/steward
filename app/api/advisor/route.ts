import { z } from "zod";
import { explainFinancialDecision } from "../../../lib/openai-service";

const requestSchema = z.object({
  prompt: z.string().min(1).max(2_000),
  deterministicAnswer: z.string().min(1).max(4_000),
  context: z.object({
    safeToSpend: z.number().finite(),
    availableCash: z.number().finite(),
    billsBeforePayday: z.number().finite(),
    minimumBuffer: z.number().finite(),
    nextPayday: z.string(),
    goals: z
      .array(
        z.object({
          name: z.string(),
          target: z.number().finite(),
          current: z.number().finite(),
        }),
      )
      .max(20),
    wishlist: z
      .array(
        z.object({
          name: z.string(),
          price: z.number().finite(),
          status: z.string(),
        }),
      )
      .max(30),
  }),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid advisor request." }, { status: 400 });
  }

  try {
    const explanation = await explainFinancialDecision(parsed.data);
    if (!explanation) {
      return Response.json({ enhanced: false });
    }
    return Response.json({ enhanced: true, explanation });
  } catch {
    return Response.json({ enhanced: false });
  }
}
