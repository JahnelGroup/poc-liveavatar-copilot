"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BrowserAuthError,
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type Configuration,
} from "@azure/msal-browser";

const POWER_PLATFORM_SCOPE = "https://api.powerplatform.com/.default";

type MsalUser = {
  name: string;
  username: string;
  homeAccountId: string;
};

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Microsoft sign-in failed";
}

function isInteractionInProgress(error: unknown) {
  return (
    error instanceof BrowserAuthError &&
    error.errorCode === "interaction_in_progress"
  );
}

function getConfig(): Configuration | null {
  const clientId = process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID?.trim();
  const tenantId = process.env.NEXT_PUBLIC_ENTRA_TENANT_ID?.trim();
  if (!clientId || !tenantId) {
    return null;
  }

  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
    },
    cache: {
      cacheLocation: "sessionStorage",
    },
  };
}

// Singleton MSAL instance — shared across React Strict Mode double-mounts.
let msalSingleton: PublicClientApplication | null = null;
let msalSingletonConfig: string | null = null;

function getMsalInstance(config: Configuration): PublicClientApplication {
  const configKey = config.auth.clientId + "|" + config.auth.authority;
  if (msalSingleton && msalSingletonConfig === configKey) {
    return msalSingleton;
  }
  msalSingleton = new PublicClientApplication(config);
  msalSingletonConfig = configKey;
  return msalSingleton;
}

function getBestAccount(msal: PublicClientApplication) {
  return msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null;
}

function toMsalUser(account: AccountInfo | null): MsalUser | null {
  if (!account) {
    return null;
  }

  return {
    name: account.name?.trim() || account.username,
    username: account.username,
    homeAccountId: account.homeAccountId,
  };
}

export function useMsalAuth() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const msalRef = useRef<PublicClientApplication | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function initialize() {
      const config = getConfig();
      if (!config) {
        setIsInitializing(false);
        setError("Missing NEXT_PUBLIC_ENTRA_CLIENT_ID or NEXT_PUBLIC_ENTRA_TENANT_ID.");
        return;
      }

      const msal = getMsalInstance(config);
      msalRef.current = msal;

      try {
        await msal.initialize();

        // Process any returning redirect (e.g., user just came back from
        // Microsoft login). If result is non-null, a redirect sign-in
        // just completed and we can grab the account from it.
        const redirectResult = await msal.handleRedirectPromise();

        const active =
          redirectResult?.account ?? getBestAccount(msal);
        if (active) {
          msal.setActiveAccount(active);
        }
        if (!isCancelled) {
          setAccount(active);
        }
      } catch (initError) {
        if (!isCancelled) {
          setError(toErrorMessage(initError));
        }
      } finally {
        if (!isCancelled) {
          setIsInitializing(false);
        }
      }
    }

    initialize();
    return () => {
      isCancelled = true;
    };
  }, []);

  const login = useCallback(async () => {
    const msal = msalRef.current;
    if (!msal) {
      throw new Error("MSAL is not configured.");
    }

    setError(null);

    try {
      // Redirect flow: navigates the browser to Microsoft login.
      // The page will reload on return and handleRedirectPromise() in
      // the init effect picks up the account.
      await msal.loginRedirect({
        scopes: [POWER_PLATFORM_SCOPE],
        prompt: "select_account",
      });
    } catch (loginError) {
      if (isInteractionInProgress(loginError)) {
        return;
      }
      const message = toErrorMessage(loginError);
      setError(message);
      throw new Error(message);
    }
  }, []);

  const logout = useCallback(async () => {
    const msal = msalRef.current;
    if (!msal) {
      return;
    }

    setError(null);

    const active = account ?? getBestAccount(msal);
    if (!active) {
      setAccount(null);
      return;
    }

    try {
      // Redirect flow: navigates away to Microsoft logout page, then
      // redirects back to the app origin.
      await msal.logoutRedirect({
        account: active,
        postLogoutRedirectUri: typeof window !== "undefined" ? window.location.origin : undefined,
      });
    } catch (logoutError) {
      if (!isInteractionInProgress(logoutError)) {
        throw logoutError;
      }
    }
    setAccount(null);
  }, [account]);

  const getAccessToken = useCallback(async () => {
    const msal = msalRef.current;
    if (!msal) {
      throw new Error("MSAL is not configured.");
    }

    const active = account ?? getBestAccount(msal);
    if (!active) {
      throw new Error("Sign in with Microsoft before starting the Copilot session.");
    }

    setError(null);

    try {
      const silent = await msal.acquireTokenSilent({
        account: active,
        scopes: [POWER_PLATFORM_SCOPE],
      });

      if (silent.account) {
        msal.setActiveAccount(silent.account);
        setAccount(silent.account);
      }

      return silent.accessToken;
    } catch (tokenError) {
      if (tokenError instanceof InteractionRequiredAuthError) {
        // Silent token renewal failed; redirect the user to re-authenticate.
        // This navigates away — the token will be available after redirect
        // return via handleRedirectPromise() on next page load.
        await msal.acquireTokenRedirect({
          account: active,
          scopes: [POWER_PLATFORM_SCOPE],
        });

        // acquireTokenRedirect navigates away, so this line is only reached
        // if navigation hasn't started yet. Throw to signal callers.
        throw new Error("Redirecting to Microsoft for re-authentication...");
      }

      const message = toErrorMessage(tokenError);
      setError(message);
      throw new Error(message);
    }
  }, [account]);

  /**
   * Silently acquire a token for a connection-specific scope (e.g. the
   * tokenExchangeResource URI from an OAuth card).
   * Returns null if user interaction is required (consent prompt needed).
   */
  const acquireConnectionToken = useCallback(
    async (scope: string): Promise<string | null> => {
      const msal = msalRef.current;
      if (!msal) {
        throw new Error("MSAL is not configured.");
      }

      const active = account ?? getBestAccount(msal);
      if (!active) {
        return null;
      }

      try {
        const result = await msal.acquireTokenSilent({
          account: active,
          scopes: [scope],
        });
        return result.accessToken;
      } catch (tokenError) {
        if (tokenError instanceof InteractionRequiredAuthError) {
          // Consent is needed — caller should use the interactive method.
          return null;
        }
        throw tokenError;
      }
    },
    [account],
  );

  /**
   * Acquire a token for a connection-specific scope via a popup.
   * Must be called from a user gesture (click handler) so the browser
   * doesn't block the popup.
   */
  const acquireConnectionTokenInteractive = useCallback(
    async (scope: string): Promise<string> => {
      const msal = msalRef.current;
      if (!msal) {
        throw new Error("MSAL is not configured.");
      }

      const active = account ?? getBestAccount(msal);

      try {
        const result = await msal.acquireTokenPopup({
          account: active ?? undefined,
          scopes: [scope],
        });

        if (result.account) {
          msal.setActiveAccount(result.account);
          setAccount(result.account);
        }

        return result.accessToken;
      } catch (popupError) {
        if (isInteractionInProgress(popupError)) {
          throw new Error("An authentication interaction is already in progress. Please try again.");
        }
        const message = toErrorMessage(popupError);
        setError(message);
        throw new Error(message);
      }
    },
    [account],
  );

  return {
    isInitializing,
    isAuthenticated: Boolean(account),
    user: toMsalUser(account),
    error,
    login,
    logout,
    getAccessToken,
    acquireConnectionToken,
    acquireConnectionTokenInteractive,
  };
}
