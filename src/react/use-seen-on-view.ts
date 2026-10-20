import { useCallback, useEffect, useRef } from "react";

export type UseSeenOnViewOptions = {
  /** How long a row must stay on screen before it counts as seen. Default 1000 ms. */
  delayMs?: number;
  /** How much of the row must be on screen, from 0 to 1. Default 0.5. */
  threshold?: number;
};

/**
 * Marks a notification seen only once it has actually been on screen: at least
 * `threshold` of its row inside the viewport and every scrolling ancestor, for
 * `delayMs`, while the tab is visible. Seen cancels a pending "email if unread"
 * delivery, so a row scrolled out of sight, or a panel flicked open and shut,
 * must not count.
 *
 * Returns `seenRef(id)`, a ref callback for the row's element. Without
 * IntersectionObserver (server rendering, very old browsers) nothing is marked,
 * and the email goes out as if the row was never shown.
 */
export function useSeenOnView(
  markSeen: (ids: string[]) => Promise<void> | void,
  { delayMs = 1000, threshold = 0.5 }: UseSeenOnViewOptions = {},
): (id: string) => (element: Element | null) => void {
  const markSeenRef = useRef(markSeen);
  markSeenRef.current = markSeen;
  const delayRef = useRef(delayMs);
  delayRef.current = delayMs;
  // the observer is built once, with the threshold of the first row it watches
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;

  const ids = useRef(new Map<Element, string>());
  const elements = useRef(new Map<string, Element>());
  const onScreen = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queued = useRef(new Set<string>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const observer = useRef<IntersectionObserver | undefined>(undefined);
  const refs = useRef(new Map<string, (element: Element | null) => void>());

  const disarm = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  // rows that come into view together go out in one request
  const queue = useCallback((id: string) => {
    queued.current.add(id);
    if (flushTimer.current !== undefined) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = undefined;
      const batch = [...queued.current];
      queued.current.clear();
      if (batch.length) void markSeenRef.current(batch);
    }, 0);
  }, []);

  const arm = useCallback(
    (id: string) => {
      if (timers.current.has(id) || document.visibilityState === "hidden")
        return;
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          queue(id);
        }, delayRef.current),
      );
    },
    [queue],
  );

  const getObserver = useCallback(() => {
    if (observer.current) return observer.current;
    if (typeof IntersectionObserver === "undefined") return undefined;
    observer.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = ids.current.get(entry.target);
          if (id === undefined) continue;
          if (
            entry.isIntersecting &&
            entry.intersectionRatio >= thresholdRef.current
          ) {
            onScreen.current.add(id);
            arm(id);
          } else {
            onScreen.current.delete(id);
            disarm(id);
          }
        }
      },
      { threshold: thresholdRef.current },
    );
    return observer.current;
  }, [arm, disarm]);

  // a hidden tab is not someone looking: the clock stops, and restarts on return
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        for (const id of [...timers.current.keys()]) disarm(id);
      } else {
        for (const id of onScreen.current) arm(id);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [arm, disarm]);

  // StrictMode runs this cleanup and the effect again without detaching the
  // rows, so the effect re-observes whatever rows are already attached
  useEffect(() => {
    const io = getObserver();
    for (const element of ids.current.keys()) io?.observe(element);
    return () => {
      observer.current?.disconnect();
      observer.current = undefined;
      onScreen.current.clear();
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
      if (flushTimer.current !== undefined) clearTimeout(flushTimer.current);
      flushTimer.current = undefined;
      queued.current.clear();
    };
  }, [getObserver]);

  // one stable callback per id, so a re-render doesn't detach and reattach rows
  return useCallback(
    (id: string) => {
      const cached = refs.current.get(id);
      if (cached) return cached;
      const ref = (element: Element | null) => {
        const previous = elements.current.get(id);
        if (previous && previous !== element) {
          observer.current?.unobserve(previous);
          ids.current.delete(previous);
          elements.current.delete(id);
          onScreen.current.delete(id);
          disarm(id);
        }
        if (!element || previous === element) return;
        const io = getObserver();
        if (!io) return;
        ids.current.set(element, id);
        elements.current.set(id, element);
        io.observe(element);
      };
      refs.current.set(id, ref);
      return ref;
    },
    [getObserver, disarm],
  );
}
