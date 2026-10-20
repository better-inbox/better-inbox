/** Every user-facing string in the components. Override any of them with `labels`. */
export type InboxLabels = {
  /** The bell's accessible name. */
  notifications: string;
  unread: string;
  all: string;
  markAllRead: string;
  /** Shown when the list is empty. */
  empty: string;
  loadMore: string;
  /** Announced to screen readers when the unread count changes. */
  unreadCount: (count: number) => string;
  /** A notification's age under its title. */
  relativeTime: (date: Date) => string;
};

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

export const defaultInboxLabels: InboxLabels = {
  notifications: "Notifications",
  unread: "Unread",
  all: "All",
  markAllRead: "Mark all read",
  empty: "You’re all caught up",
  loadMore: "Load more",
  unreadCount: (count) =>
    count === 1 ? "1 unread notification" : `${count} unread notifications`,
  relativeTime: formatRelativeTime,
};

export const resolveLabels = (
  labels: Partial<InboxLabels> | undefined,
): InboxLabels => (labels ? { ...defaultInboxLabels, ...labels } : defaultInboxLabels);
