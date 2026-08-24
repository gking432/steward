import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

/**
 * Build-shape checks.
 *
 * These deliberately do NOT assert on copy. The previous version of this file
 * matched nineteen marketing strings in the source, which meant it passed while
 * the bucket screen was visually clipped and failed whenever a word changed. It
 * was a change-detector, not a test.
 *
 * What is worth asserting here is structural: that the app builds, that the
 * legacy tree is really gone, and that the invariants which are easy to
 * regress by accident still hold.
 */

test("the production worker builds", async () => {
  const manifest = await read("dist/server/vinext-server.json").catch(() => "");
  assert.ok(manifest.length > 0, "run `npm run build` before this test");
});

test("the legacy application tree is gone", async () => {
  for (const path of ["app/steward-app.tsx", "app/legacy/page.tsx", "app/legacy-fixture/page.tsx"]) {
    await assert.rejects(read(path), `${path} should no longer exist`);
  }
});

test("global CSS is a base layer, not a component stylesheet", async () => {
  const css = await read("app/globals.css");
  const lines = css.split("\n").length;
  assert.ok(lines < 300, `globals.css is ${lines} lines; component styles belong with components`);
  // The override that repainted the palette green below 767px is what made the
  // old app look like two products. It must not come back.
  assert.doesNotMatch(css, /max-width:\s*767px/);
});

test("there is exactly one application tree", async () => {
  const app = await read("app/steward/app.tsx");
  assert.doesNotMatch(app, /desktop-route-view|mobile-route-view|MobileNativeView/);
  assert.match(app, /No mobile fork|one responsive tree/i);
});

test("the app renders through the domain model, never the legacy state shape", async () => {
  const app = await read("app/steward/app.tsx");
  assert.match(app, /lib\/model\/engine/);
  assert.doesNotMatch(app, /paycheckPlan/);
});

test("routes resolve to the new tree", async () => {
  assert.match(await read("app/page.tsx"), /steward\/app/);
  assert.match(await read("app/fixture/page.tsx"), /steward\/app/);
  assert.match(await read("app/demo/page.tsx"), /steward\/app/);
});

test("the public demo is obvious, seeded, and isolated from saved data", async () => {
  const connect = await read("app/steward/connect.tsx");
  const demo = await read("app/demo/page.tsx");

  assert.match(connect, /Connect fake bank details to try it out/);
  assert.match(connect, /href="\/demo"/);
  assert.match(demo, /demoWorkspace\(\)/);
  assert.match(demo, /syncWithServer=\{false\}/);
  assert.match(demo, /demoMode/);
  assert.match(await read("app/steward/app.tsx"), /Reading three months of statements/);
  assert.match(await read("fixtures/golden-workspace.ts"), /onboardingComplete: false/);
});
