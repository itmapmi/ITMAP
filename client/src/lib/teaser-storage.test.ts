import { describe, expect, it, vi } from "vitest";
import { createTeaserStore, TEASER_STORAGE_KEY } from "./teaser-storage";
import { computeTeaserSchedule } from "./teaser-schedule";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("persistent anonymous preview history", () => {
  it("keeps the timer, dismissals and forced gate after a browser restart", () => {
    const disk = storage();
    const first = createTeaserStore(disk, storage());
    first.update({ startAt: 1000, lastShownAt: 46000, expiryTracked: true });
    first.dismiss();
    first.dismiss();
    first.update({ forcedTriggered: true });
    const restarted = createTeaserStore(disk, storage());
    expect(restarted.read()).toEqual({
      startAt: 1000, lastShownAt: 46000, dismissCount: 2,
      expiryTracked: true, forcedTriggered: true,
    });
    const schedule = computeTeaserSchedule({
      ...restarted.read(), now: 200000, anonymous: true, isExempt: false,
    });
    expect(schedule.forced).toBe(true);
    expect(schedule.teaserActive).toBe(false);
    expect(schedule.eligibleToAutoShow).toBe(true);
  });

  it("shares progress with an already open tab without stale writes resetting it", () => {
    const disk = storage();
    const a = createTeaserStore(disk, storage());
    const b = createTeaserStore(disk, storage());
    a.update({ startAt: 1000 });
    a.dismiss();
    expect(b.read().dismissCount).toBe(1);
    b.dismiss();
    b.update({ forcedTriggered: true });
    a.update({ startAt: 9000, dismissCount: 0, forcedTriggered: false });
    expect(a.read()).toMatchObject({ startAt: 1000, dismissCount: 2, forcedTriggered: true });
    expect(b.read()).toEqual(a.read());
  });

  it("migrates an existing tab's session history and keeps the earliest start", () => {
    const disk = storage();
    createTeaserStore(disk, null).update({ startAt: 5000, dismissCount: 1 });
    const oldTab = storage();
    oldTab.setItem("itmap_teaser_start_at", "1000");
    oldTab.setItem("itmap_teaser_dismiss_count", "2");
    oldTab.setItem("itmap_teaser_forced_triggered", "1");
    const migrated = createTeaserStore(disk, oldTab);
    expect(migrated.read()).toMatchObject({ startAt: 1000, dismissCount: 2, forcedTriggered: true });
    expect(createTeaserStore(disk, null).read()).toEqual(migrated.read());
  });

  it("does not start a clock merely by loading storage on a listing/legal page", () => {
    expect(createTeaserStore(storage(), storage()).read()).toMatchObject({
      startAt: null, dismissCount: 0, forcedTriggered: false,
    });
  });

  it("does not interfere with signed-in access or exempt-route auto-show guards", () => {
    const base = {
      now: 200000, startAt: 1000, dismissCount: 2, lastShownAt: 50000,
      forcedTriggered: true, anonymous: false, isExempt: false,
    };
    expect(computeTeaserSchedule(base).eligibleToAutoShow).toBe(false);
    expect(computeTeaserSchedule({ ...base, anonymous: true, isExempt: true }).eligibleToAutoShow).toBe(false);
  });

  it("handles malformed storage and restricted browsers without breaking the app", () => {
    const disk = storage();
    disk.setItem(TEASER_STORAGE_KEY, "{broken");
    const warn = vi.fn();
    const recovered = createTeaserStore(disk, null, warn);
    expect(warn).toHaveBeenCalledTimes(1);
    recovered.update({ startAt: 1000 });
    expect(recovered.read().startAt).toBe(1000);
    const blocked = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    };
    const warnBlocked = vi.fn();
    const fallback = createTeaserStore(blocked, blocked, warnBlocked);
    fallback.update({ startAt: 1000 });
    fallback.dismiss();
    expect(fallback.read()).toMatchObject({ startAt: 1000, dismissCount: 1 });
    expect(warnBlocked).toHaveBeenCalledTimes(1);
  });

  it("ignores invalid stored fields and keeps another browser independent", () => {
    const disk = storage();
    disk.setItem(TEASER_STORAGE_KEY, JSON.stringify({
      startAt: -1, dismissCount: "2", lastShownAt: "yesterday", forcedTriggered: "true",
    }));
    expect(createTeaserStore(disk, null).read()).toMatchObject({
      startAt: null, dismissCount: 0, forcedTriggered: false,
    });
    createTeaserStore(disk, null).update({ startAt: 1000, forcedTriggered: true });
    expect(createTeaserStore(storage(), null).read().forcedTriggered).toBe(false);
  });
});
