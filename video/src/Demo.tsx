import type { InboxPanelProps } from "better-inbox/react";
import { InboxPanel } from "better-inbox/react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const SNAPPY = { damping: 20, stiffness: 200 };
const SMOOTH = { damping: 200 };
const BOUNCY = { damping: 9 };

const CODE_LINES: Array<Array<{ text: string; color: string }>> = [
  [{ text: "// Stripe webhook → notify the org's admins", color: "#6b7280" }],
  [
    { text: "await ", color: "#c084fc" },
    { text: "auth.api.notify({", color: "#e5e7eb" },
  ],
  [{ text: "  body: {", color: "#e5e7eb" }],
  [
    { text: "    organizationId: ", color: "#93c5fd" },
    { text: "sub.metadata.orgId,", color: "#e5e7eb" },
  ],
  [
    { text: "    roles: ", color: "#93c5fd" },
    { text: '["owner", "admin"]', color: "#86efac" },
    { text: ",", color: "#e5e7eb" },
  ],
  [
    { text: "    type: ", color: "#93c5fd" },
    { text: '"billing.payment_failed"', color: "#86efac" },
    { text: ",", color: "#e5e7eb" },
  ],
  [
    { text: "    title: ", color: "#93c5fd" },
    { text: '"Payment failed — update your card"', color: "#86efac" },
    { text: ",", color: "#e5e7eb" },
  ],
  [
    { text: "    href: ", color: "#93c5fd" },
    { text: '"/settings/billing"', color: "#86efac" },
    { text: ",", color: "#e5e7eb" },
  ],
  [{ text: "  },", color: "#e5e7eb" }],
  [{ text: "});", color: "#e5e7eb" }],
];

const Bell = ({ size = 18 }: { size?: number }) => (
  <svg
    aria-hidden
    width={size}
    height={size}
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
);

const CodeScene = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const entrance = spring({ frame, fps, config: SMOOTH });
  const exit = interpolate(frame, [105, 118], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });

  return (
    <AbsoluteFill
      className="items-center justify-center"
      style={{ opacity: entrance * exit }}
    >
      <p
        className="mb-5 text-lg text-muted-foreground"
        style={{
          opacity: entrance,
          transform: `translateY(${(1 - entrance) * 10}px)`,
        }}
      >
        Your Stripe webhook handler:
      </p>
      <div
        className="w-[760px] rounded-xl border border-border bg-popover shadow-2xl"
        style={{ transform: `scale(${0.97 + entrance * 0.03})` }}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
          <span className="ml-3 font-mono text-sm text-muted-foreground">
            app/api/webhooks/stripe/route.ts
          </span>
        </div>
        <div className="whitespace-pre px-6 py-5 font-mono text-[17px] leading-8">
          {CODE_LINES.map((line, i) => {
            const lineIn = spring({
              frame: frame - 8 - i * 4,
              fps,
              config: SNAPPY,
            });
            return (
              <div
                key={i}
                style={{
                  opacity: lineIn,
                  transform: `translateX(${(1 - lineIn) * 14}px)`,
                }}
              >
                {line.map((seg, j) => (
                  <span key={j} style={{ color: seg.color }}>
                    {seg.text}
                  </span>
                ))}
                {line.length === 0 ? " " : null}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const inboxState: InboxPanelProps["inbox"] = {
  notifications: [
    {
      id: "n1",
      userId: "user_admin",
      organizationId: "org_acme",
      type: "billing.payment_failed",
      title: "Payment failed — update your card",
      body: "Acme's card ending in 4242 was declined.",
      href: "/settings/billing",
      read: false,
      createdAt: new Date(),
    },
  ],
  unreadCount: 1,
  isLoading: false,
  hasMore: false,
  error: null,
  refresh: async () => {},
  loadMore: async () => {},
  markRead: async () => {},
  markAllRead: async () => {},
};

const AppScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const windowIn = spring({ frame, fps, config: SMOOTH });
  const chipIn = spring({ frame: frame - 20, fps, config: SNAPPY });
  const chipOut = interpolate(frame, [85, 100], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const badgeIn = spring({ frame: frame - 45, fps, config: BOUNCY });
  const bellRing = spring({
    frame: frame - 45,
    fps,
    config: { damping: 6, stiffness: 240 },
    durationInFrames: 30,
  });
  const bellAngle = Math.sin(bellRing * Math.PI * 3) * (1 - bellRing) * 18;
  const panelIn = spring({ frame: frame - 80, fps, config: SNAPPY });
  const captionIn = spring({ frame: frame - 110, fps, config: SMOOTH });
  const exit = interpolate(frame, [186, 200], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });

  return (
    <AbsoluteFill
      className="items-center justify-center"
      style={{ opacity: windowIn * exit }}
    >
      <div
        className="relative w-[880px] rounded-xl border border-border bg-background shadow-2xl"
        style={{ transform: `scale(${0.96 + windowIn * 0.04})` }}
      >
        {/* browser chrome */}
        <div className="flex items-center gap-2 rounded-t-xl border-b border-border bg-popover px-4 py-3">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
          <span className="mx-auto rounded-md bg-accent px-24 py-1 text-sm text-muted-foreground">
            app.acme.dev
          </span>
        </div>

        {/* app navbar */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <span className="text-lg font-semibold">Acme</span>
          <div className="flex items-center gap-4">
            <div className="relative">
              <span
                className="relative inline-flex size-9 items-center justify-center rounded-md text-foreground"
                style={{ transform: `rotate(${bellAngle}deg)` }}
              >
                <Bell />
              </span>
              {badgeIn > 0.01 ? (
                <span
                  className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground"
                  style={{ transform: `scale(${badgeIn})` }}
                >
                  1
                </span>
              ) : null}
            </div>
            <span className="flex size-8 items-center justify-center rounded-full bg-accent text-sm">
              J
            </span>
          </div>
        </div>

        {/* app body placeholder */}
        <div className="h-[330px] px-6 py-5">
          <div className="mb-4 h-6 w-44 rounded bg-accent" />
          <div className="grid grid-cols-3 gap-4">
            <div className="h-24 rounded-lg border border-border bg-popover" />
            <div className="h-24 rounded-lg border border-border bg-popover" />
            <div className="h-24 rounded-lg border border-border bg-popover" />
          </div>
          <div className="mt-4 h-40 rounded-lg border border-border bg-popover" />
        </div>

        {/* webhook chip */}
        {chipIn > 0.01 ? (
          <div
            className="absolute -top-5 left-6 flex items-center gap-2 rounded-full border border-border bg-popover px-4 py-2 text-sm shadow-lg"
            style={{
              opacity: chipIn * chipOut,
              transform: `translateY(${(1 - chipIn) * 12}px)`,
            }}
          >
            <span aria-hidden>⚡</span>
            <span className="font-mono text-muted-foreground">
              POST /api/webhooks/stripe
            </span>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
              org fan-out
            </span>
          </div>
        ) : null}

        {/* the REAL InboxPanel from the published package */}
        {panelIn > 0.01 ? (
          <div
            className="absolute right-4 top-[122px] z-10"
            style={{
              opacity: panelIn,
              transform: `translateY(${(1 - panelIn) * -10}px) scale(${
                0.97 + panelIn * 0.03
              })`,
              transformOrigin: "top right",
            }}
          >
            <InboxPanel inbox={inboxState} onNavigate={() => {}} />
          </div>
        ) : null}
      </div>

      <p
        className="mt-7 text-xl text-muted-foreground"
        style={{
          opacity: captionIn,
          transform: `translateY(${(1 - captionIn) * 10}px)`,
        }}
      >
        One call. Every owner &amp; admin. Stored in{" "}
        <span className="text-foreground">your</span> database.
      </p>
    </AbsoluteFill>
  );
};

const OutroScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleIn = spring({ frame, fps, config: SNAPPY });
  const installIn = spring({ frame: frame - 14, fps, config: SNAPPY });
  const tagIn = spring({ frame: frame - 26, fps, config: SMOOTH });

  return (
    <AbsoluteFill className="items-center justify-center gap-6">
      <div
        className="flex items-center gap-4"
        style={{
          opacity: titleIn,
          transform: `scale(${0.9 + titleIn * 0.1})`,
        }}
      >
        <span className="flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Bell size={30} />
        </span>
        <span className="text-5xl font-semibold tracking-tight">
          better-inbox
        </span>
      </div>
      <div
        className="rounded-lg border border-border bg-popover px-6 py-3 font-mono text-xl"
        style={{
          opacity: installIn,
          transform: `translateY(${(1 - installIn) * 12}px)`,
        }}
      >
        <span className="text-muted-foreground">$</span> npm install
        better-inbox
      </div>
      <div
        className="text-center"
        style={{ opacity: tagIn }}
      >
        <p className="text-xl text-muted-foreground">
          In-app notifications for better-auth apps — in your database.
        </p>
        <p className="mt-3 text-base text-muted-foreground/70">
          github.com/better-inbox
        </p>
      </div>
    </AbsoluteFill>
  );
};

export const Demo = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill className="bg-background font-sans text-foreground">
      <Sequence durationInFrames={4 * fps} premountFor={fps}>
        <CodeScene />
      </Sequence>
      <Sequence from={Math.round(3.5 * fps)} durationInFrames={200} premountFor={fps}>
        <AppScene />
      </Sequence>
      <Sequence from={300} premountFor={fps}>
        <OutroScene />
      </Sequence>
    </AbsoluteFill>
  );
};
