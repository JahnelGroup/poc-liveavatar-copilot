"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AgentEventsEnum,
  ConnectionQuality,
  LiveAvatarSession,
  SessionEvent,
  SessionState,
} from "@heygen/liveavatar-web-sdk";
import type { SessionStatus } from "@/lib/types";

const LIVEAVATAR_API_URL = process.env.NEXT_PUBLIC_LIVEAVATAR_API_URL ?? "https://api.liveavatar.com";

export function useLiveAvatarSession() {
  const sessionRef = useRef<LiveAvatarSession | null>(null);
  const keepAliveTimerRef = useRef<number | null>(null);

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("idle");
  const [sessionState, setSessionState] = useState<SessionState>(SessionState.INACTIVE);
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>(
    ConnectionQuality.UNKNOWN,
  );
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [isAvatarTalking, setIsAvatarTalking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearKeepAlive = useCallback(() => {
    if (keepAliveTimerRef.current !== null) {
      window.clearInterval(keepAliveTimerRef.current);
      keepAliveTimerRef.current = null;
    }
  }, []);

  const configureSession = useCallback((session: LiveAvatarSession) => {
    session.on(SessionEvent.SESSION_STATE_CHANGED, (state) => {
      setSessionState(state);
    });

    session.on(SessionEvent.SESSION_STREAM_READY, () => {
      setIsStreamReady(true);
      setSessionStatus("ready");
    });

    session.on(SessionEvent.SESSION_CONNECTION_QUALITY_CHANGED, (quality) => {
      setConnectionQuality(quality);
    });

    session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () => {
      setIsAvatarTalking(true);
    });

    session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
      setIsAvatarTalking(false);
    });
  }, []);

  const startSession = useCallback(async () => {
    setError(null);
    setSessionStatus("requesting_token");

    try {
      const tokenResponse = await fetch("/api/liveavatar/token", {
        method: "POST",
      });

      if (!tokenResponse.ok) {
        const details = await tokenResponse.text();
        throw new Error(`Failed to get session token: ${details}`);
      }

      const payload = (await tokenResponse.json()) as { session_token?: string };
      const sessionToken = payload.session_token;

      if (!sessionToken) {
        throw new Error("Missing session_token from /api/liveavatar/token");
      }

      setSessionStatus("starting");
      setIsStreamReady(false);
      setIsAvatarTalking(false);

      const session = new LiveAvatarSession(sessionToken, {
        voiceChat: false,
        apiUrl: LIVEAVATAR_API_URL,
      });

      configureSession(session);
      sessionRef.current = session;

      await session.start();

      clearKeepAlive();
      keepAliveTimerRef.current = window.setInterval(() => {
        session.keepAlive().catch(() => {
          // Keepalive failures are transient; session state handlers surface hard failures.
        });
      }, 20_000);
    } catch (startError) {
      setSessionStatus("error");
      setError((startError as Error).message);
      throw startError;
    }
  }, [clearKeepAlive, configureSession]);

  const stopSession = useCallback(async () => {
    clearKeepAlive();
    setIsAvatarTalking(false);
    setIsStreamReady(false);
    setSessionStatus("stopped");

    const session = sessionRef.current;
    if (!session) {
      return;
    }

    try {
      await session.stop();
    } finally {
      session.removeAllListeners();
      session.voiceChat.removeAllListeners();
      sessionRef.current = null;
      setSessionState(SessionState.DISCONNECTED);
    }
  }, [clearKeepAlive]);

  const keepAlive = useCallback(async () => {
    if (!sessionRef.current) {
      return;
    }
    await sessionRef.current.keepAlive();
  }, []);

  const attachToElement = useCallback((element: HTMLMediaElement | null) => {
    if (!element || !sessionRef.current) {
      return;
    }
    sessionRef.current.attach(element);
  }, []);

  const speakAudio = useCallback(async (base64Audio: string) => {
    if (!sessionRef.current) {
      throw new Error("LiveAvatar session is not started");
    }
    await sessionRef.current.repeatAudio(base64Audio);
  }, []);

  const interruptSpeech = useCallback(async () => {
    if (!sessionRef.current) {
      return;
    }
    await sessionRef.current.interrupt();
  }, []);

  const startListening = useCallback(async () => {
    if (!sessionRef.current) {
      return;
    }
    await sessionRef.current.startListening();
  }, []);

  const stopListening = useCallback(async () => {
    if (!sessionRef.current) {
      return;
    }
    await sessionRef.current.stopListening();
  }, []);

  useEffect(() => {
    return () => {
      clearKeepAlive();
      const session = sessionRef.current;
      if (session) {
        session.stop().catch(() => {
          // Best-effort cleanup.
        });
        session.removeAllListeners();
        session.voiceChat.removeAllListeners();
      }
      sessionRef.current = null;
    };
  }, [clearKeepAlive]);

  return {
    sessionRef,
    sessionStatus,
    sessionState,
    connectionQuality,
    isStreamReady,
    isAvatarTalking,
    error,
    startSession,
    stopSession,
    keepAlive,
    attachToElement,
    speakAudio,
    interruptSpeech,
    startListening,
    stopListening,
  };
}
