"use client";

import { useCallback, useRef, useState } from "react";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";

type DeepgramSttOptions = {
  onFinalTranscript: (text: string) => void | Promise<void>;
};

type DeepgramConnection = {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  send: (data: ArrayBuffer) => void;
  finish?: () => void;
  requestClose?: () => void;
};

function getPreferredMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];

  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "";
}

export function useDeepgramSTT(options: DeepgramSttOptions) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const connectionRef = useRef<DeepgramConnection | null>(null);

  const [isConnecting, setIsConnecting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopListening = useCallback(() => {
    setIsListening(false);
    setIsConnecting(false);

    recorderRef.current?.stop();
    recorderRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (connectionRef.current?.finish) {
      connectionRef.current.finish();
    } else if (connectionRef.current?.requestClose) {
      connectionRef.current.requestClose();
    }
    connectionRef.current = null;
  }, []);

  const startListening = useCallback(async () => {
    setError(null);
    setIsConnecting(true);

    try {
      const tokenResponse = await fetch("/api/deepgram/token", { method: "POST" });
      if (!tokenResponse.ok) {
        throw new Error(await tokenResponse.text());
      }

      const payload = (await tokenResponse.json()) as { token?: string };
      if (!payload.token) {
        throw new Error("No token returned by /api/deepgram/token");
      }

      const deepgram = createClient(payload.token);
      const connection = deepgram.listen.live({
        model: "nova-2",
        interim_results: true,
        punctuate: true,
        smart_format: true,
      }) as unknown as DeepgramConnection;
      connectionRef.current = connection;

      connection.on(LiveTranscriptionEvents.Open, () => {
        setIsConnecting(false);
        setIsListening(true);
      });

      connection.on(LiveTranscriptionEvents.Error, (event) => {
        setError(`Deepgram error: ${String(event)}`);
      });

      connection.on(LiveTranscriptionEvents.Close, () => {
        setIsListening(false);
      });

      connection.on(LiveTranscriptionEvents.Transcript, (event) => {
        const data = event as {
          is_final?: boolean;
          channel?: {
            alternatives?: Array<{ transcript?: string }>;
          };
        };

        const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
        if (data.is_final && transcript) {
          void options.onFinalTranscript(transcript);
        }
      });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = getPreferredMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = async (blobEvent) => {
        if (!blobEvent.data || blobEvent.data.size === 0 || !connectionRef.current) {
          return;
        }
        const audioBuffer = await blobEvent.data.arrayBuffer();
        connectionRef.current.send(audioBuffer);
      };

      recorder.start(250);
    } catch (listenError) {
      setIsListening(false);
      setIsConnecting(false);
      setError((listenError as Error).message);
      stopListening();
      throw listenError;
    }
  }, [options, stopListening]);

  return {
    isConnecting,
    isListening,
    error,
    startListening,
    stopListening,
  };
}
