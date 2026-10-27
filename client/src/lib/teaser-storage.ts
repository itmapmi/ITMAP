// Browser-wide preview history. This is a conversion gate, not authentication:
// clearing site data or using another browser can still start a new preview.
export const TEASER_STORAGE_KEY = "itmap_teaser_history";

export interface TeaserHistory {
  startAt: number | null;
  dismissCount: number;
  lastShownAt: number | null;
  expiryTracked: boolean;
  forcedTriggered: boolean;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const empty = (): TeaserHistory => ({
  startAt: null, dismissCount: 0, lastShownAt: null,
  expiryTracked: false, forcedTriggered: false,
});
const positive = (n: unknown): number | null =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;

function normalize(value: Partial<TeaserHistory>): TeaserHistory {
  return {
    startAt: positive(value.startAt),
    dismissCount: Math.min(2, positive(value.dismissCount) ?? 0),
    lastShownAt: positive(value.lastShownAt),
    expiryTracked: value.expiryTracked === true,
    forcedTriggered: value.forcedTriggered === true,
  };
}

function merge(a: TeaserHistory, b: TeaserHistory): TeaserHistory {
  return {
    startAt: a.startAt === null ? b.startAt : b.startAt === null ? a.startAt : Math.min(a.startAt, b.startAt),
    dismissCount: Math.max(a.dismissCount, b.dismissCount),
    lastShownAt: Math.max(a.lastShownAt ?? 0, b.lastShownAt ?? 0) || null,
    expiryTracked: a.expiryTracked || b.expiryTracked,
    forcedTriggered: a.forcedTriggered || b.forcedTriggered,
  };
}

export function createTeaserStore(
  persistent: StorageLike | null,
  legacySession: StorageLike | null,
  warn: (message: string) => void = console.warn,
) {
  let cached = empty();
  let warned = false;
  const unavailable = () => {
    if (!warned) warn("Preview history storage is unavailable; persistence may be limited to this page.");
    warned = true;
  };
  // Preserve the progress of visitors who already have a tab open at release.
  try {
    if (legacySession) cached = normalize({
      startAt: Number(legacySession.getItem("itmap_teaser_start_at")),
      dismissCount: Number(legacySession.getItem("itmap_teaser_dismiss_count")),
      lastShownAt: Number(legacySession.getItem("itmap_teaser_last_shown_at")),
      expiryTracked: legacySession.getItem("itmap_teaser_expiry_tracked") === "1",
      forcedTriggered: legacySession.getItem("itmap_teaser_forced_triggered") === "1",
    });
  } catch { unavailable(); }

  function read(): TeaserHistory {
    try {
      const raw = persistent?.getItem(TEASER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") cached = merge(cached, normalize(parsed));
      }
    } catch { unavailable(); }
    return { ...cached };
  }

  function update(patch: Partial<TeaserHistory>): TeaserHistory {
    cached = merge(read(), normalize(patch));
    try {
      if (persistent) persistent.setItem(TEASER_STORAGE_KEY, JSON.stringify(cached));
      else unavailable();
    } catch { unavailable(); }
    return { ...cached };
  }

  // Save migrated progress immediately, including a previously forced gate.
  update({});
  return {
    read,
    update,
    dismiss: () => update({ dismissCount: read().dismissCount + 1 }),
  };
}

let browserStore: ReturnType<typeof createTeaserStore> | undefined;
export function getBrowserTeaserStore() {
  if (browserStore) return browserStore;
  let persistent: StorageLike | null = null;
  let legacySession: StorageLike | null = null;
  if (typeof window !== "undefined") {
    try { persistent = window.localStorage; } catch { /* handled by store */ }
    try { legacySession = window.sessionStorage; } catch { /* handled by store */ }
  }
  return browserStore = createTeaserStore(persistent, legacySession);
}
