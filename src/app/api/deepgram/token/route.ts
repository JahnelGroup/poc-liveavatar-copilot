import { NextResponse } from "next/server";

export async function POST() {
  const apiKey = process.env.DEEPGRAM_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "Missing DEEPGRAM_API_KEY" }, { status: 500 });
  }

  // NOTE: This returns the API key to the client for browser WebSocket STT usage.
  // For production hardening, replace with short-lived scoped credentials
  // or a backend proxy for audio streaming.
  return NextResponse.json({ token: apiKey }, { status: 200 });
}
