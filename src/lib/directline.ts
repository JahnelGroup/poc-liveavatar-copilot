const DIRECT_LINE_BASE_URL = "https://directline.botframework.com/v3/directline";

type DirectLineActivity = {
  id?: string;
  type?: string;
  text?: string;
  from?: {
    id?: string;
    role?: string;
  };
};

type ActivitiesResponse = {
  activities?: DirectLineActivity[];
  watermark?: string;
};

const jsonHeaders = {
  "Content-Type": "application/json",
};

export async function generateDirectLineToken(secret: string) {
  const response = await fetch(`${DIRECT_LINE_BASE_URL}/tokens/generate`, {
    method: "POST",
    headers: {
      ...jsonHeaders,
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({}),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Direct Line token request failed: ${response.status}`);
  }

  return (await response.json()) as {
    conversationId?: string;
    token: string;
    expires_in?: number;
  };
}

export async function startDirectLineConversation(token: string) {
  const response = await fetch(`${DIRECT_LINE_BASE_URL}/conversations`, {
    method: "POST",
    headers: {
      ...jsonHeaders,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Direct Line conversation request failed: ${response.status}`);
  }

  return (await response.json()) as {
    conversationId: string;
    token?: string;
    streamUrl?: string;
    expires_in?: number;
  };
}

export async function sendDirectLineMessage(params: {
  token: string;
  conversationId: string;
  text: string;
  userId?: string;
}) {
  const response = await fetch(
    `${DIRECT_LINE_BASE_URL}/conversations/${params.conversationId}/activities`,
    {
      method: "POST",
      headers: {
        ...jsonHeaders,
        Authorization: `Bearer ${params.token}`,
      },
      body: JSON.stringify({
        type: "message",
        from: { id: params.userId ?? "user" },
        text: params.text,
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Direct Line send message failed: ${response.status}`);
  }

  return (await response.json()) as { id?: string };
}

export async function pollDirectLineBotReply(params: {
  token: string;
  conversationId: string;
  watermark?: string;
  timeoutMs?: number;
  intervalMs?: number;
}) {
  const timeoutMs = params.timeoutMs ?? 30_000;
  const intervalMs = params.intervalMs ?? 1_500;
  const start = Date.now();
  let watermark = params.watermark;

  while (Date.now() - start < timeoutMs) {
    const query = watermark ? `?watermark=${encodeURIComponent(watermark)}` : "";
    const response = await fetch(
      `${DIRECT_LINE_BASE_URL}/conversations/${params.conversationId}/activities${query}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${params.token}`,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      throw new Error(`Direct Line poll failed: ${response.status}`);
    }

    const payload = (await response.json()) as ActivitiesResponse;
    watermark = payload.watermark ?? watermark;

    const botMessage = payload.activities?.find(
      (activity) =>
        activity.type === "message" &&
        activity.from?.role === "bot" &&
        Boolean(activity.text?.trim()),
    );

    if (botMessage?.text) {
      return {
        botReply: botMessage.text,
        watermark,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Timed out waiting for Copilot bot reply");
}
