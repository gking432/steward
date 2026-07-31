import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("build contains Steward's decision briefing", async () => {
  const [layout, app, page, css, manifest] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/steward-app.tsx", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("dist/server/vinext-server.json", root), "utf8").catch(
      () => "",
    ),
  ]);

  assert.match(layout, /Steward — Your financial chief of staff/);
  assert.match(layout, /og-v2\.png/);
  assert.match(app, /Your live financial briefing/);
  assert.match(app, /Your next best move/);
  assert.match(app, /Safe to spend today/);
  assert.match(app, /Today’s decisions/);
  assert.match(app, /Upcoming obligations/);
  assert.match(page, /<StewardApp initialState=\{initialState\}/);
  assert.match(css, /\.decision-hero/);
  assert.match(css, /\.mobile-bottom-nav/);
  assert.match(app, /native-connect/);
  assert.match(app, /Let’s get started/);
  assert.match(app, /function MobileOverview/);
  assert.match(app, /AVAILABLE TO ENJOY/);
  assert.match(css, /\.mobile-home-view/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(layout, /manifest\.webmanifest/);
  assert.doesNotMatch(`${layout}\n${app}\n${page}`, /createDemoState|demo-data/);
  assert.doesNotMatch(
    `${layout}\n${app}\n${page}`,
    /codex-preview|react-loading-skeleton/i,
  );
  assert.ok(manifest.length > 0, "production manifest should exist after build");
});

test("includes every primary navigation destination", async () => {
  const app = await readFile(new URL("app/steward-app.tsx", root), "utf8");
  for (const label of [
    "Today",
    "Plan",
    "Debt",
    "Transactions",
    "Projects",
    "Wishlist",
    "Advisor",
    "Reviews",
    "Accounts",
    "Settings",
  ]) {
    assert.match(app, new RegExp(`label: "${label}"`));
  }
  assert.match(app, /aria-label="Main navigation"/);
});
