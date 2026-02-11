"use client";

import { useCallback, useMemo, useState } from "react";
import { AvatarVideo } from "@/components/AvatarVideo";
import { ConfigCheck } from "@/components/ConfigCheck";
import { MicButton } from "@/components/MicButton";
import { StatusIndicator } from "@/components/StatusIndicator";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { useAvatarActions } from "@/hooks/useAvatarActions";
import { useConversationLoop } from "@/hooks/useConversationLoop";
import { useCopilotStudio } from "@/hooks/useCopilotStudio";
import { useDeepgramSTT } from "@/hooks/useDeepgramSTT";
import { useLiveAvatarSession } from "@/hooks/useLiveAvatarSession";
import { useMsalAuth } from "@/hooks/useMsalAuth";
import type { UiStatus } from "@/lib/types";

const APP_TITLE = process.env.NEXT_PUBLIC_APP_TITLE || "LiveAvatar + Copilot Studio";

type BillingLink = { label: string; url: string };

/**
 * Detect which vendor(s) a credit/quota error relates to and return the
 * appropriate billing page link(s).
 */
function getBillingLinks(errorText: string): BillingLink[] {
  if (!/credit|quota|limit reached|payment.required|exceeded/i.test(errorText)) {
    return [];
  }

  const lower = errorText.toLowerCase();
  const links: BillingLink[] = [];

  if (lower.includes("elevenlabs") || lower.includes("synthesize speech") || lower.includes("tts")) {
    links.push({
      label: "Manage ElevenLabs subscription",
      url: "https://elevenlabs.io/subscription",
    });
  }

  if (lower.includes("heygen") || lower.includes("liveavatar") || lower.includes("start session") || lower.includes("avatar")) {
    links.push({
      label: "Purchase more credits on HeyGen",
      url: "https://app.heygen.com/settings/billing",
    });
  }

  if (lower.includes("deepgram") || lower.includes("stt") || lower.includes("speech-to-text")) {
    links.push({
      label: "Manage Deepgram usage",
      url: "https://console.deepgram.com/usage",
    });
  }

  if (lower.includes("copilot") || lower.includes("power platform") || lower.includes("dataverse")) {
    links.push({
      label: "Check Power Platform billing",
      url: "https://admin.powerplatform.microsoft.com/resources/capacity",
    });
  }

  // If we matched the quota regex but couldn't identify the vendor, show all links
  if (links.length === 0) {
    links.push(
      { label: "Manage ElevenLabs subscription", url: "https://elevenlabs.io/subscription" },
      { label: "Purchase more credits on HeyGen", url: "https://app.heygen.com/settings/billing" },
      { label: "Manage Deepgram usage", url: "https://console.deepgram.com/usage" },
    );
  }

  return links;
}

export function AvatarSession() {
  const avatar = useLiveAvatarSession();
  const copilot = useCopilotStudio();
  const msalAuth = useMsalAuth();

  const avatarActions = useAvatarActions({
    speakAudio: avatar.speakAudio,
    interruptSpeech: avatar.interruptSpeech,
    startListening: avatar.startListening,
    stopListening: avatar.stopListening,
  });

  const sendCopilotMessage = useCallback(
    async (text: string) => {
      if (msalAuth.isAuthenticated) {
        const accessToken = await msalAuth.getAccessToken();
        return copilot.sendMessage(text, accessToken);
      }
      return copilot.sendMessage(text);
    },
    [copilot, msalAuth],
  );

  const exchangeConnectionToken = useCallback(
    async (params: {
      connectionToken: string;
      connectionName: string;
      tokenExchangeResourceId: string;
    }) => {
      const accessToken = msalAuth.isAuthenticated
        ? await msalAuth.getAccessToken()
        : undefined;
      return copilot.exchangeConnectionToken({ ...params, accessToken });
    },
    [copilot, msalAuth],
  );

  const submitCardAction = useCallback(
    async (params: { submitAction: Record<string, unknown> }) => {
      const accessToken = msalAuth.isAuthenticated
        ? await msalAuth.getAccessToken()
        : undefined;
      return copilot.submitCardAction({ ...params, accessToken });
    },
    [copilot, msalAuth],
  );

  const conversation = useConversationLoop({
    sendCopilotMessage,
    speakAudio: avatarActions.speak,
    interruptSpeech: avatarActions.interrupt,
    acquireConnectionToken: msalAuth.isAuthenticated
      ? msalAuth.acquireConnectionToken
      : undefined,
    exchangeConnectionToken: msalAuth.isAuthenticated
      ? exchangeConnectionToken
      : undefined,
    submitCardAction,
  });

  const deepgram = useDeepgramSTT({
    onFinalTranscript: async (text) => {
      await conversation.runTurn(text);
    },
  });

  const [manualInput, setManualInput] = useState("");
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [authDecisionMade, setAuthDecisionMade] = useState(false);

  // Gate is visible until the user either signs in or skips.
  const showGate = !authDecisionMade && !msalAuth.isAuthenticated;

  const derivedStatus = useMemo<UiStatus>(() => {
    if (localError || avatar.error || copilot.error || deepgram.error || conversation.error) {
      return "error";
    }

    if (
      avatar.sessionStatus === "requesting_token" ||
      avatar.sessionStatus === "starting" ||
      copilot.isInitializing ||
      msalAuth.isInitializing
    ) {
      return "connecting";
    }

    if (conversation.status === "thinking" || conversation.status === "speaking") {
      return conversation.status;
    }

    if (deepgram.isListening) {
      return "listening";
    }

    if (isSessionActive) {
      return "idle";
    }

    return "idle";
  }, [
    localError,
    avatar.error,
    avatar.sessionStatus,
    copilot.error,
    copilot.isInitializing,
    deepgram.error,
    deepgram.isListening,
    conversation.error,
    conversation.status,
    isSessionActive,
    msalAuth.isInitializing,
  ]);

  const errorText =
    localError ??
    msalAuth.error ??
    avatar.error ??
    copilot.error ??
    deepgram.error ??
    conversation.error ??
    null;

  // ---- Auth gate actions ----

  const signInWithMicrosoft = useCallback(async () => {
    setLocalError(null);
    try {
      // loginRedirect navigates the browser away to Microsoft login.
      // On return, handleRedirectPromise() sets the account during init,
      // so isAuthenticated will already be true and the gate won't show.
      await msalAuth.login();
    } catch (error) {
      setLocalError((error as Error).message);
    }
  }, [msalAuth]);

  const skipSignIn = useCallback(() => {
    setLocalError(null);
    setAuthDecisionMade(true);
  }, []);

  const signOutFromMicrosoft = useCallback(async () => {
    setLocalError(null);
    try {
      // logoutRedirect navigates away; post-logout state cleanup is
      // unnecessary because the page will fully reload on return.
      await msalAuth.logout();
    } catch (error) {
      setLocalError((error as Error).message);
    }
  }, [msalAuth]);

  // ---- Session actions ----

  const startFullSession = useCallback(async () => {
    setLocalError(null);
    try {
      const accessToken = msalAuth.isAuthenticated
        ? await msalAuth.getAccessToken()
        : undefined;
      await avatar.startSession();
      await copilot.initializeConversation(accessToken);
      await avatarActions.listen();
      setIsSessionActive(true);
    } catch (error) {
      await avatar.stopSession().catch(() => {
        // Best effort if startup partially succeeded.
      });
      copilot.resetConversation();
      setLocalError((error as Error).message);
      setIsSessionActive(false);
    }
  }, [avatar, avatarActions, copilot, msalAuth]);

  const stopFullSession = useCallback(async () => {
    setLocalError(null);
    deepgram.stopListening();
    await avatarActions.stopListening();
    await avatar.stopSession();
    copilot.resetConversation();
    conversation.clearHistory();
    conversation.setStatus("idle");
    setIsSessionActive(false);
  }, [avatar, avatarActions, conversation, copilot, deepgram]);

  const toggleMic = useCallback(async () => {
    setLocalError(null);
    try {
      if (deepgram.isListening) {
        deepgram.stopListening();
        await avatarActions.stopListening();
        conversation.setStatus("idle");
      } else {
        await avatarActions.listen();
        await deepgram.startListening();
        conversation.setStatus("listening");
      }
    } catch (error) {
      setLocalError((error as Error).message);
    }
  }, [avatarActions, conversation, deepgram]);

  const submitManualText = useCallback(async () => {
    const text = manualInput.trim();
    if (!text) {
      return;
    }

    setManualInput("");
    try {
      await conversation.runTurn(text);
      if (!deepgram.isListening) {
        conversation.setStatus("idle");
      }
    } catch {
      // Error is already reflected in hook state.
    }
  }, [conversation, deepgram.isListening, manualInput]);

  // ========================================================================
  // Auth gate — full-screen landing shown before the session UI
  // ========================================================================
  if (showGate) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md space-y-6 rounded-2xl border border-slate-700 bg-slate-900/80 p-8 text-center shadow-xl">
          <h1 className="text-2xl font-semibold text-white">{APP_TITLE}</h1>
          <p className="text-sm text-slate-400">
            Sign in with your Microsoft account to chat with the Copilot Studio agent.
          </p>

          <button
            type="button"
            onClick={() => void signInWithMicrosoft()}
            disabled={msalAuth.isInitializing}
            className="w-full rounded-lg bg-sky-700 px-6 py-3 text-base font-medium text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
          >
            {msalAuth.isInitializing ? "Loading..." : "Sign in with Microsoft"}
          </button>

          <button
            type="button"
            onClick={skipSignIn}
            className="text-sm text-slate-500 underline transition hover:text-slate-300"
          >
            Continue without sign-in
          </button>

          {errorText ? (
            <p className="text-sm text-rose-400">{errorText}</p>
          ) : null}
        </div>
      </main>
    );
  }

  // ========================================================================
  // Main session UI — shown after sign-in or skip
  // ========================================================================
  return (
    <main className="mx-auto flex h-screen w-full max-w-screen-2xl flex-col gap-4 overflow-hidden px-4 py-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-semibold text-white">{APP_TITLE}</h1>
        <div className="flex items-center gap-4">
          {msalAuth.isAuthenticated ? (
            <span className="text-sm text-slate-400">
              {msalAuth.user?.name ?? msalAuth.user?.username ?? "Signed in"}{" "}
              <button
                type="button"
                onClick={() => void signOutFromMicrosoft()}
                disabled={isSessionActive}
                className="ml-1 text-slate-500 underline transition hover:text-slate-300 disabled:cursor-not-allowed disabled:text-slate-600 disabled:no-underline"
              >
                sign out
              </button>
            </span>
          ) : (
            <span className="text-sm text-slate-500">not signed in</span>
          )}
          <StatusIndicator
            status={derivedStatus}
            extraText={avatar.sessionStatus === "error" ? "session error" : null}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          <AvatarVideo isStreamReady={avatar.isStreamReady} attachToElement={avatar.attachToElement} />

          <section className="grid gap-4 rounded-xl border border-slate-700 bg-slate-900/70 p-3 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={startFullSession}
                  disabled={isSessionActive || avatar.sessionStatus === "starting"}
                  className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                >
                  Start Session
                </button>
                <button
                  type="button"
                  onClick={stopFullSession}
                  disabled={!isSessionActive}
                  className="rounded-lg bg-slate-700 px-4 py-2 font-medium text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-400"
                >
                  Stop Session
                </button>
                <button
                  type="button"
                  onClick={() => void avatarActions.interrupt()}
                  disabled={!isSessionActive}
                  className="rounded-lg bg-amber-600 px-4 py-2 font-medium text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                >
                  Interrupt
                </button>
              </div>
              <MicButton
                isListening={deepgram.isListening}
                isBusy={!isSessionActive || deepgram.isConnecting || conversation.isProcessing}
                onToggle={() => void toggleMic()}
              />
              <p className="text-sm text-slate-400">
                Session state: <span className="text-slate-200">{String(avatar.sessionState)}</span> |{" "}
                Connection quality:{" "}
                <span className="text-slate-200">{String(avatar.connectionQuality)}</span>
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="manual-input" className="text-sm font-medium text-slate-300">
                Manual text test
              </label>
              <div className="flex gap-2">
                <input
                  id="manual-input"
                  value={manualInput}
                  onChange={(event) => setManualInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitManualText();
                    }
                  }}
                  placeholder="Type text to send to Copilot"
                  className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-indigo-500 placeholder:text-slate-500 focus:ring-2"
                />
                <button
                  type="button"
                  onClick={() => void submitManualText()}
                  disabled={!isSessionActive || conversation.isProcessing}
                  className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                >
                  Send
                </button>
              </div>
              {errorText ? (
                <div className="text-sm text-rose-400">
                  <p>{errorText}</p>
                  {(() => {
                    const billingLinks = getBillingLinks(errorText);
                    if (billingLinks.length === 0) return null;
                    return (
                      <div className="mt-1 space-y-0.5">
                        {billingLinks.map((link) => (
                          <p key={link.url}>
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sky-400 underline hover:text-sky-300"
                            >
                              {link.label}
                            </a>
                          </p>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              ) : null}
              {conversation.signinCard ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-sm text-amber-100">
                  <p className="font-medium">{conversation.signinCard.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-amber-200/90">
                    {conversation.signinCard.message}
                  </p>
                  {conversation.signinCard.submitAction ? (
                    conversation.isExchanging ? (
                      <div className="mt-2 flex items-center gap-2 text-amber-200/80">
                        <svg
                          className="h-4 w-4 animate-spin"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                          />
                        </svg>
                        <span>
                          Connecting to{" "}
                          {conversation.signinCard.connectionName ?? "service"}...
                        </span>
                      </div>
                    ) : (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await conversation.submitAllowAction();
                            } catch {
                              // Errors are surfaced via conversation.error
                            }
                          }}
                          className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                        >
                          Allow
                        </button>
                        <button
                          type="button"
                          onClick={() => conversation.dismissSigninCard()}
                          className="rounded-lg bg-slate-700 px-4 py-2 font-medium text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-400"
                        >
                          Cancel
                        </button>
                      </div>
                    )
                  ) : conversation.signinCard.tokenExchangeResourceUri &&
                  msalAuth.isAuthenticated ? (
                    <div className="mt-2">
                      <button
                        type="button"
                        disabled={conversation.isExchanging}
                        onClick={async () => {
                          try {
                            const scope =
                              conversation.signinCard!.tokenExchangeResourceUri!;
                            const token =
                              await msalAuth.acquireConnectionTokenInteractive(
                                scope,
                              );
                            await conversation.completeTokenExchange(token);
                          } catch {
                            // Errors are surfaced via conversation.error
                          }
                        }}
                        className="rounded-lg bg-sky-700 px-4 py-2 font-medium text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                      >
                        {conversation.isExchanging
                          ? "Connecting..."
                          : `Connect to ${conversation.signinCard.connectionName ?? "service"}`}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-amber-200/80">
                      Authorize the connection in{" "}
                      <a
                        href="https://copilotstudio.microsoft.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-300 underline hover:text-sky-200"
                      >
                        Copilot Studio
                      </a>{" "}
                      by testing the agent there first, then retry here.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <section className="flex min-h-0 w-full flex-col gap-2 lg:w-96">
          <h2 className="text-lg font-medium text-white">Conversation</h2>
          <TranscriptPanel messages={conversation.history} />
        </section>
      </div>

      <details className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
        <summary className="cursor-pointer select-none text-sm font-medium text-slate-200">
          Configuration Check
        </summary>
        <div className="mt-3">
          <ConfigCheck
            getAccessToken={msalAuth.isAuthenticated ? msalAuth.getAccessToken : undefined}
          />
        </div>
      </details>
    </main>
  );
}
