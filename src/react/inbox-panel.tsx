import type { ReactNode } from "react";
import { useState } from "react";
import type { InboxNotification, useInbox } from "./use-inbox";

export function formatRelativeTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export type InboxPanelProps = {
  inbox: ReturnType<typeof useInbox>;
  onNavigate?: ((href: string) => void) | undefined;
  renderItem?: ((notification: InboxNotification) => ReactNode) | undefined;
  className?: string | undefined;
  view?: "unread" | "all" | undefined;
  onViewChange?: ((view: "unread" | "all") => void) | undefined;
};

export function InboxPanel({
  inbox,
  onNavigate,
  renderItem,
  className,
  view,
  onViewChange,
}: InboxPanelProps) {
  const [localView, setLocalView] = useState<"unread" | "all">("unread");
  const controlled = onViewChange !== undefined;
  const tab = controlled ? (view ?? "unread") : localView;
  const setTab = controlled ? onViewChange : setLocalView;
  // a caller that owns the view fetched unread rows server-side, so its tabs
  // stay even though inbox.filter is "unread"; an uncontrolled panel whose hook
  // was locked to unread would show the same list under an "all" label
  const showTabs = controlled || inbox.filter !== "unread";
  // rows already marked read stay put until the next refresh, so the list does
  // not jump out from under the pointer mid-click
  const visible =
    !controlled && showTabs && tab === "unread"
      ? inbox.notifications.filter((n) => !n.read)
      : inbox.notifications;

  return (
    <div
      className={`flex w-96 max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-border bg-popover text-popover-foreground shadow-md ${className ?? ""}`}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        {showTabs ? (
          <div className="flex gap-1" role="tablist">
            {(["unread", "all"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`rounded-md px-2 py-1 text-sm capitalize ${
                  tab === value
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        ) : (
          <span className="px-2 py-1 text-sm text-muted-foreground">Unread</span>
        )}
        <button
          type="button"
          onClick={() => void inbox.markAllRead()}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Mark all read
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {visible.length === 0 && !inbox.isLoading ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            You&rsquo;re all caught up
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((notification) => (
              <li key={notification.id}>
                {renderItem ? (
                  renderItem(notification)
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      void inbox.markRead(notification.id);
                      if (notification.href) onNavigate?.(notification.href);
                    }}
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-accent/50"
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${
                        notification.read ? "bg-transparent" : "bg-primary"
                      }`}
                    />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">
                        {notification.title}
                      </span>
                      {notification.body ? (
                        <span className="block text-sm text-muted-foreground">
                          {notification.body}
                        </span>
                      ) : null}
                      <span className="block text-xs text-muted-foreground">
                        {formatRelativeTime(notification.createdAt)}
                      </span>
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {inbox.hasMore ? (
        <button
          type="button"
          onClick={() => void inbox.loadMore()}
          className="border-t border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Load more
        </button>
      ) : null}
    </div>
  );
}
