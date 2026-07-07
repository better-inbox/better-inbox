"use client";
import { useState, useTransition } from "react";
import { notifyMe, simulateBillingFailure } from "@/lib/actions";

export function ActionsPanel() {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function run(fn: () => Promise<void>, label: string) {
    setStatus(null);
    startTransition(async () => {
      try {
        await fn();
        setStatus(`${label} ✓`);
      } catch (err) {
        setStatus(`${label} failed: ${(err as Error).message}`);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(notifyMe, "Notify me")}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Notify me
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(simulateBillingFailure, "Simulate billing failure")}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        >
          Simulate billing failure
        </button>
      </div>
      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
    </div>
  );
}
