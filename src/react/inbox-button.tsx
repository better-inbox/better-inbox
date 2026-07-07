import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { InboxPanel } from "./inbox-panel";
import type { InboxFetchClient, InboxNotification } from "./use-inbox";
import { useInbox } from "./use-inbox";

export type InboxButtonProps = {
  client: InboxFetchClient;
  onNavigate?: (href: string) => void;
  renderItem?: (notification: InboxNotification) => ReactNode;
  pollInterval?: number;
  organizationId?: string;
  className?: string;
};

export function InboxButton({
  client,
  onNavigate,
  renderItem,
  pollInterval,
  organizationId,
  className,
}: InboxButtonProps) {
  const inbox = useInbox(client, {
    ...(pollInterval !== undefined ? { pollInterval } : {}),
    ...(organizationId !== undefined ? { organizationId } : {}),
  });
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) void inbox.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh only when opening
  }, [open]);

  return (
    <div ref={containerRef} className={`relative inline-block ${className ?? ""}`}>
      <button
        type="button"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex size-9 items-center justify-center rounded-md text-foreground hover:bg-accent"
      >
        <svg
          aria-hidden
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {inbox.unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
            {inbox.unreadCount > 99 ? "99+" : inbox.unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2">
          <InboxPanel
            inbox={inbox}
            onNavigate={onNavigate}
            renderItem={renderItem}
          />
        </div>
      ) : null}
    </div>
  );
}
