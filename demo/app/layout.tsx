import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "better-inbox demo",
  description: "In-app notifications for better-auth apps",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
