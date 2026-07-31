import { createDemoState } from "../lib/demo-data";
import { getChatGPTUser } from "./chatgpt-auth";
import { StewardApp } from "./steward-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  const initialState = createDemoState(
    user?.displayName ?? "Alex Morgan",
    user?.email ?? "demo@steward.local",
  );
  return <StewardApp initialState={initialState} />;
}
