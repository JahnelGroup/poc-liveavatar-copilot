import { NextResponse } from "next/server";
import { startDirectLineConversation } from "@/lib/directline";

type ConversationRequestBody = {
  token?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ConversationRequestBody;
    const token = body.token?.trim();

    if (!token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }

    const payload = await startDirectLineConversation(token);
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to start Copilot Direct Line conversation", details: (error as Error).message },
      { status: 500 },
    );
  }
}
