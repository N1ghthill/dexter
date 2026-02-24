export type LiveAnnouncer = {
  announce: (message: string) => void;
  clear: () => void;
};

export type LiveAnnouncerOptions = {
  clearAfterMs: number;
  dedupeWindowMs?: number;
};

type LiveRegionAnnouncementState = { message: string; announcedAtMs: number };

export function createLiveAnnouncer(element: HTMLElement, options: LiveAnnouncerOptions): LiveAnnouncer {
  let clearTimer: number | null = null;
  let lastAnnouncement: LiveRegionAnnouncementState | null = null;

  const clear = (): void => {
    if (clearTimer !== null) {
      window.clearTimeout(clearTimer);
      clearTimer = null;
    }
    element.textContent = '';
    lastAnnouncement = null;
  };

  const announce = (message: string): void => {
    const now = Date.now();
    const dedupeWindowMs = options.dedupeWindowMs ?? 0;
    const isDuplicateWithinWindow =
      dedupeWindowMs > 0 &&
      lastAnnouncement !== null &&
      lastAnnouncement.message === message &&
      now - lastAnnouncement.announcedAtMs < dedupeWindowMs;

    if (clearTimer !== null) {
      window.clearTimeout(clearTimer);
      clearTimer = null;
    }

    if (!isDuplicateWithinWindow) {
      lastAnnouncement = { message, announcedAtMs: now };
      // Force SR announcement even when the same message repeats (outside dedupe window).
      element.textContent = '';
      window.setTimeout(() => {
        element.textContent = message;
      }, 0);
    }

    clearTimer = window.setTimeout(() => {
      element.textContent = '';
      clearTimer = null;
      if (lastAnnouncement?.message === message) {
        lastAnnouncement = null;
      }
    }, options.clearAfterMs);
  };

  return { announce, clear };
}
