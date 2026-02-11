"use client";

import { useEffect, useRef } from "react";

type AvatarVideoProps = {
  isStreamReady: boolean;
  attachToElement: (element: HTMLMediaElement | null) => void;
};

export function AvatarVideo({ isStreamReady, attachToElement }: AvatarVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!isStreamReady) {
      return;
    }
    attachToElement(videoRef.current);
  }, [attachToElement, isStreamReady]);

  return (
    <div className="relative aspect-video w-full max-h-[52vh] overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
      <video ref={videoRef} autoPlay playsInline className="h-full w-full object-contain" />
      {!isStreamReady ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
          Avatar stream not ready
        </div>
      ) : null}
    </div>
  );
}
