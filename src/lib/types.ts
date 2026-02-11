export type SessionStatus =
  | "idle"
  | "requesting_token"
  | "starting"
  | "ready"
  | "stopped"
  | "error";

export type ConversationRole = "user" | "assistant";

export type ConversationMessage = {
  id: string;
  role: ConversationRole;
  text: string;
  createdAt: number;
};

export type UiStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export type LiveAvatarTokenResponse = {
  session_token: string;
  session_id?: string;
};

export type CopilotTokenResponse = {
  token: string;
  conversationId?: string;
  expires_in?: number;
  method?: CopilotAuthMethod;
};

export type CopilotAuthMethod = "entra" | "entra-delegated" | "directline";

export type CopilotConversationResponse = {
  conversationId: string;
  token?: string;
  streamUrl?: string;
};

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

export type CopilotMessageResponse = {
  botReply: string;
  /** Cleaned text for TTS (no citations/markdown). Falls back to botReply if absent. */
  speechText?: string;
  signinCard?: CopilotSigninCard;
};
