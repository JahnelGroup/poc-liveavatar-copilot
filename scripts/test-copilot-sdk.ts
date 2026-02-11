/**
 * Standalone smoke test for Copilot Studio SDK.
 *
 * Validates the Direct Engine Protocol round-trip:
 *   1. Acquire an Entra token (client_credentials)
 *   2. Start a conversation via CopilotStudioClient
 *   3. Send a message and receive the bot reply
 *
 * Run:
 *   npx tsx scripts/test-copilot-sdk.ts
 *
 * Reads credentials from .env.local (same values the app uses).
 */

import * as fs from "fs";
import * as path from "path";
import { ClientSecretCredential } from "@azure/identity";
import {
  CopilotStudioClient,
  ConnectionSettings,
} from "@microsoft/agents-copilotstudio-client";

// ---------------------------------------------------------------------------
// Load .env.local manually (no dotenv dependency needed)
// ---------------------------------------------------------------------------
function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.error(`[ERROR] ${filePath} not found`);
    process.exit(1);
  }
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnv(path.resolve(__dirname, "../.env.local"));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const TENANT_ID = process.env.ENTRA_TENANT_ID?.trim();
const CLIENT_ID = process.env.ENTRA_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.ENTRA_CLIENT_SECRET?.trim();
const ENVIRONMENT_ID =
  process.env.COPILOT_ENVIRONMENT_ID?.trim() ||
  "Default-0b628040-474c-4d29-9f59-c71df9d13092";
const AGENT_SCHEMA_NAME =
  process.env.COPILOT_AGENT_SCHEMA_NAME?.trim() ||
  "cr169_dataStorytellingCoach";

if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "[ERROR] Missing ENTRA_TENANT_ID, ENTRA_CLIENT_ID, or ENTRA_CLIENT_SECRET in .env.local"
  );
  process.exit(1);
}

console.log("=== Copilot Studio SDK Smoke Test ===");
console.log(`  Tenant:      ${TENANT_ID}`);
console.log(`  Client:      ${CLIENT_ID}`);
console.log(`  Environment: ${ENVIRONMENT_ID}`);
console.log(`  Agent:       ${AGENT_SCHEMA_NAME}`);
console.log();

// ---------------------------------------------------------------------------
// Step 1: Acquire token
// ---------------------------------------------------------------------------
async function acquireToken(): Promise<string> {
  console.log("[1/3] Acquiring Entra token (client_credentials)...");

  const settings = new ConnectionSettings({
    environmentId: ENVIRONMENT_ID,
    schemaName: AGENT_SCHEMA_NAME,
  });

  // Use SDK helper to determine the correct scope
  const scope = CopilotStudioClient.scopeFromSettings(settings);
  console.log(`  Scope: ${scope}`);

  const credential = new ClientSecretCredential(
    TENANT_ID!,
    CLIENT_ID!,
    CLIENT_SECRET!
  );

  const tokenResponse = await credential.getToken(scope);
  if (!tokenResponse?.token) {
    throw new Error("Failed to acquire Entra token");
  }

  console.log(`  Token acquired (expires: ${tokenResponse.expiresOnTimestamp})`);
  return tokenResponse.token;
}

// ---------------------------------------------------------------------------
// Step 2: Start conversation
// ---------------------------------------------------------------------------
async function startConversation(client: CopilotStudioClient): Promise<void> {
  console.log("\n[2/3] Starting conversation...");

  const activities = await client.startConversationAsync(true);

  console.log(`  Received ${activities.length} activities:`);
  for (const activity of activities) {
    console.log(
      `    [${activity.type}] ${activity.from?.name ?? activity.from?.id ?? "?"}: ${activity.text ?? "(no text)"}`
    );
  }
}

// ---------------------------------------------------------------------------
// Step 3: Send a message and get bot reply
// ---------------------------------------------------------------------------
async function sendMessage(
  client: CopilotStudioClient,
  text: string
): Promise<void> {
  console.log(`\n[3/3] Sending message: "${text}"...`);

  const activities = await client.askQuestionAsync(text);

  console.log(`  Received ${activities.length} activities:`);
  for (const activity of activities) {
    console.log(
      `    [${activity.type}] ${activity.from?.name ?? activity.from?.id ?? "?"}: ${activity.text ?? "(no text)"}`
    );
  }

  const botReply = activities.find(
    (a) => a.type === "message" && a.text?.trim()
  );
  if (botReply?.text) {
    console.log(`\n  BOT REPLY: ${botReply.text}`);
  } else {
    console.log("\n  [WARN] No text reply found in activities.");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  try {
    const token = await acquireToken();

    const settings = new ConnectionSettings({
      environmentId: ENVIRONMENT_ID,
      schemaName: AGENT_SCHEMA_NAME,
    });

    console.log(`\n  SDK scope: ${CopilotStudioClient.scopeFromSettings(settings)}`);

    const client = new CopilotStudioClient(settings, token);

    await startConversation(client);
    await sendMessage(client, "Hello, what can you help me with?");

    console.log("\n=== SMOKE TEST PASSED ===");
  } catch (error) {
    console.error("\n=== SMOKE TEST FAILED ===");
    console.error(error);
    process.exit(1);
  }
}

main();
