"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  ConversationMessage,
  CopilotMessageResponse,
  CopilotSigninCard,
  UiStatus,
} from "@/lib/types";

type UseConversationLoopOptions = {
  sendCopilotMessage: (text: string) => Promise<CopilotMessageResponse>;
  speakAudio: (base64Audio: string) => Promise<void>;
  /** Interrupt the avatar mid-speech (used to cut filler short). */
  interruptSpeech?: () => Promise<void>;
  /** Silently acquire a token for a connection scope. Returns null if consent is needed. */
  acquireConnectionToken?: (scope: string) => Promise<string | null>;
  /** Exchange a connection token with Copilot to complete an OAuth card. */
  exchangeConnectionToken?: (params: {
    connectionToken: string;
    connectionName: string;
    tokenExchangeResourceId: string;
  }) => Promise<CopilotMessageResponse>;
  /** Send an Adaptive Card Action.Submit response back to Copilot (e.g. "Allow"). */
  submitCardAction?: (params: {
    submitAction: Record<string, unknown>;
  }) => Promise<CopilotMessageResponse>;
};

/** Set NEXT_PUBLIC_FILLER_TEXT_TEMPLATE in .env to enable filler speech. Empty = disabled. */
const FILLER_TEXT_TEMPLATE =
  process.env.NEXT_PUBLIC_FILLER_TEXT_TEMPLATE?.trim() || "";

function message(role: ConversationMessage["role"], text: string): ConversationMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    createdAt: Date.now(),
  };
}

export function useConversationLoop(options: UseConversationLoopOptions) {
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [status, setStatus] = useState<UiStatus>("idle");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signinCard, setSigninCard] = useState<CopilotSigninCard | null>(null);
  const [isExchanging, setIsExchanging] = useState(false);

  // Keep a ref to the latest options so callbacks always have current values
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const synthesizeSpeech = useCallback(async (text: string) => {
    const response = await fetch("/api/tts/synthesize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const payload = (await response.json()) as { audio?: string };
    if (!payload.audio) {
      throw new Error("TTS route did not return audio");
    }

    return payload.audio;
  }, []);

  /**
   * Process a bot reply: add display text to history, synthesize speech text
   * via TTS, and play through the avatar.
   *
   * @param displayText  Full text shown in the transcript (may contain citations/markdown).
   * @param speechText   Cleaned text sent to TTS (no citations/markdown). Falls back to displayText.
   */
  const processBotReply = useCallback(
    async (displayText: string, speechText?: string) => {
      setHistory((prev) => [...prev, message("assistant", displayText)]);
      setStatus("speaking");
      const audio = await synthesizeSpeech(speechText || displayText);
      await optionsRef.current.speakAudio(audio);
      setStatus("listening");
    },
    [synthesizeSpeech],
  );

  /**
   * Speak a filler phrase through the avatar while Copilot is thinking.
   * Fire-and-forget: errors are caught and swallowed so they never block
   * the real answer.
   */
  const speakFiller = useCallback(
    async (userText: string) => {
      if (!FILLER_TEXT_TEMPLATE) return; // filler disabled
      try {
        const truncated =
          userText.length > 80 ? `${userText.slice(0, 80)}...` : userText;
        const fillerText = FILLER_TEXT_TEMPLATE.includes("{{input}}")
          ? FILLER_TEXT_TEMPLATE.replaceAll("{{input}}", truncated)
          : FILLER_TEXT_TEMPLATE;
        const audio = await synthesizeSpeech(fillerText);
        await optionsRef.current.speakAudio(audio);
      } catch {
        // Filler failure is non-critical — swallow silently
      }
    },
    [synthesizeSpeech],
  );

  /**
   * Attempt a silent token exchange for an OAuth connection card.
   * Returns the exchange response if successful, or null if user
   * interaction is required.
   */
  const trySilentExchange = useCallback(
    async (card: CopilotSigninCard): Promise<CopilotMessageResponse | null> => {
      const { acquireConnectionToken, exchangeConnectionToken } = optionsRef.current;

      if (
        !card.tokenExchangeResourceUri ||
        !card.tokenExchangeResourceId ||
        !card.connectionName ||
        !acquireConnectionToken ||
        !exchangeConnectionToken
      ) {
        return null;
      }

      const connectionToken = await acquireConnectionToken(
        card.tokenExchangeResourceUri,
      );
      if (!connectionToken) {
        // Silent failed — consent is needed via popup
        return null;
      }

      return exchangeConnectionToken({
        connectionToken,
        connectionName: card.connectionName,
        tokenExchangeResourceId: card.tokenExchangeResourceId,
      });
    },
    [],
  );

  const runTurn = useCallback(
    async (userText: string) => {
      const cleanText = userText.trim();
      if (!cleanText || isProcessing) {
        return;
      }

      setError(null);
      setSigninCard(null);
      setIsProcessing(true);
      setStatus("speaking");
      setHistory((prev) => [...prev, message("user", cleanText)]);

      try {
        // Run filler speech and Copilot call in parallel.
        // The avatar speaks the filler while Copilot is thinking.
        const fillerPromise = speakFiller(cleanText);
        const copilotPromise = optionsRef.current.sendCopilotMessage(cleanText);

        // Wait for Copilot to respond (filler may still be playing)
        const response = await copilotPromise;

        // Interrupt filler if it's still playing
        if (optionsRef.current.interruptSpeech) {
          await optionsRef.current.interruptSpeech();
        }

        // Wait for filler promise to settle (it may have been interrupted)
        await fillerPromise.catch(() => {});

        setStatus("thinking");
        const botReply = response.botReply.trim();
        const nextSigninCard = response.signinCard ?? null;

        // ------------------------------------------------------------------
        // If the bot returned an OAuth card with token exchange metadata,
        // attempt a silent token exchange before showing the card to the user.
        // ------------------------------------------------------------------
        if (nextSigninCard?.tokenExchangeResourceUri) {
          const exchangeResult = await trySilentExchange(nextSigninCard);

          if (exchangeResult) {
            // Silent exchange succeeded — process the real reply
            const exchangeReply = exchangeResult.botReply.trim();
            if (exchangeReply) {
              await processBotReply(exchangeReply, exchangeResult.speechText?.trim());
            } else {
              setStatus("listening");
            }
            // Don't show the signin card — it was handled silently
            return;
          }

          // Silent failed — fall through to show the card with a Connect button
        }

        if (nextSigninCard) {
          setSigninCard(nextSigninCard);
        }

        if (botReply) {
          await processBotReply(botReply, response.speechText?.trim());
        } else {
          // OAuth/sign-in cards are actionable UI prompts, not speech content.
          if (nextSigninCard?.message.trim()) {
            setHistory((prev) => [
              ...prev,
              message("assistant", nextSigninCard.message.trim()),
            ]);
          }
          setStatus("listening");
        }
      } catch (turnError) {
        setStatus("error");
        setError((turnError as Error).message);
        throw turnError;
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, processBotReply, speakFiller, trySilentExchange],
  );

  /**
   * Called by the UI after the user clicks "Connect" and completes the
   * interactive popup auth. Sends the connection token to Copilot and
   * continues the conversation.
   */
  const completeTokenExchange = useCallback(
    async (connectionToken: string) => {
      const card = signinCard;
      if (
        !card?.tokenExchangeResourceId ||
        !card?.connectionName ||
        !optionsRef.current.exchangeConnectionToken
      ) {
        throw new Error("No pending signin card with token exchange metadata");
      }

      setError(null);
      setIsExchanging(true);
      setStatus("thinking");

      try {
        const result = await optionsRef.current.exchangeConnectionToken({
          connectionToken,
          connectionName: card.connectionName,
          tokenExchangeResourceId: card.tokenExchangeResourceId,
        });

        // Clear the signin card — exchange succeeded
        setSigninCard(null);

        const botReply = result.botReply.trim();
        if (botReply) {
          await processBotReply(botReply, result.speechText?.trim());
        } else if (result.signinCard) {
          // Another signin card (unlikely but possible)
          setSigninCard(result.signinCard);
          setStatus("listening");
        } else {
          setStatus("listening");
        }
      } catch (exchangeError) {
        setStatus("error");
        setError((exchangeError as Error).message);
      } finally {
        setIsExchanging(false);
      }
    },
    [signinCard, processBotReply],
  );

  /**
   * Called by the UI when the user clicks "Allow" on a connection consent card
   * that uses Action.Submit. Sends the submit data to Copilot and processes
   * the follow-up reply.
   */
  const submitAllowAction = useCallback(async () => {
    const card = signinCard;
    if (!card?.submitAction || !optionsRef.current.submitCardAction) {
      throw new Error("No pending signin card with submit action data");
    }

    setError(null);
    setIsExchanging(true);
    setStatus("thinking");

    try {
      const result = await optionsRef.current.submitCardAction({
        submitAction: card.submitAction,
      });

      // Clear the signin card — submit succeeded
      setSigninCard(null);

      const botReply = result.botReply.trim();
      if (botReply) {
        await processBotReply(botReply, result.speechText?.trim());
      } else if (result.signinCard) {
        // Another signin card (unlikely but possible)
        setSigninCard(result.signinCard);
        setStatus("listening");
      } else {
        setStatus("listening");
      }
    } catch (submitError) {
      setStatus("error");
      setError((submitError as Error).message);
    } finally {
      setIsExchanging(false);
    }
  }, [signinCard, processBotReply]);

  /**
   * Dismiss the current signin card without taking action (Cancel).
   */
  const dismissSigninCard = useCallback(() => {
    setSigninCard(null);
    setStatus("listening");
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setSigninCard(null);
  }, []);

  const hasMessages = useMemo(() => history.length > 0, [history.length]);

  return {
    history,
    hasMessages,
    status,
    isProcessing,
    isExchanging,
    error,
    signinCard,
    runTurn,
    completeTokenExchange,
    submitAllowAction,
    dismissSigninCard,
    setStatus,
    clearHistory,
  };
}
