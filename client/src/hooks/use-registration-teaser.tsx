import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Timer, UserPlus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { track } from "@/lib/track";
import { getHighIntentEarliestPromptAt, getRecentHighIntentAction, type HighIntentAction } from "@/lib/high-intent";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PersonaRegistrationForm, BUYER_VALUE_PROPOSITION } from "@/components/persona-registration-form";
import type { Market } from "@shared/schema";

// ── Timed free-access teaser ────────────────────────────────────────────────
//
// Anonymous visitors get a window of fully unlocked browsing before a
// registration prompt starts nudging them. The clock starts the first time
// they open a *market detail* page (the market listing, home page, etc. never
// start it) and then keeps running across in-app navigation for the rest of
// the tab session.
//
// Two phases after the free window:
//   1. Soft (TEASER_DURATION_MS → FORCED_AFTER_MS): a dismissible prompt that
//      reopens on a cooldown a limited number of times, then backs off into
//      a small persistent pill. Access stays fully unlocked throughout.
//   2. Forced (≥ FORCED_AFTER_MS): the prompt can no longer be dismissed and
//      market features lock until the visitor signs up.
//
// All "should the modal be showing right now" state is derived on every tick
// from values persisted in sessionStorage (start time, dismiss count, last
// shown time) rather than from refs that reset on remount — a page refresh
// must never re-arm nagging that has already been dismissed or backed off.

const TEASER_DURATION_MS = 2 * 60_000;
const FORCED_AFTER_MS = 10 * 60_000;
const REOPEN_INTERVAL_MS = 30_000;
const MAX_AUTO_REOPENS = 3;

// Only these routes start the free-access clock.
const MARKET_DETAIL_PATH = /^\/(?:mobile\/)?markets\/[^/]+/;
// Captures the market slug/id segment so the dynamic value proposition can
// look up which market the visitor is actually reading right now.
const MARKET_DETAIL_ID = /^\/(?:mobile\/)?markets\/([^/]+)/;

const START_KEY = "itmap_teaser_start_at";
const DISMISS_COUNT_KEY = "itmap_teaser_dismiss_count";
const LAST_SHOWN_AT_KEY = "itmap_teaser_last_shown_at";
const EXPIRY_TRACKED_KEY = "itmap_teaser_expiry_tracked";
const FORCED_TRIGGERED_KEY = "itmap_teaser_forced_triggered";

// Pages an anonymous visitor may be deliberately on where the modal (or the
// underlying teaser mechanics) shouldn't interrupt or auto-pop.
const EXEMPT_PATHS = new Set(["/login", "/register", "/terms", "/privacy", "/termsofservice", "/privacy-policy", "/contact"]);

interface TeaserGateContextValue {
  /**
   * True while an anonymous visitor still has full access to market
   * features: before the free-access clock has started, inside the free
   * window, and throughout the soft-prompt phase. Turns false once the
   * forced prompt takes over (`FORCED_AFTER_MS`) or once they've signed in.
   */
  teaserActive: boolean;
  /** Milliseconds remaining in the free-access window (0 once expired). */
  teaserRemainingMs: number;
  /** Open the registration modal directly (e.g. from a locked Reports icon). */
  openRegistrationModal: () => void;
}

const TeaserGateContext = createContext<TeaserGateContextValue>({
  teaserActive: false,
  teaserRemainingMs: 0,
  openRegistrationModal: () => {},
});

export function useTeaserGate(): TeaserGateContextValue {
  return useContext(TeaserGateContext);
}

function readInt(key: string): number {
  if (typeof window === "undefined") return 0;
  const raw = window.sessionStorage.getItem(key);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

function readIntOrNull(key: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function writeInt(key: string, n: number): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(key, String(n));
}

function readBool(key: string): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(key) === "1";
}

function writeBool(key: string, v: boolean): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(key, v ? "1" : "0");
}

export function TeaserGateProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();
  const [now, setNow] = useState(() => Date.now());
  const [modalOpen, setModalOpen] = useState(false);
  // Captured at the moment the modal is auto-shown, so the copy stays stable
  // for the lifetime of that one prompt even if the visitor keeps browsing.
  const [shownForAction, setShownForAction] = useState<HighIntentAction | null>(null);

  const startRef = useRef<number | null>(readIntOrNull(START_KEY));
  // Total number of times the auto-cadence modal has been shown & dismissed
  // this session. Drives both the reopen interval and the permanent backoff.
  const dismissCountRef = useRef(readInt(DISMISS_COUNT_KEY));
  // When the modal was last auto-shown (expiry or scheduled reopen), so the
  // next-eligible-time can be recomputed correctly even after a page refresh.
  const lastShownAtRef = useRef<number | null>(readIntOrNull(LAST_SHOWN_AT_KEY));
  const expiryTrackedRef = useRef(readBool(EXPIRY_TRACKED_KEY));
  // Latches permanently once the forced phase has genuinely activated, so a
  // later high-intent action can never re-open access it already locked
  // (see `forced` below — its eligibility can move forward in time via the
  // high-intent grace gate, but must never move backward once crossed).
  const forcedTriggeredRef = useRef(readBool(FORCED_TRIGGERED_KEY));

  const onMarketDetail = MARKET_DETAIL_PATH.test(location);

  // The market the visitor is currently reading, if any — drives the dynamic
  // value proposition. Keyed identically to market-details.tsx's own query so
  // the two share a cache entry instead of double-fetching.
  const currentMarketId = location.match(MARKET_DETAIL_ID)?.[1] ?? null;
  const { data: currentMarket } = useQuery<Market>({
    queryKey: ["/api/markets", currentMarketId],
    enabled: !!currentMarketId,
  });

  // Start the session-wide teaser clock the first time an anonymous visitor
  // lands on a market detail page. It then persists across in-app navigation
  // via sessionStorage and only resets on a brand new tab/session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (startRef.current !== null || !onMarketDetail || isLoading || isAuthenticated) return;
    const ts = Date.now();
    window.sessionStorage.setItem(START_KEY, String(ts));
    startRef.current = ts;
    setNow(ts);
    track("teaser_started");
  }, [onMarketDetail, isLoading, isAuthenticated]);

  // Tick every second so consumers (this provider included) re-render as the
  // teaser window elapses.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const anonymous = !isLoading && !isAuthenticated;
  const clockStarted = startRef.current !== null;
  const elapsed = clockStarted ? now - (startRef.current as number) : 0;
  // Whether the visitor is still inside their initial, no-strings-attached
  // free window (drives the countdown badge). Before the clock has started
  // there is nothing to count down, but access is equally unrestricted.
  const withinInitialWindow = anonymous && clockStarted && elapsed < TEASER_DURATION_MS;
  const teaserRemainingMs = withinInitialWindow ? Math.max(0, TEASER_DURATION_MS - elapsed) : 0;
  const expired = anonymous && clockStarted && elapsed >= TEASER_DURATION_MS;
  const isExempt = EXEMPT_PATHS.has(location);
  const backoffReached = dismissCountRef.current >= MAX_AUTO_REOPENS;

  // A high-intent action (vendor/product/ecosystem comparison, Intelligence
  // Feed) guarantees at least HIGH_INTENT_GRACE_MS of uninterrupted time
  // after it fires before any prompt auto-shows. This can only ever push the
  // eligible time later than the base schedule already allows — it never
  // brings a prompt forward.
  const highIntentGateOpenAt = getHighIntentEarliestPromptAt() ?? 0;
  const highIntentGateOpen = now >= highIntentGateOpenAt;

  // The forced (access-locking) phase must never activate ahead of the
  // prompt that explains it: if a high-intent action's grace period is still
  // running when the 10-minute mark passes, access stays unlocked until the
  // grace ends too, so the moment the visitor is actually locked out, the
  // forced dialog is already eligible to open in the same tick — never a
  // silent lock with no explanation. Once forced has genuinely activated it
  // latches permanently (via forcedTriggeredRef/sessionStorage) so a later
  // high-intent action can't accidentally re-open access by pushing
  // highIntentGateOpen back to false.
  const pastForcedThreshold = anonymous && clockStarted && elapsed >= FORCED_AFTER_MS;
  const forced = forcedTriggeredRef.current || (pastForcedThreshold && highIntentGateOpen);
  // Access stays unlocked until the forced prompt takes over.
  const teaserActive = anonymous && !forced;

  const nextAutoShowAt =
    lastShownAtRef.current !== null
      ? lastShownAtRef.current + REOPEN_INTERVAL_MS
      : (startRef.current ?? 0) + TEASER_DURATION_MS;

  // Soft phase: never auto-pop while the visitor is deliberately on an
  // auth-adjacent or legal page, once they've exhausted the reopen budget, or
  // once signed in. Forced phase: always open (off exempt pages).
  const eligibleToAutoShow =
    expired && !isExempt && highIntentGateOpen && (forced || (!backoffReached && now >= nextAutoShowAt));

  const showBanner = expired && !forced && !isExempt && !isAuthenticated && backoffReached;

  // Persist the forced latch the instant it activates so it survives a page
  // refresh and can never be undone by a subsequent high-intent action.
  useEffect(() => {
    if (forced && !forcedTriggeredRef.current) {
      forcedTriggeredRef.current = true;
      writeBool(FORCED_TRIGGERED_KEY, true);
    }
  }, [forced]);

  // Once the visitor registers, stop nudging entirely.
  useEffect(() => {
    if (isAuthenticated && modalOpen) {
      setModalOpen(false);
    }
  }, [isAuthenticated, modalOpen]);

  // If the visitor navigates onto an exempt route while the modal happens to
  // be open, close it without counting it as a dismissal (it wasn't a real
  // interaction) — otherwise it would reappear the instant they navigate
  // away from the exempt page, since it never unmounted cleanly.
  useEffect(() => {
    if (isExempt && modalOpen) {
      setModalOpen(false);
    }
  }, [isExempt, modalOpen]);

  // Auto-open the modal whenever it becomes eligible (first expiry, or a
  // reopen cooldown has elapsed) and it isn't already open.
  useEffect(() => {
    if (!eligibleToAutoShow || modalOpen || isAuthenticated) return;
    const shownAt = Date.now();
    const isFirstShow = dismissCountRef.current === 0;
    const recentAction = getRecentHighIntentAction();
    lastShownAtRef.current = shownAt;
    writeInt(LAST_SHOWN_AT_KEY, shownAt);
    setModalOpen(true);
    setShownForAction(recentAction);
    if (isFirstShow && !expiryTrackedRef.current) {
      expiryTrackedRef.current = true;
      writeBool(EXPIRY_TRACKED_KEY, true);
      track("teaser_expired");
    }
    track("registration_modal_shown", {
      metadata: {
        trigger: forced ? "forced" : isFirstShow ? "expiry" : "reopen",
        count: dismissCountRef.current,
        highIntentAction: recentAction,
      },
    });
  }, [eligibleToAutoShow, modalOpen, isAuthenticated, forced]);

  const openRegistrationModal = useCallback(() => {
    if (isAuthenticated || isExempt) return;
    const recentAction = getRecentHighIntentAction();
    setModalOpen(true);
    setShownForAction(recentAction);
    track("registration_modal_shown", { metadata: { trigger: "manual", highIntentAction: recentAction } });
  }, [isAuthenticated, isExempt]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      // Once forced, the prompt cannot be dismissed — only signing up (which
      // flips isAuthenticated and closes it) or leaving for an exempt page.
      if (!open && forced && !isAuthenticated) return;
      setModalOpen(open);
      if (!open && !isAuthenticated) {
        track("registration_modal_dismissed");
        const nextCount = dismissCountRef.current + 1;
        dismissCountRef.current = nextCount;
        writeInt(DISMISS_COUNT_KEY, nextCount);
        if (nextCount >= MAX_AUTO_REOPENS) {
          track("registration_prompt_backoff");
        }
      }
    },
    [isAuthenticated, forced]
  );

  const value: TeaserGateContextValue = { teaserActive, teaserRemainingMs, openRegistrationModal };

  // Dynamic, per-market value proposition (never a hardcoded generic line
  // when we know what the visitor is actually looking at). Falls back to the
  // generic copy off market pages or before the market has loaded.
  const marketValueProposition = currentMarket
    ? `Free, forever. No card. Unlock full vendor scores, comparisons, RFPs, security insights, and reports for ${currentMarket.name}.`
    : BUYER_VALUE_PROPOSITION;

  // Never render the popover/banner chrome on auth-adjacent or legal pages,
  // and never once the visitor is signed in.
  const canShowChrome = !isLoading && !isAuthenticated && !isExempt;

  // Show the countdown only while the free-access clock is actually running —
  // it steps aside the moment the modal takes over so the two never overlap.
  const showCountdown = canShowChrome && withinInitialWindow && !modalOpen;
  const remainingSeconds = Math.ceil(teaserRemainingMs / 1000);

  return (
    <TeaserGateContext.Provider value={value}>
      {children}

      {canShowChrome && (
        <Dialog open={modalOpen} onOpenChange={handleOpenChange}>
          <DialogContent
            data-testid={forced ? "dialog-registration-forced" : "dialog-registration-soft"}
            className={`max-w-md p-0 bg-transparent border-0 shadow-none [&_button]:text-white/80 [&_button]:opacity-100 ${
              forced ? "[&>button.absolute]:hidden" : ""
            }`}
            onEscapeKeyDown={forced ? (e) => e.preventDefault() : undefined}
            onPointerDownOutside={forced ? (e) => e.preventDefault() : undefined}
            onInteractOutside={forced ? (e) => e.preventDefault() : undefined}
          >
            <PersonaRegistrationForm
              compact
              forced={forced}
              highIntentAction={shownForAction}
              valueProposition={marketValueProposition}
            />
          </DialogContent>
        </Dialog>
      )}

      {showCountdown && (
        <div
          data-testid="badge-teaser-countdown"
          // Sits above the fixed bottom-right AI chat button (h-14, bottom-6 →
          // occupies up to 80px off the bottom) so the two never overlap,
          // regardless of viewport size — see market-details.tsx.
          className="fixed bottom-24 right-5 z-40 inline-flex items-center gap-1.5 rounded-full bg-slate-900/90 backdrop-blur text-white text-xs font-medium px-3 py-2 shadow-lg shadow-black/20 border border-white/10"
        >
          <Timer className="h-3.5 w-3.5 text-cyan-400" />
          Free preview: {remainingSeconds}s left
        </div>
      )}

      {canShowChrome && showBanner && !modalOpen && (
        <button
          onClick={openRegistrationModal}
          data-testid="button-teaser-register-pill"
          // Same bottom offset as the countdown badge above, for the same
          // reason: stay clear of the fixed AI chat button in the corner.
          className="fixed bottom-24 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white text-sm font-semibold px-4 py-2.5 shadow-lg shadow-black/20 transition-all"
        >
          <UserPlus className="h-4 w-4" />
          Register free
        </button>
      )}
    </TeaserGateContext.Provider>
  );
}
