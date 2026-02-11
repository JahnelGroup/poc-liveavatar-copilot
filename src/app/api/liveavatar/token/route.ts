import { NextResponse } from "next/server";

const LIVEAVATAR_API_URL = process.env.LIVEAVATAR_API_URL ?? "https://api.liveavatar.com";

export async function POST() {
  const apiKey = process.env.LIVEAVATAR_API_KEY;
  const avatarId = process.env.LIVEAVATAR_AVATAR_ID;
  const isSandbox = (process.env.LIVEAVATAR_IS_SANDBOX ?? "true") === "true";

  if (!apiKey || !avatarId) {
    return NextResponse.json(
      { error: "Missing LIVEAVATAR_API_KEY or LIVEAVATAR_AVATAR_ID" },
      { status: 500 },
    );
  }

  try {
    const response = await fetch(`${LIVEAVATAR_API_URL}/v1/sessions/token`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "LITE",
        avatar_id: avatarId,
        is_sandbox: isSandbox,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const details = await response.text();
      return NextResponse.json(
        { error: "Failed to retrieve LiveAvatar session token", details },
        { status: response.status },
      );
    }

    const payload = (await response.json()) as {
      data?: {
        session_token?: string;
        session_id?: string;
      };
    };

    const sessionToken = payload.data?.session_token;
    const sessionId = payload.data?.session_id;

    if (!sessionToken) {
      return NextResponse.json(
        { error: "LiveAvatar token response did not include session_token" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        session_token: sessionToken,
        session_id: sessionId,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Unexpected LiveAvatar token error", details: (error as Error).message },
      { status: 500 },
    );
  }
}
