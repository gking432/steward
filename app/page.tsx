import { createEmptyState } from "../lib/initial-state";
import { getChatGPTUser } from "./chatgpt-auth";
import { StewardApp } from "./steward/app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  const initialState = createEmptyState(
    user?.displayName ?? "Steward user",
    user?.email ?? "local@steward.app",
  );
  return <StewardApp initialState={initialState} />;
}
