import { env } from "cloudflare:workers";

type PlaidEnvironment = "sandbox" | "development" | "production";

function runtime() {
  return env as unknown as Record<string, string | undefined>;
}

export function plaidConfigured() {
  const config = runtime();
  return Boolean(config.PLAID_CLIENT_ID && config.PLAID_SECRET);
}

export function plaidBaseUrl() {
  const selected = (runtime().PLAID_ENV ?? "sandbox") as PlaidEnvironment;
  return `https://${selected}.plaid.com`;
}

export async function plaidRequest<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const config = runtime();
  if (!config.PLAID_CLIENT_ID || !config.PLAID_SECRET) {
    throw new Error("Plaid credentials are not configured.");
  }
  const response = await fetch(`${plaidBaseUrl()}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: config.PLAID_CLIENT_ID,
      secret: config.PLAID_SECRET,
      ...body,
    }),
  });
  const payload = (await response.json()) as T & {
    error_message?: string;
    error_code?: string;
  };
  if (!response.ok) {
    throw new Error(`${payload.error_code ?? "PLAID_ERROR"}: ${payload.error_message ?? "Plaid request failed."}`);
  }
  return payload;
}

async function encryptionKey() {
  const secret = runtime().APP_ENCRYPTION_KEY;
  if (!secret) throw new Error("APP_ENCRYPTION_KEY is not configured.");
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function encryptPlaidToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(token),
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

export async function decryptPlaidToken(value: string) {
  const [ivValue, encryptedValue] = value.split(".");
  if (!ivValue || !encryptedValue) throw new Error("Invalid encrypted token.");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivValue) },
    await encryptionKey(),
    fromBase64(encryptedValue),
  );
  return new TextDecoder().decode(decrypted);
}

export async function stablePlaidUserId(email: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(email),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
