"use client";

import { useState } from "react";
import { goldenWorkspace } from "../../fixtures/golden-workspace";
import { toLegacy, toModel } from "../../lib/model/convert";
import type { Workspace } from "../../lib/model/types";
import { BucketsScreen } from "../steward/buckets";
import { ConnectScreen } from "../steward/connect";
import { HomeScreen } from "../steward/home";

export function PreviewClient({ today }: { today: string }) {
  const [screen, setScreen] = useState<"connect" | "buckets" | "home">("connect");
  const [workspace, setWorkspace] = useState<Workspace>(() => toModel(goldenWorkspace()));

  const update = (next: (current: Workspace) => Workspace) =>
    setWorkspace((current) => toModel(toLegacy(next(current))));

  return (
    <>
      {screen === "connect" ? (
        <ConnectScreen
          status="idle"
          error=""
          onConnect={() => setScreen("buckets")}
          onManual={() => setScreen("buckets")}
        />
      ) : screen === "buckets" ? (
        <BucketsScreen
          workspace={workspace}
          today={today}
          mode="review"
          update={update}
          onApprove={() => setScreen("home")}
        />
      ) : (
        <HomeScreen
          workspace={workspace}
          today={today}
          onOpenBuckets={() => setScreen("buckets")}
          onOpenBucket={() => setScreen("buckets")}
          onAsk={() => setScreen("buckets")}
        />
      )}
    </>
  );
}
