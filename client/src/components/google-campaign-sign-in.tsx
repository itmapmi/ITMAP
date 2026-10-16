import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { GoogleSignInButton } from "@/components/google-sign-in-button";

const GIS_SCRIPT_ID = "google-identity-services";
const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const CAMPAIGN_PARAM = "google_campaign";

type GoogleCredentialResponse = { credential?: string };
type GoogleIdentity = {
  initialize: (options: {
    client_id: string;
    nonce: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select: true;
    use_fedcm_for_prompt: true;
    itp_support: true;
  }) => void;
  prompt: () => void;
  cancel: () => void;
  disableAutoSelect?: () => void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentity } };
  }
}

let gisScriptPromise: Promise<void> | null = null;

function loadGoogleIdentityServices(): Promise<void> {
  const existing = document.getElementById(GIS_SCRIPT_ID) as HTMLScriptElement | null;
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gisScriptPromise) return gisScriptPromise;

  gisScriptPromise = new Promise((resolve, reject) => {
    const script = existing ?? document.createElement("script");
    const onLoad = () => resolve();
    const onError = () => reject(new Error("Google sign-in could not be loaded."));
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.id = GIS_SCRIPT_ID;
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else if (window.google?.accounts?.id) {
      resolve();
    }
  });

  return gisScriptPromise;
}

function currentMarketReturnTo(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function isCampaignMarketPath(pathname: string): boolean {
  return /^\/(?:mobile\/)?markets\/[^/]+\/?$/.test(pathname);
}

function serverMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function isSafeMarketReturnTo(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return false;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && isCampaignMarketPath(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Campaign-only Google One Tap invitation. The existing Google OAuth button
 * remains the explicit fallback and keeps its established return flow.
 */
export function GoogleCampaignSignIn() {
  const [location] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [serverAlreadyAuthenticated, setServerAlreadyAuthenticated] = useState(false);
  const [error, setError] = useState("");
  const activeRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const initializedRef = useRef(false);

  const returnTo = typeof window === "undefined" ? "" : currentMarketReturnTo();
  const url = typeof window === "undefined" ? null : new URL(window.location.href);
  const campaignEnabled = !!url
    && isCampaignMarketPath(url.pathname)
    && url.searchParams.get(CAMPAIGN_PARAM) === "1";

  useEffect(() => {
    setDismissed(false);
    setServerAlreadyAuthenticated(false);
    setError("");
  }, [location, returnTo]);

  useEffect(() => {
    if (!campaignEnabled || isLoading || isAuthenticated || dismissed || serverAlreadyAuthenticated) return;

    let disposed = false;
    const controller = new AbortController();
    activeRef.current = true;
    initializedRef.current = false;
    submitInFlightRef.current = false;

    const runOneTap = async () => {
      try {
        const configUrl = `/auth/google/one-tap/config?${new URLSearchParams({ returnTo })}`;
        const configResponse = await fetch(configUrl, {
          credentials: "include",
          signal: controller.signal,
        });
        if (disposed) return;
        if (configResponse.status === 204) {
          setServerAlreadyAuthenticated(true);
          return;
        }
        const config = await configResponse.json().catch(() => ({})) as {
          clientId?: string;
          nonce?: string;
          returnTo?: string;
          message?: string;
        };
        if (!configResponse.ok) {
          setError(serverMessage(config, "Google sign-in is temporarily unavailable."));
          return;
        }
        if (!config.clientId || !config.nonce) {
          setError("Google sign-in is temporarily unavailable.");
          return;
        }

        await loadGoogleIdentityServices();
        if (disposed || !activeRef.current) return;
        const googleId = window.google?.accounts?.id;
        if (!googleId || initializedRef.current) return;

        initializedRef.current = true;
        googleId.initialize({
          client_id: config.clientId,
          nonce: config.nonce,
          auto_select: true,
          use_fedcm_for_prompt: true,
          itp_support: true,
          callback: async ({ credential }) => {
            if (!activeRef.current || disposed || !credential || submitInFlightRef.current) return;
            submitInFlightRef.current = true;
            try {
              const response = await fetch("/auth/google/one-tap", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ credential }),
              });
              const body = await response.json().catch(() => ({})) as {
                ok?: boolean;
                returnTo?: string;
                message?: string;
              };
              if (!activeRef.current || disposed) return;
              if (!response.ok || body.ok !== true || !isSafeMarketReturnTo(body.returnTo)) {
                setError(serverMessage(body, "Google sign-in could not be completed. Please use the button below."));
                submitInFlightRef.current = false;
                return;
              }
              window.location.assign(body.returnTo);
            } catch {
              if (activeRef.current && !disposed) {
                setError("Google sign-in could not be completed. Please use the button below.");
                submitInFlightRef.current = false;
              }
            }
          },
        });
        googleId.prompt();
      } catch (cause) {
        if (!disposed && !controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Google sign-in is temporarily unavailable.");
        }
      }
    };

    void runOneTap();
    return () => {
      disposed = true;
      activeRef.current = false;
      controller.abort();
      window.google?.accounts?.id?.cancel();
    };
  }, [campaignEnabled, dismissed, isAuthenticated, isLoading, returnTo, serverAlreadyAuthenticated]);

  if (!campaignEnabled || isLoading || isAuthenticated || dismissed || serverAlreadyAuthenticated) return null;

  return (
    <aside
      aria-label="Campaign sign-in"
      className="fixed bottom-4 right-4 z-50 w-[min(23rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-4 text-slate-800 shadow-xl shadow-slate-900/10"
      data-testid="google-campaign-sign-in"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">ITMAP access</p>
          <h2 className="mt-1 text-base font-semibold leading-snug text-slate-900">Continue with Google</h2>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss Google sign-in"
          className="rounded-md px-2 py-1 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600"
        >
          Dismiss
        </button>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        Sign in to save your research. Reports and Intelligence keep their existing profile requirements.
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}
      <GoogleSignInButton
        returnTo={returnTo}
        className="mt-4 border-slate-200 bg-slate-50 hover:bg-slate-100 focus-visible:ring-offset-white"
      />
    </aside>
  );
}

export default GoogleCampaignSignIn;
