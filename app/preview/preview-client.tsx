"use client";

import { useState } from "react";
import { goldenWorkspace } from "../../fixtures/golden-workspace";
import { toLegacy, toModel } from "../../lib/model/convert";
import type { Workspace } from "../../lib/model/types";
import { BucketsScreen } from "../steward/buckets";
import { ConnectScreen } from "../steward/connect";

export function PreviewClient({ today }: { today: string }) {
  const [screen, setScreen] = useState<"connect" | "buckets">("connect");
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
      ) : (
        <BucketsScreen
          workspace={workspace}
          today={today}
          mode="review"
          update={update}
          onApprove={() => setScreen("connect")}
        />
      )}
    </>
  );
}
