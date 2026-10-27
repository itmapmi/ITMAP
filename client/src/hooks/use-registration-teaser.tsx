import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Timer } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { track } from "@/lib/track";
import { getRecentHighIntentAction, type HighIntentAction } from "@/lib/high-intent";
import { computeTeaserSchedule, canDismissTeaserModal, FORCE_AFTER_DISMISS_COUNT } from "@/lib/teaser-schedule";
import { getBrowserTeaserStore, TEASER_STORAGE_KEY } from "@/lib/teaser-storage";
import { resolveRegistrationCopy } from "@/lib/registration-copy";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PersonaRegistrationForm, BUYER_VALUE_PROPOSITION } from "@/components/persona-registration-form";
import type { Market } from "@shared/schema";

// ── Timed free-access teaser ────────────────────────────────────────────────
//
// Anonymous visitors get a window of fully unlocked browsing before a
// registration prompt starts nudging them. The clock starts the first time
// they open a *market detail* page (the market listing, home page, etc. never
// start it) and then keeps running across in-app navigation for the rest of
// this browser, including other tabs and subsequent browser sessions.
//
// Fixed three-strike cadence, strictly time-driven — nothing the visitor
// clicks or opens (comparisons, tabs, etc.) can defer any of it, only an
// actual dismissal advances it:
//   1. TEASER_DURATION_MS after the clock starts: a soft, dismissible prompt.
//      Access stays fully unlocked.
//   2. SECOND_PROMPT_DELAY_MS after that prompt is dismissed: a second soft,
//      dismissible prompt.
//   3. FORCED_PROMPT_DELAY_MS after THAT prompt is dismissed: a forced
//      prompt — can no longer be dismissed, and market features lock until
//      the visitor signs up.
//
// All "should the modal be showing right now" state is derived on every tick
// from values persisted in localStorage (start time, dismiss count, last
// shown time) rather than from refs that reset on remount — a page refresh
// must never re-arm nagging that has already been dismissed or lose track of
// how far along the cadence already is.

// Only these routes start the free-access clock. Must include the legacy
// singular `/market/:id` alias (see client/src/pages/market-details.tsx and
// shared/mobile-paths.ts, both of which already treat it as the same page)
// — otherwise a visitor landing on that alias gets the exact same market
// content with the clock never starting and the pop-up never appearing.
const MARKET_DETAIL_PATH = /^\/(?:mobile\/)?markets?\/[^/]+/;
// Captures the market slug/id segment so the dynamic value proposition can
// look up which market the visitor is actually reading right now.
const MARKET_DETAIL_ID = /^\/(?:mobile\/)?markets?\/([^/]+)/;

// Pages an anonymous visitor may be deliberately on where the modal (or the
// underlying teaser mechanics) shouldn't interrupt or auto-pop.
const EXEMPT_PATHS = new Set(["/login", "/register", "/terms", "/privacy", "/termsofservice", "/privacy-policy", "/contact"]);

interface TeaserGateContextValue {
  /**
   * True while an anonymous visitor still has full access to market
   * features: before the free-access clock has started, inside the free
   * window, and throughout the soft-prompt phase. Turns false once the
   * forced prompt takes over (see teaser-schedule.ts) or once they've signed in.
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

export function TeaserGateProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("common");
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();
  const [now, setNow] = useState(() => Date.now());
  const [modalOpen, setModalOpen] = useState(false);
  // Captured at the moment the modal is auto-shown, so the copy stays stable
  // for the lifetime of that one prompt even if the visitor keeps browsing.
  const [shownForAction, setShownForAction] = useState<HighIntentAction | null>(null);

  const store = getBrowserTeaserStore();
  const history = store.read();
  const startRef = useRef<number | null>(history.startAt);
  // Total number of times the auto-cadence modal has been shown & dismissed
  // in this browser. Drives both the reopen interval and the permanent backoff.
  const dismissCountRef = useRef(history.dismissCount);
  // When the modal was last auto-shown (expiry or scheduled reopen), so the
  // next-eligible-time can be recomputed correctly even after a page refresh.
  const lastShownAtRef = useRef<number | null>(history.lastShownAt);
  const expiryTrackedRef = useRef(history.expiryTracked);
  // Latches permanently once the forced phase has genuinely activated, so a
  // later high-intent action can never re-open access it already locked
  // (see `forced` below — its eligibility can move forward in time via the
  // high-intent grace gate, but must never move backward once crossed).
  const forcedTriggeredRef = useRef(history.forcedTriggered);

  const onMarketDetail = MARKET_DETAIL_PATH.test(location);

  // The market the visitor is currently reading, if any — drives the dynamic
  // value proposition. Keyed identically to market-details.tsx's own query so
  // the two share a cache entry instead of double-fetching.
  const currentMarketId = location.match(MARKET_DETAIL_ID)?.[1] ?? null;
  const { data: currentMarket } = useQuery<Market>({
    queryKey: ["/api/markets", currentMarketId],
    enabled: !!currentMarketId,
  });

  // Start only on a market detail page; never reset on a new tab or restart.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (startRef.current !== null || !onMarketDetail || isLoading || isAuthenticated) return;
    const ts = Date.now();
    startRef.current = store.update({ startAt: ts }).startAt;
    setNow(ts);
    track("teaser_started");
  }, [onMarketDetail, isLoading, isAuthenticated, store]);

  // Synchronize other tabs immediately, and recheck on focus/resume (background
  // browser tabs may throttle timers). A stale tab cannot reduce saved progress.
  useEffect(() => {
    const sync = () => {
      const current = store.read();
      startRef.current = current.startAt;
      dismissCountRef.current = current.dismissCount;
      lastShownAtRef.current = current.lastShownAt;
      expiryTrackedRef.current = current.expiryTracked;
      forcedTriggeredRef.current = current.forcedTriggered;
      setNow(Date.now());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === TEASER_STORAGE_KEY || event.key === null) sync();
    };
    sync();
    const id = setInterval(sync, 1000);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    return () => {
      clearInterval(id);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
    };
  }, [store]);

  const anonymous = !isLoading && !isAuthenticated;
  const isExempt = EXEMPT_PATHS.has(location);

  // All the timing math (when each prompt becomes eligible, the forced
  // latch) lives in the pure computeTeaserSchedule so it stays independently
  // unit-testable — see client/src/lib/teaser-schedule.ts. It deliberately
  // takes no signal about page activity: the cadence is strict.
  const schedule = computeTeaserSchedule({
    now,
    anonymous,
    startAt: startRef.current,
    dismissCount: dismissCountRef.current,
    lastShownAt: lastShownAtRef.current,
    forcedTriggered: forcedTriggeredRef.current,
    isExempt,
  });
  const { withinInitialWindow, teaserRemainingMs, expired, forced, teaserActive, eligibleToAutoShow } = schedule;

  // Persist the forced latch the instant it activates so it survives a page
  // refresh and can never be undone by a recomputed schedule.
  useEffect(() => {
    if (forced && !forcedTriggeredRef.current) {
      forcedTriggeredRef.current = true;
      store.update({ forcedTriggered: true });
    }
  }, [forced, store]);

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
    store.update({ lastShownAt: shownAt });
    setModalOpen(true);
    setShownForAction(recentAction);
    if (isFirstShow && !expiryTrackedRef.current) {
      expiryTrackedRef.current = true;
      store.update({ expiryTracked: true });
      track("teaser_expired");
    }
    track("registration_modal_shown", {
      metadata: {
        trigger: forced ? "forced" : isFirstShow ? "expiry" : "reopen",
        count: dismissCountRef.current,
        highIntentAction: recentAction,
      },
    });
  }, [eligibleToAutoShow, modalOpen, isAuthenticated, forced, store]);

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
      const latest = store.read();
      const currentlyForced = forced || latest.forcedTriggered || latest.dismissCount >= FORCE_AFTER_DISMISS_COUNT;
      if (!open && !canDismissTeaserModal({ forced: currentlyForced, isAuthenticated })) return;
      setModalOpen(open);
      if (!open && !isAuthenticated) {
        track("registration_modal_dismissed");
        dismissCountRef.current = store.dismiss().dismissCount;
        setNow(Date.now());
      }
    },
    [isAuthenticated, forced, store]
  );

  const value: TeaserGateContextValue = { teaserActive, teaserRemainingMs, openRegistrationModal };

  // Dynamic, per-market value proposition (never a hardcoded generic line
  // when we know what the visitor is actually looking at). Falls back to the
  // generic copy off market pages or before the market has loaded.
  const marketValueProposition = currentMarket
    ? `Free, forever. No card. Unlock full vendor scores, comparisons, RFPs, security insights, and reports for ${currentMarket.name}.`
    : BUYER_VALUE_PROPOSITION;

  // Same heading/body the form renders visibly, reused here so the dialog's
  // accessible title/description (see VisuallyHidden below) always matches
  // what's on screen instead of drifting into a second, separate copy.
  const { heading: registrationHeading, bodyValueProp: registrationBody } = resolveRegistrationCopy({
    forced,
    valueProposition: marketValueProposition,
    highIntentAction: shownForAction,
  });

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
            {/* The form below already renders this same copy visibly as its
                own heading/paragraph (styled to match the card, not the
                dialog chrome) — this visually-hidden pair exists solely so
                Radix can announce a title/description to screen readers
                without a duplicate on-screen heading. */}
            <VisuallyHidden>
              <DialogTitle>{registrationHeading}</DialogTitle>
              <DialogDescription>{registrationBody}</DialogDescription>
            </VisuallyHidden>
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
          {t("teaser.freePreviewSecondsLeft", { seconds: remainingSeconds })}
        </div>
      )}

    </TeaserGateContext.Provider>
  );
}
