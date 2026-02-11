import { NextResponse } from "next/server";

type ElevenLabsResponse = {
  audio_base64?: string;
};

export async function POST(request: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID ?? "eleven_flash_v2_5";

  if (!apiKey || !voiceId) {
    return NextResponse.json(
      { error: "Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID" },
      { status: 500 },
    );
  }

  try {
    const body = (await request.json()) as { text?: string };
    const text = body.text?.trim();

    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=pcm_24000`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
        }),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      const details = await response.text();
      return NextResponse.json(
        { error: "Failed to synthesize speech with ElevenLabs", details },
        { status: response.status },
      );
    }

    const payload = (await response.json()) as ElevenLabsResponse;
    if (!payload.audio_base64) {
      return NextResponse.json(
        { error: "ElevenLabs response missing audio_base64" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        audio: payload.audio_base64,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Unexpected TTS synthesis error", details: (error as Error).message },
      { status: 500 },
    );
  }
}
