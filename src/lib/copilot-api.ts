import { ServiceError, isCopilotDebugEnabled } from "@/lib/entra-auth";
import {
  CopilotStudioClient,
  ConnectionSettings,
} from "@microsoft/agents-copilotstudio-client";
import { Activity } from "@microsoft/agents-activity";

export type CopilotSigninCard = {
  title: string;
  message: string;
  /** Scope URI for MSAL token acquisition (from tokenExchangeResource.uri). */
  tokenExchangeResourceUri?: string;
  /** ID to send back in the signin/tokenExchange invoke (from tokenExchangeResource.id). */
  tokenExchangeResourceId?: string;
  /** Name of the connection (e.g. "SharePoint"). */
  connectionName?: string;
  /** Action.Submit data from the Adaptive Card "Allow" button (if present). */
  submitAction?: Record<string, unknown>;
};

type BotResponseClassification = {
  botReply?: string;
  signinCard?: CopilotSigninCard;
};

const SIGNIN_TEXT_PATTERN =
  /connect to continue|sign in|signin|authorize|authorization|credentials|permission required|federatedknowledgesearchoperation/i;

// ---------------------------------------------------------------------------
// Prompt wrapping
// ---------------------------------------------------------------------------

/**
 * Wraps the user's raw question with structured tags and appends
 * the configured prompt instructions (from COPILOT_PROMPT_INSTRUCTIONS).
 * Returns the original text unchanged if no instructions are configured.
 */
export function buildPrompt(userText: string): string {
  const instructions = process.env.COPILOT_PROMPT_INSTRUCTIONS?.trim();
  if (!instructions) {
    return userText;
  }
  return `<question>${userText}</question>\n<instructions>${instructions}</instructions>`;
}

/**
 * Strips markdown and citation patterns from bot replies when enabled.
 * Enable by setting COPILOT_CLEAN_REPLY=true in the environment.
 */
export function cleanBotReply(text: string): string {
  if (process.env.COPILOT_CLEAN_REPLY?.trim().toLowerCase() !== "true") {
    return text;
  }

  let cleaned = text;

  // Citation reference blocks: [1]: https://... "title"
  cleaned = cleaned.replace(/\n?\[\d+\]:\s*https?:\/\/[^\n]*/g, "");
  // Inline citation markers: [1], [2]
  cleaned = cleaned.replace(/\[\d+\]/g, "");
  // Markdown links [text](url) -> text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Markdown headers
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, "");
  // Bold **text** and __text__
  cleaned = cleaned.replace(/\*\*(.+?)\*\*/g, "$1");
  cleaned = cleaned.replace(/__(.+?)__/g, "$1");
  // Italic *text* and _text_
  cleaned = cleaned.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
  cleaned = cleaned.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "$1");
  // Bullet points and numbered lists
  cleaned = cleaned.replace(/^\s*[-*]\s+/gm, "");
  cleaned = cleaned.replace(/^\s*\d+\.\s+/gm, "");
  // Collapse excessive newlines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  return cleaned.trim();
}

// ---------------------------------------------------------------------------
// Connection helpers
// ---------------------------------------------------------------------------

/**
 * Build ConnectionSettings from environment variables.
 * Falls back to hardcoded defaults only for the known values already in the plan.
 */
export function getCopilotConnectionSettings(): ConnectionSettings {
  const environmentId = process.env.COPILOT_ENVIRONMENT_ID?.trim();
  const schemaName = process.env.COPILOT_AGENT_SCHEMA_NAME?.trim();

  if (!environmentId || !schemaName) {
    throw new Error(
      "Missing COPILOT_ENVIRONMENT_ID or COPILOT_AGENT_SCHEMA_NAME. " +
        "Set both in .env.local to identify the Copilot Studio agent.",
    );
  }

  return new ConnectionSettings({
    environmentId,
    schemaName,
  });
}

/**
 * Create a ready-to-use CopilotStudioClient.
 */
export function createCopilotClient(bearerToken: string): CopilotStudioClient {
  const settings = getCopilotConnectionSettings();
  return new CopilotStudioClient(settings, bearerToken);
}

// ---------------------------------------------------------------------------
// Activity helpers
// ---------------------------------------------------------------------------

function extractConversationIdFromActivities(
  activities: Activity[],
): string | undefined {
  for (const activity of activities) {
    const id = activity.conversation?.id;
    if (id?.trim()) return id.trim();
  }
  return undefined;
}

function isBotActivity(activity: Activity, userId = "user") {
  const fromRole = activity.from?.role?.toLowerCase();
  const fromId = activity.from?.id;
  return (
    fromRole === "bot" ||
    fromRole === "assistant" ||
    (fromId != null && fromId !== userId)
  );
}

/** Log all activities for debugging when COPILOT_DEBUG is enabled. */
function logActivities(label: string, activities: Activity[]) {
  if (!isCopilotDebugEnabled()) return;

  console.log(`[Copilot SDK] ${label}: ${activities.length} activities received`);
  let typingCount = 0;
  for (let i = 0; i < activities.length; i++) {
    const a = activities[i];
    if (a.type === "typing") {
      typingCount += 1;
      continue;
    }

    console.log(`  [${i}] type=${a.type ?? "?"}, from=${JSON.stringify(a.from)}, text=${a.text ? `"${a.text.slice(0, 200)}"` : "(none)"}`);
    if (a.attachments?.length) {
      console.log(`       attachments: ${JSON.stringify(a.attachments.map(att => ({ contentType: att.contentType, name: att.name })))}`);
      for (const att of a.attachments) {
        if (att.contentType === "application/vnd.microsoft.card.adaptive" && att.content) {
          const cardText = extractTextFromAdaptiveCard(att.content);
          const isSignin = cardText && isLikelySigninText(cardText);
          console.log(`       adaptive card text: ${cardText ? `"${cardText.slice(0, 300)}"` : "(empty)"}`);
          if (isSignin) {
            // Dump the full card JSON so we can inspect connection/auth structure
            const fullJson = JSON.stringify(att.content, null, 2);
            console.log(`       [SIGNIN CARD] full card JSON (${fullJson.length} chars):\n${fullJson}`);
          }
        }
      }
    }
    if (a.entities?.length) {
      console.log(`       entities: ${JSON.stringify(a.entities.map(e => ({ type: e.type })))}`);
    }
  }
  if (typingCount > 0) {
    console.log(`  ... ${typingCount} typing activities omitted`);
  }
}

/**
 * Extract text from an Adaptive Card attachment.
 * Adaptive Cards have a `body` array; we recursively collect all TextBlock text.
 */
function extractTextFromAdaptiveCard(content: unknown): string {
  if (!content || typeof content !== "object") return "";

  const card = content as {
    body?: unknown[];
    text?: string;
    type?: string;
  };

  const parts: string[] = [];

  // If this node itself is a TextBlock with text, collect it
  if (card.type === "TextBlock" && typeof card.text === "string" && card.text.trim()) {
    parts.push(card.text.trim());
  }

  // Recurse into body array (containers, column sets, etc.)
  if (Array.isArray(card.body)) {
    for (const item of card.body) {
      const text = extractTextFromAdaptiveCard(item);
      if (text) parts.push(text);
    }
  }

  // Recurse into columns, items, etc.
  const container = content as Record<string, unknown>;
  for (const key of ["columns", "items", "actions"]) {
    if (Array.isArray(container[key])) {
      for (const child of container[key] as unknown[]) {
        const text = extractTextFromAdaptiveCard(child);
        if (text) parts.push(text);
      }
    }
  }

  return parts.join("\n");
}

function isLikelySigninText(text: string): boolean {
  return SIGNIN_TEXT_PATTERN.test(text);
}

function inferSigninTitle(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("sharepoint")) {
    return "SharePoint authorization required";
  }
  return "Authorization required";
}

/**
 * Extract OAuth token-exchange metadata from an OAuthCard attachment content.
 * The shape is: { tokenExchangeResource: { id, uri }, connectionName, ... }
 */
function extractOAuthMetadata(content: unknown): {
  tokenExchangeResourceUri?: string;
  tokenExchangeResourceId?: string;
  connectionName?: string;
} {
  if (!content || typeof content !== "object") return {};
  const card = content as Record<string, unknown>;

  let tokenExchangeResourceUri: string | undefined;
  let tokenExchangeResourceId: string | undefined;
  let connectionName: string | undefined;

  if (card.tokenExchangeResource && typeof card.tokenExchangeResource === "object") {
    const ter = card.tokenExchangeResource as Record<string, unknown>;
    if (typeof ter.uri === "string" && ter.uri.trim()) {
      tokenExchangeResourceUri = ter.uri.trim();
    }
    if (typeof ter.id === "string" && ter.id.trim()) {
      tokenExchangeResourceId = ter.id.trim();
    }
  }

  if (typeof card.connectionName === "string" && card.connectionName.trim()) {
    connectionName = card.connectionName.trim();
  }

  return { tokenExchangeResourceUri, tokenExchangeResourceId, connectionName };
}

/**
 * Walk an Adaptive Card and find the "Allow" Action.Submit data.
 * Returns the `data` object from the first Action.Submit whose data.action === "Allow".
 */
function findAllowSubmitAction(content: unknown): Record<string, unknown> | undefined {
  if (!content || typeof content !== "object") return undefined;

  const node = content as Record<string, unknown>;

  // Check if this node itself is an Action.Submit with action "Allow"
  if (
    node.type === "Action.Submit" &&
    node.data &&
    typeof node.data === "object" &&
    (node.data as Record<string, unknown>).action === "Allow"
  ) {
    return node.data as Record<string, unknown>;
  }

  // Recurse into arrays
  for (const key of ["body", "columns", "items", "actions"]) {
    if (Array.isArray(node[key])) {
      for (const child of node[key] as unknown[]) {
        const result = findAllowSubmitAction(child);
        if (result) return result;
      }
    }
  }

  return undefined;
}

function extractSigninCardFromActivity(activity: Activity): CopilotSigninCard | undefined {
  const textFromActivity = activity.text?.trim() || "";

  for (const attachment of activity.attachments ?? []) {
    const contentType = attachment.contentType.toLowerCase();
    const isOAuthAttachment =
      contentType === "application/vnd.microsoft.card.oauth" ||
      contentType === "application/vnd.microsoft.card.signin";
    const isAdaptiveCard = contentType === "application/vnd.microsoft.card.adaptive";

    if (!isOAuthAttachment && !isAdaptiveCard) {
      continue;
    }

    const extractedText = attachment.content
      ? extractTextFromAdaptiveCard(attachment.content).trim()
      : "";
    const message = extractedText || textFromActivity;

    if (isOAuthAttachment || (message && isLikelySigninText(message))) {
      // Extract OAuth metadata from the card content (if present)
      const oauthMeta = attachment.content
        ? extractOAuthMetadata(attachment.content)
        : {};

      // Extract Action.Submit "Allow" data from adaptive cards
      const submitAction = isAdaptiveCard && attachment.content
        ? findAllowSubmitAction(attachment.content)
        : undefined;

      return {
        title: inferSigninTitle(message || "Authorization required"),
        message: message || "Connect to continue. This action requires sign-in.",
        ...oauthMeta,
        submitAction,
      };
    }
  }

  if (textFromActivity && isLikelySigninText(textFromActivity)) {
    return {
      title: inferSigninTitle(textFromActivity),
      message: textFromActivity,
    };
  }

  return undefined;
}

/**
 * Extract text from all Adaptive Card attachments in an activity.
 */
function extractTextFromAttachments(activity: Activity): string | undefined {
  if (!activity.attachments?.length) return undefined;

  const parts: string[] = [];
  for (const attachment of activity.attachments) {
    if (
      attachment.contentType === "application/vnd.microsoft.card.adaptive" &&
      attachment.content
    ) {
      const text = extractTextFromAdaptiveCard(attachment.content);
      if (text) parts.push(text);
    }
  }

  return parts.length > 0 ? parts.join("\n") : undefined;
}

function classifyBotResponse(
  activities: Activity[],
  userId = "user",
): BotResponseClassification {
  let signinCard: CopilotSigninCard | undefined;

  // Pass 1: inspect bot messages for speakable text and/or sign-in cards.
  for (const activity of activities) {
    if (!isBotActivity(activity, userId)) continue;

    if (!signinCard) {
      signinCard = extractSigninCardFromActivity(activity);
    }

    if (activity.type !== "message") continue;

    // Prefer activity.text if present
    if (activity.text?.trim()) {
      const text = activity.text.trim();
      if (!isLikelySigninText(text)) {
        return { botReply: text, signinCard };
      }
    }

    // Fall back to text extracted from Adaptive Card attachments.
    const cardText = extractTextFromAttachments(activity);
    if (cardText?.trim()) {
      const cleaned = cardText.trim();
      if (isLikelySigninText(cleaned)) {
        signinCard ??= {
          title: inferSigninTitle(cleaned),
          message: cleaned,
        };
      } else {
        return { botReply: cleaned, signinCard };
      }
    }
  }

  // Pass 2: fall back to the last "typing" activity with accumulated streamed text.
  // The SDK accumulates streamed text in typing activities during SSE streaming.
  // Skip short intermediary texts like "Generating plan...".
  for (let i = activities.length - 1; i >= 0; i--) {
    const activity = activities[i];
    if (activity.type !== "typing") continue;
    if (!isBotActivity(activity, userId)) continue;
    const text = activity.text?.trim();
    if (text && text.length > 30 && !isLikelySigninText(text)) {
      return { botReply: text, signinCard };
    }
  }

  return { signinCard };
}

// ---------------------------------------------------------------------------
// Diagnostics helpers (kept for error reporting)
// ---------------------------------------------------------------------------

function buildCopilotHint(status?: number) {
  if (status === 403) {
    return "Copilot API rejected the request. Check Entra admin consent, app permissions, and token audience/scope.";
  }
  if (status === 401) {
    return "Copilot API request was unauthorized. Verify bearer token validity and tenant/app configuration.";
  }
  return undefined;
}

function wrapSdkError(error: unknown, context: string): never {
  if (error instanceof ServiceError) throw error;

  const message = error instanceof Error ? error.message : String(error);

  // Try to extract an HTTP status from the error message
  const statusMatch = message.match(/\b(\d{3})\b/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : undefined;

  throw new ServiceError(`${context}: ${message}`, {
    diagnostics: {
      service: "copilot",
      status,
      errorMessage: message,
    },
    hint: buildCopilotHint(status),
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send an Adaptive Card Action.Submit response back to Copilot Studio.
 * This is how the "Allow" button on connection consent cards is handled --
 * the submit data is sent as a message activity value, same as Web Chat / Teams.
 */
export async function sendCardSubmitAction(params: {
  bearerToken: string;
  conversationId: string;
  submitAction: Record<string, unknown>;
  userId?: string;
}): Promise<BotResponseClassification> {
  try {
    const client = createCopilotClient(params.bearerToken);

    const submitActivity = Activity.fromObject({
      type: "message",
      text: "",
      value: params.submitAction,
      conversation: { id: params.conversationId },
    });

    const activities = await client.sendActivity(
      submitActivity,
      params.conversationId,
    );

    logActivities("cardSubmitAction", activities);

    const classified = classifyBotResponse(activities, params.userId);

    if (isCopilotDebugEnabled()) {
      console.log(
        `[Copilot SDK] Card submit result: botReply=${classified.botReply ? `"${classified.botReply.slice(0, 200)}"` : "(none)"}, hasSigninCard=${Boolean(classified.signinCard)}`,
      );
    }

    return classified;
  } catch (error) {
    wrapSdkError(error, "Copilot card submit action failed");
  }
}

/**
 * Send a `signin/tokenExchange` invoke activity to complete an OAuth
 * connection card flow. The bot receives the user's connection token and
 * continues the conversation.
 */
export async function sendTokenExchangeActivity(params: {
  bearerToken: string;
  conversationId: string;
  connectionToken: string;
  connectionName: string;
  tokenExchangeResourceId: string;
  userId?: string;
}): Promise<BotResponseClassification> {
  try {
    const client = createCopilotClient(params.bearerToken);

    const invokeActivity = Activity.fromObject({
      type: "invoke",
      name: "signin/tokenExchange",
      value: {
        id: params.tokenExchangeResourceId,
        connectionName: params.connectionName,
        token: params.connectionToken,
      },
      conversation: { id: params.conversationId },
    });

    const activities = await client.sendActivity(
      invokeActivity,
      params.conversationId,
    );

    logActivities("tokenExchange", activities);

    const classified = classifyBotResponse(activities, params.userId);

    if (isCopilotDebugEnabled()) {
      console.log(
        `[Copilot SDK] Token exchange result: botReply=${classified.botReply ? `"${classified.botReply.slice(0, 200)}"` : "(none)"}, hasSigninCard=${Boolean(classified.signinCard)}`,
      );
    }

    return classified;
  } catch (error) {
    wrapSdkError(error, "Copilot token exchange failed");
  }
}

/**
 * Start a new Copilot conversation via the official SDK.
 * Returns the conversation ID and any greeting activities.
 */
export async function startCopilotConversation(params: {
  bearerToken: string;
}): Promise<{ conversationId: string; greetingText?: string }> {
  try {
    const client = createCopilotClient(params.bearerToken);
    const activities = await client.startConversationAsync(true);

    logActivities("startConversation", activities);

    const conversationId = extractConversationIdFromActivities(activities);
    if (!conversationId) {
      throw new Error(
        "Copilot conversation started but no conversationId was returned in activities",
      );
    }

    const greetingText = classifyBotResponse(activities).botReply;

    return { conversationId, greetingText };
  } catch (error) {
    wrapSdkError(error, "Copilot conversation start failed");
  }
}

/**
 * Send a message to an existing Copilot conversation and get the bot reply.
 * Uses `askQuestionAsync` which handles the full request-response cycle.
 */
export async function sendCopilotMessage(params: {
  bearerToken: string;
  conversationId: string;
  text: string;
  userId?: string;
}): Promise<BotResponseClassification> {
  try {
    const client = createCopilotClient(params.bearerToken);
    const activities = await client.askQuestionAsync(
      params.text,
      params.conversationId,
    );

    logActivities(`sendMessage("${params.text.slice(0, 80)}")`, activities);

    const classified = classifyBotResponse(activities, params.userId);

    if (isCopilotDebugEnabled()) {
      console.log(`[Copilot SDK] Extracted botReply: ${classified.botReply ? `"${classified.botReply.slice(0, 200)}"` : "(none)"}`);
      if (classified.signinCard) {
        console.log(
          `[Copilot SDK] Detected signinCard: ${JSON.stringify({
            title: classified.signinCard.title,
            connectionName: classified.signinCard.connectionName,
            hasTokenExchange: Boolean(classified.signinCard.tokenExchangeResourceUri),
            hasSubmitAction: Boolean(classified.signinCard.submitAction),
          })}`,
        );
      }
    }

    return classified;
  } catch (error) {
    wrapSdkError(error, "Copilot send message failed");
  }
}
