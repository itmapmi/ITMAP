import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Timer, UserPlus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { track } from "@/lib/track";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PersonaRegistrationForm } from "@/components/persona-registration-form";

// ── Timed free-access teaser ────────────────────────────────────────────────
//
// Anonymous visitors get a short window of fully unlocked browsing (starting
// on their very first page load, from whatever page they land on) before a
// registration prompt starts nudging them. The prompt reopens on a cooldown a
// limited number of times, then backs off into a small persistent pill rather
// than nagging forever.
//
// All "should the modal be showing right now" state is derived on every tick
// from values persisted in sessionStorage (start time, dismiss count, last
// shown time) rather than from refs that reset on remount — a page refresh
// must never re-arm nagging that has already been dismissed or backed off.

const TEASER_DURATION_MS = 45_000;
const REOPEN_INTERVAL_MS = 30_000;
const MAX_AUTO_REOPENS = 3;

const START_KEY = "itmap_teaser_start_at";
const DISMISS_COUNT_KEY = "itmap_teaser_dismiss_count";
const LAST_SHOWN_AT_KEY = "itmap_teaser_last_shown_at";
const EXPIRY_TRACKED_KEY = "itmap_teaser_expiry_tracked";

// Pages an anonymous visitor may be deliberately on where the modal (or the
// underlying teaser mechanics) shouldn't interrupt or auto-pop.
const EXEMPT_PATHS = new Set(["/login", "/register", "/terms", "/privacy", "/contact"]);

interface TeaserGateContextValue {
  /** True while an anonymous visitor is still inside their free-access window. */
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

  const startRef = useRef<number | null>(null);
  // Total number of times the auto-cadence modal has been shown & dismissed
  // this session. Drives both the reopen interval and the permanent backoff.
  const dismissCountRef = useRef(readInt(DISMISS_COUNT_KEY));
  // When the modal was last auto-shown (expiry or scheduled reopen), so the
  // next-eligible-time can be recomputed correctly even after a page refresh.
  const lastShownAtRef = useRef<number | null>(readIntOrNull(LAST_SHOWN_AT_KEY));
  const expiryTrackedRef = useRef(readBool(EXPIRY_TRACKED_KEY));

  // Establish (or resume) the session-wide teaser start timestamp once. It
  // persists across in-app navigation via sessionStorage and only resets on
  // a brand new tab/session — regardless of which page the visitor lands on.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const existing = window.sessionStorage.getItem(START_KEY);
    if (existing) {
      startRef.current = parseInt(existing, 10);
    } else {
      const ts = Date.now();
      window.sessionStorage.setItem(START_KEY, String(ts));
      startRef.current = ts;
      track("teaser_started");
    }
  }, []);

  // Tick every second so consumers (this provider included) re-render as the
  // teaser window elapses.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = startRef.current !== null ? now - startRef.current : 0;
  const teaserActive = !isLoading && !isAuthenticated && elapsed < TEASER_DURATION_MS;
  const teaserRemainingMs = teaserActive ? Math.max(0, TEASER_DURATION_MS - elapsed) : 0;
  const expired = !isLoading && !isAuthenticated && startRef.current !== null && elapsed >= TEASER_DURATION_MS;
  const isExempt = EXEMPT_PATHS.has(location);
  const backoffReached = dismissCountRef.current >= MAX_AUTO_REOPENS;

  const nextAutoShowAt =
    lastShownAtRef.current !== null
      ? lastShownAtRef.current + REOPEN_INTERVAL_MS
      : (startRef.current ?? 0) + TEASER_DURATION_MS;

  // Never auto-pop while the visitor is deliberately on an auth-adjacent or
  // legal page, once they've exhausted the reopen budget, or once signed in.
  const eligibleToAutoShow =
    expired && !isExempt && !backoffReached && now >= nextAutoShowAt;

  const showBanner = expired && !isExempt && !isAuthenticated && backoffReached;

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
    lastShownAtRef.current = shownAt;
    writeInt(LAST_SHOWN_AT_KEY, shownAt);
    setModalOpen(true);
    if (isFirstShow && !expiryTrackedRef.current) {
      expiryTrackedRef.current = true;
      writeBool(EXPIRY_TRACKED_KEY, true);
      track("teaser_expired");
    }
    track("registration_modal_shown", {
      metadata: { trigger: isFirstShow ? "expiry" : "reopen", count: dismissCountRef.current },
    });
  }, [eligibleToAutoShow, modalOpen, isAuthenticated]);

  const openRegistrationModal = useCallback(() => {
    if (isAuthenticated || isExempt) return;
    setModalOpen(true);
    track("registration_modal_shown", { metadata: { trigger: "manual" } });
  }, [isAuthenticated, isExempt]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
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
    [isAuthenticated]
  );

  const value: TeaserGateContextValue = { teaserActive, teaserRemainingMs, openRegistrationModal };

  // Never render the popover/banner chrome on auth-adjacent or legal pages,
  // and never once the visitor is signed in.
  const canShowChrome = !isLoading && !isAuthenticated && !isExempt;

  // Show the countdown only while the free-access clock is actually running —
  // it steps aside the moment the modal takes over so the two never overlap.
  const showCountdown = canShowChrome && teaserActive && !modalOpen;
  const remainingSeconds = Math.ceil(teaserRemainingMs / 1000);

  return (
    <TeaserGateContext.Provider value={value}>
      {children}

      {canShowChrome && (
        <Dialog open={modalOpen} onOpenChange={handleOpenChange}>
          <DialogContent className="max-w-md p-0 bg-transparent border-0 shadow-none [&_button]:text-white/80 [&_button]:opacity-100">
            <PersonaRegistrationForm persona="buyer" showToggle={false} compact />
          </DialogContent>
        </Dialog>
      )}

      {showCountdown && (
        <div
          data-testid="badge-teaser-countdown"
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-1.5 rounded-full bg-slate-900/90 backdrop-blur text-white text-xs font-medium px-3 py-2 shadow-lg shadow-black/20 border border-white/10"
        >
          <Timer className="h-3.5 w-3.5 text-cyan-400" />
          Free preview: {remainingSeconds}s left
        </div>
      )}

      {canShowChrome && showBanner && !modalOpen && (
        <button
          onClick={openRegistrationModal}
          data-testid="button-teaser-register-pill"
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white text-sm font-semibold px-4 py-2.5 shadow-lg shadow-black/20 transition-all"
        >
          <UserPlus className="h-4 w-4" />
          Register free
        </button>
      )}
    </TeaserGateContext.Provider>
  );
}
