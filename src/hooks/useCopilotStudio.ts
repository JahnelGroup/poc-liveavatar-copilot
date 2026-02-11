"use client";

import { useCallback, useState } from "react";
import type {
  CopilotAuthMethod,
  CopilotConversationResponse,
  CopilotMessageResponse,
  CopilotTokenResponse,
} from "@/lib/types";

export function useCopilotStudio() {
  const [directLineToken, setDirectLineToken] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<CopilotAuthMethod>("directline");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [watermark, setWatermark] = useState<string | undefined>(undefined);
  const [isReady, setIsReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initializeConversation = useCallback(async (accessToken?: string) => {
    setError(null);
    setIsInitializing(true);

    try {
      const tokenResponse = await fetch("/api/copilot/token", {
        method: "POST",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (!tokenResponse.ok) {
        throw new Error(await tokenResponse.text());
      }
      const tokenPayload = (await tokenResponse.json()) as CopilotTokenResponse;

      if (!tokenPayload.token) {
        throw new Error("No token returned by /api/copilot/token");
      }

      const resolvedMethod = tokenPayload.method ?? "directline";
      // Token endpoint and Entra flows can return an already-started conversationId.
      let resolvedConversationId = tokenPayload.conversationId;
      if (!resolvedConversationId && resolvedMethod === "directline") {
        const conversationResponse = await fetch("/api/copilot/conversation", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token: tokenPayload.token }),
        });

        if (!conversationResponse.ok) {
          throw new Error(await conversationResponse.text());
        }

        const conversationPayload = (await conversationResponse.json()) as CopilotConversationResponse;
        if (!conversationPayload.conversationId) {
          throw new Error("No conversationId returned by /api/copilot/conversation");
        }
        resolvedConversationId = conversationPayload.conversationId;
      }

      if (!resolvedConversationId) {
        throw new Error("No conversationId returned by /api/copilot/token");
      }

      setDirectLineToken(tokenPayload.token);
      setAuthMethod(resolvedMethod);
      setConversationId(resolvedConversationId);
      setWatermark(undefined);
      setIsReady(true);
    } catch (initError) {
      setIsReady(false);
      setError((initError as Error).message);
      throw initError;
    } finally {
      setIsInitializing(false);
    }
  }, []);

  const sendMessage = useCallback(
    async (text: string, accessToken?: string) => {
      const token = directLineToken;
      const id = conversationId;

      if (!token || !id) {
        throw new Error("Copilot conversation is not initialized");
      }

      setIsSending(true);
      setError(null);

      try {
        const response = await fetch("/api/copilot/message", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            method: authMethod,
            token,
            conversationId: id,
            text,
            watermark,
          }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const payload = (await response.json()) as CopilotMessageResponse;
        return {
          botReply: payload.botReply ?? "",
          speechText: payload.speechText,
          signinCard: payload.signinCard,
        };
      } catch (messageError) {
        setError((messageError as Error).message);
        throw messageError;
      } finally {
        setIsSending(false);
      }
    },
    [authMethod, conversationId, directLineToken, watermark],
  );

  /**
   * Complete an OAuth connection card by exchanging a connection-scoped token.
   * The server sends a `signin/tokenExchange` invoke activity to Copilot.
   */
  const exchangeConnectionToken = useCallback(
    async (params: {
      connectionToken: string;
      connectionName: string;
      tokenExchangeResourceId: string;
      accessToken?: string;
    }) => {
      const id = conversationId;
      if (!id) {
        throw new Error("Copilot conversation is not initialized");
      }

      setIsSending(true);
      setError(null);

      try {
        const response = await fetch("/api/copilot/token-exchange", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(params.accessToken
              ? { Authorization: `Bearer ${params.accessToken}` }
              : {}),
          },
          body: JSON.stringify({
            method: authMethod,
            conversationId: id,
            connectionToken: params.connectionToken,
            connectionName: params.connectionName,
            tokenExchangeResourceId: params.tokenExchangeResourceId,
          }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const payload = (await response.json()) as CopilotMessageResponse;
        return {
          botReply: payload.botReply ?? "",
          speechText: payload.speechText,
          signinCard: payload.signinCard,
        };
      } catch (exchangeError) {
        setError((exchangeError as Error).message);
        throw exchangeError;
      } finally {
        setIsSending(false);
      }
    },
    [authMethod, conversationId],
  );

  /**
   * Send an Adaptive Card Action.Submit response (e.g. "Allow") back to Copilot.
   */
  const submitCardAction = useCallback(
    async (params: {
      submitAction: Record<string, unknown>;
      accessToken?: string;
    }) => {
      const id = conversationId;
      if (!id) {
        throw new Error("Copilot conversation is not initialized");
      }

      setIsSending(true);
      setError(null);

      try {
        const response = await fetch("/api/copilot/submit-action", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(params.accessToken
              ? { Authorization: `Bearer ${params.accessToken}` }
              : {}),
          },
          body: JSON.stringify({
            method: authMethod,
            conversationId: id,
            submitAction: params.submitAction,
          }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const payload = (await response.json()) as CopilotMessageResponse;
        return {
          botReply: payload.botReply ?? "",
          speechText: payload.speechText,
          signinCard: payload.signinCard,
        };
      } catch (submitError) {
        setError((submitError as Error).message);
        throw submitError;
      } finally {
        setIsSending(false);
      }
    },
    [authMethod, conversationId],
  );

  const resetConversation = useCallback(() => {
    setDirectLineToken(null);
    setAuthMethod("directline");
    setConversationId(null);
    setWatermark(undefined);
    setIsReady(false);
    setError(null);
  }, []);

  return {
    directLineToken,
    authMethod,
    conversationId,
    watermark,
    isReady,
    isInitializing,
    isSending,
    error,
    initializeConversation,
    sendMessage,
    exchangeConnectionToken,
    submitCardAction,
    resetConversation,
  };
}
