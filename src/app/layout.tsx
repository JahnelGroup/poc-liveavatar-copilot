import type { Metadata } from "next";
import "./globals.css";

const appTitle = process.env.NEXT_PUBLIC_APP_TITLE ?? "LiveAvatar Copilot";

export const metadata: Metadata = {
  title: appTitle,
  description:
    "LiveAvatar LITE mode with Copilot Studio, Deepgram STT, ElevenLabs TTS, and LiveKit streaming.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
