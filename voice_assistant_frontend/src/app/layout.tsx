import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Retro Voice Assistant",
  description:
    "Press-to-talk voice assistant with STT→LLM→TTS pipeline, chat history, and settings.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
