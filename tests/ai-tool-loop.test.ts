import test from "node:test";
import assert from "node:assert/strict";
import { runToolLoop, type FunctionTool } from "../lib/ai-tool-loop";
const tools: FunctionTool[] = [
  {
    type: "function",
    name: "propose_update",
    description: "candidate only",
    strict: true,
    parameters: { type: "object" },
  },
];
test("real tool protocol returns application outputs to model and retains reasoning items", async () => {
  let count = 0;
  const called: unknown[] = [];
  const result = await runToolLoop(
    { untrusted: "text" },
    "contract",
    tools,
    (name, args) => {
      called.push({ name, args });
      return { amount: 50, applied: false };
    },
    async (body) => {
      count++;
      if (count === 1)
        return {
          status: "completed",
          id: "response1",
          model: "mock",
          output: [
            { type: "reasoning" },
            {
              type: "function_call",
              name: "propose_update",
              arguments: '{"contribution":50}',
              call_id: "call1",
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      const history = body.input as { type: string; output?: string }[];
      assert.ok(history.some((x) => x.type === "reasoning"));
      assert.deepEqual(
        JSON.parse(
          history.find((x) => x.type === "function_call_output")!.output!,
        ),
        { amount: 50, applied: false },
      );
      return {
        status: "completed",
        id: "response2",
        model: "mock",
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: "Review your interpretation." },
            ],
          },
        ],
        usage: { input_tokens: 20, output_tokens: 5 },
      };
    },
  );
  assert.equal(called.length, 1);
  assert.deepEqual(result.trace, ["propose_update"]);
  assert.equal(result.usage.input_tokens, 30);
  assert.equal(result.responseIds.length, 2);
});
test("unsupported tool never reaches application executor", async () => {
  let invoked = false;
  await assert.rejects(
    runToolLoop(
      {},
      "",
      tools,
      () => {
        invoked = true;
      },
      async () => ({
        status: "completed",
        id: "x",
        model: "mock",
        output: [
          {
            type: "function_call",
            name: "transfer_money",
            arguments: "{}",
            call_id: "c",
          },
        ],
      }),
    ),
    /Unsupported/,
  );
  assert.equal(invoked, false);
});
test("provider timeout interrupts the session without running any mutation", async () => {
  let invoked = false;
  await assert.rejects(
    runToolLoop(
      {},
      "",
      tools,
      () => {
        invoked = true;
      },
      async () => {
        throw new DOMException("Timed out", "TimeoutError");
      },
    ),
    /Timed out/,
  );
  assert.equal(invoked, false);
});
test("tool loops have a hard round limit even if provider ignores tool_choice none", async () => {
  let requests = 0;
  await assert.rejects(
    runToolLoop(
      {},
      "",
      tools,
      () => ({}),
      async () => {
        requests++;
        return {
          status: "completed",
          id: "x",
          model: "mock",
          output: [
            {
              type: "function_call",
              name: "propose_update",
              arguments: "{}",
              call_id: "c",
            },
          ],
        };
      },
    ),
    /round limit/,
  );
  assert.equal(requests, 4);
});
