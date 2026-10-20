// Test helper: an IntersectionObserver the test drives by hand. happy-dom's
// own never reports anything on screen.
import { vi } from "vitest";

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;

export function installFakeIntersectionObserver() {
  const observers = new Set<{ callback: Callback; targets: Set<Element> }>();
  class FakeIntersectionObserver {
    private readonly entry: { callback: Callback; targets: Set<Element> };
    constructor(callback: Callback) {
      this.entry = { callback, targets: new Set() };
      observers.add(this.entry);
    }
    observe(target: Element) {
      this.entry.targets.add(target);
    }
    unobserve(target: Element) {
      this.entry.targets.delete(target);
    }
    disconnect() {
      this.entry.targets.clear();
      observers.delete(this.entry);
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

  /** Report `targets` at `ratio` of their area on screen (0 = off screen). */
  const show = (targets: Element[], ratio = 1) => {
    for (const observer of observers) {
      const entries = targets
        .filter((target) => observer.targets.has(target))
        .map((target) => ({
          target,
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
        }));
      if (entries.length) observer.callback(entries);
    }
  };
  const observed = () =>
    [...observers].flatMap((observer) => [...observer.targets]);
  return { show, observed };
}
