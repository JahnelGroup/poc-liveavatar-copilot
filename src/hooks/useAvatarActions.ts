"use client";

import { useCallback } from "react";

type AvatarActionsOptions = {
  speakAudio: (base64Audio: string) => Promise<void>;
  interruptSpeech: () => Promise<void>;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
};

export function useAvatarActions(options: AvatarActionsOptions) {
  const speak = useCallback(
    async (base64Audio: string) => {
      await options.speakAudio(base64Audio);
    },
    [options],
  );

  const interrupt = useCallback(async () => {
    await options.interruptSpeech();
  }, [options]);

  const listen = useCallback(async () => {
    await options.startListening();
  }, [options]);

  const stopListening = useCallback(async () => {
    await options.stopListening();
  }, [options]);

  return {
    speak,
    interrupt,
    listen,
    stopListening,
  };
}
