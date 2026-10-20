// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeIntersectionObserver } from "./fake-intersection-observer";
import { useSeenOnView } from "./use-seen-on-view";

function Rows({
  ids,
  markSeen,
}: {
  ids: string[];
  markSeen: (ids: string[]) => void;
}) {
  const seenRef = useSeenOnView(markSeen);
  return (
    <ul>
      {ids.map((id) => (
        <li key={id} ref={seenRef(id)}>
          {id}
        </li>
      ))}
    </ul>
  );
}

const row = (id: string) => screen.getByText(id);

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setVisibility("visible");
});

describe("useSeenOnView", () => {
  it("marks rows seen after a second on screen, together in one call", async () => {
    const io = installFakeIntersectionObserver();
    const markSeen = vi.fn();
    render(<Rows ids={["a", "b", "c"]} markSeen={markSeen} />);

    act(() => io.show([row("a"), row("b")]));
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(markSeen).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(markSeen).toHaveBeenCalledTimes(1);
    expect(markSeen).toHaveBeenCalledWith(["a", "b"]);
  });

  it("does not mark a row that never came on screen", async () => {
    installFakeIntersectionObserver();
    const markSeen = vi.fn();
    render(<Rows ids={["a"]} markSeen={markSeen} />);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(markSeen).not.toHaveBeenCalled();
  });

  it("does not mark a row scrolled past, or mostly cut off", async () => {
    const io = installFakeIntersectionObserver();
    const markSeen = vi.fn();
    render(<Rows ids={["a", "b"]} markSeen={markSeen} />);

    act(() => io.show([row("a")]));
    await act(() => vi.advanceTimersByTimeAsync(500));
    act(() => io.show([row("a")], 0));
    act(() => io.show([row("b")], 0.3));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(markSeen).not.toHaveBeenCalled();
  });

  it("stops the clock while the tab is hidden and restarts it on return", async () => {
    const io = installFakeIntersectionObserver();
    const markSeen = vi.fn();
    render(<Rows ids={["a"]} markSeen={markSeen} />);

    act(() => io.show([row("a")]));
    await act(() => vi.advanceTimersByTimeAsync(800));
    act(() => setVisibility("hidden"));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(markSeen).not.toHaveBeenCalled();

    act(() => setVisibility("visible"));
    await act(() => vi.advanceTimersByTimeAsync(990));
    expect(markSeen).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(markSeen).toHaveBeenCalledWith(["a"]);
  });

  it("does not start the clock for a row that comes on screen in a hidden tab", async () => {
    const io = installFakeIntersectionObserver();
    const markSeen = vi.fn();
    render(<Rows ids={["a"]} markSeen={markSeen} />);

    act(() => setVisibility("hidden"));
    act(() => io.show([row("a")]));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(markSeen).not.toHaveBeenCalled();

    act(() => setVisibility("visible"));
    await act(() => vi.advanceTimersByTimeAsync(1010));
    expect(markSeen).toHaveBeenCalledWith(["a"]);
  });

  it("stops watching a row once it is removed", async () => {
    const io = installFakeIntersectionObserver();
    const markSeen = vi.fn();
    const { rerender } = render(<Rows ids={["a"]} markSeen={markSeen} />);
    const a = row("a");
    act(() => io.show([a]));
    rerender(<Rows ids={[]} markSeen={markSeen} />);
    expect(io.observed()).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(markSeen).not.toHaveBeenCalled();
  });

  it("marks nothing where IntersectionObserver is missing", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const markSeen = vi.fn();
    render(<Rows ids={["a"]} markSeen={markSeen} />);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(markSeen).not.toHaveBeenCalled();
  });
});
