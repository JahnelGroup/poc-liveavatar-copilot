# Project Setup Prompt for Cursor AI Agent

## Goal

Build a full-stack web application that connects a **HeyGen LiveAvatar in LITE mode** to a **Microsoft Copilot Studio agent** as the conversational brain. The avatar should appear on screen, listen to the user via microphone, and respond by speaking the Copilot Studio bot's answers with real-time lip-synced video.

## Architecture Overview

```
User speaks into mic
        ↓
  [Deepgram STT] — transcribes audio to text
        ↓
  [Copilot Studio via Direct Line API] — sends text, receives bot reply
        ↓
  [ElevenLabs TTS] — converts bot reply text to audio (PCM/MP3)
        ↓
  [LiveAvatar LITE websocket] — sends audio via agent.speak event
        ↓
  [LiveKit WebRTC room] — avatar video streams to user's browser
```

## Tech Stack

- **Frontend**: Next.js 14+ (App Router), TypeScript, Tailwind CSS
- **Backend**: Next.js API routes (or a separate Express server if simpler)
- **LiveAvatar SDK**: `@heygen/liveavatar-web-sdk` from npm (see https://github.com/heygen-com/liveavatar-web-sdk)
- **LiveKit**: `livekit-client` npm package for WebRTC room connection
- **STT**: Deepgram JavaScript SDK (`@deepgram/sdk`) for real-time speech-to-text via WebSocket
- **TTS**: ElevenLabs API (`elevenlabs` npm package or direct REST calls to `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`)
- **Copilot Studio**: Microsoft Bot Framework Direct Line API 3.0 (REST — no special SDK needed)

## Environment Variables (.env.local)

```env
# LiveAvatar / HeyGen
LIVEAVATAR_API_KEY=your_liveavatar_api_key
LIVEAVATAR_AVATAR_ID=your_avatar_id

# Deepgram (STT)
DEEPGRAM_API_KEY=your_deepgram_api_key

# ElevenLabs (TTS)
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=your_voice_id

# Microsoft Copilot Studio (Direct Line)
COPILOT_TOKEN_ENDPOINT=https://your-token-endpoint-from-copilot-studio
COPILOT_DIRECTLINE_SECRET=your_directline_secret
```

## Step-by-Step Implementation

### 1. Project Scaffolding

```bash
npx create-next-app@latest liveavatar-copilot --typescript --tailwind --app --src-dir
cd liveavatar-copilot
npm install @heygen/liveavatar-web-sdk livekit-client @deepgram/sdk
```

### 2. Backend API Routes

Create the following API routes under `src/app/api/`:

#### `POST /api/liveavatar/token`
- Calls `https://api.liveavatar.com/v1/sessions/token` with header `X-API-KEY: {LIVEAVATAR_API_KEY}`
- Body must specify `"mode": "LITE"` and `"avatar_id": "{LIVEAVATAR_AVATAR_ID}"`
- LITE mode does NOT use `avatar_persona` (no voice_id, no context_id) — we handle TTS ourselves
- Returns `{ session_id, session_token }` to the frontend

#### `POST /api/liveavatar/start`
- Calls `https://api.liveavatar.com/v1/sessions/start` with header `Authorization: Bearer {session_token}`
- Returns the LiveKit room URL, client token, AND the websocket URL (`ws_url`) for sending commands
- The `ws_url` is critical — this is how we send `agent.speak` audio events to animate the avatar

#### `POST /api/copilot/token`
- Calls the Copilot Studio token endpoint to exchange the Direct Line secret for a temporary token
- Alternatively, calls `POST https://directline.botframework.com/v3/directline/tokens/generate` with header `Authorization: Bearer {COPILOT_DIRECTLINE_SECRET}`
- Returns `{ token, conversationId, expires_in }`

#### `POST /api/copilot/conversation`
- Starts a new Direct Line conversation: `POST https://directline.botframework.com/v3/directline/conversations` with the Direct Line token
- Returns `{ conversationId, token, streamUrl }`

#### `POST /api/copilot/message`
- Accepts `{ conversationId, token, text }` from frontend
- Sends the user's text to Copilot Studio: `POST https://directline.botframework.com/v3/directline/conversations/{conversationId}/activities` with body:
```json
{
  "type": "message",
  "from": { "id": "user" },
  "text": "the user's transcribed speech"
}
```
- Then polls `GET https://directline.botframework.com/v3/directline/conversations/{conversationId}/activities?watermark={watermark}` until a bot reply arrives (message where `from.role === "bot"`)
- Returns `{ botReply: "the bot's text response", watermark: "new_watermark" }`
- Use a polling loop with 1-2 second intervals, timeout after 30 seconds

#### `POST /api/tts/synthesize`
- Accepts `{ text }` from frontend
- Calls ElevenLabs TTS API: `POST https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}` with:
  - Header: `xi-api-key: {ELEVENLABS_API_KEY}`
  - Body: `{ "text": "...", "model_id": "eleven_flash_v2_5" }`
  - Query param or header to request PCM 16-bit 16kHz audio (or mp3 if LiveAvatar accepts it)
- Returns the audio as a base64-encoded string so the frontend can send it to LiveAvatar

#### `POST /api/deepgram/token`
- Creates a temporary Deepgram API key or returns the key for client-side WebSocket STT
- Alternatively, proxy the Deepgram WebSocket through the server

### 3. Frontend — Main Page (`src/app/page.tsx`)

Build a single-page React component with the following state and behavior:

#### UI Elements
- A large video area showing the LiveAvatar (the LiveKit video track)
- A microphone button (push-to-talk or toggle) 
- A status indicator (connecting, listening, thinking, speaking)
- A text transcript area showing the conversation history
- A start/stop session button

#### Session Lifecycle

**On "Start Session":**
1. Call `/api/liveavatar/token` to get session token (LITE mode)
2. Call `/api/liveavatar/start` to get LiveKit room URL, client token, and `ws_url`
3. Connect to the LiveKit room using `livekit-client`:
   ```ts
   import { Room, RoomEvent, Track } from 'livekit-client';
   const room = new Room();
   await room.connect(livekitUrl, clientToken);
   ```
4. Subscribe to the avatar's video and audio tracks from the LiveKit room and render them in a `<video>` element
5. Connect to the LiveAvatar websocket at `ws_url` — wait for `session.state_updated` event before sending any commands
6. Call `/api/copilot/token` and `/api/copilot/conversation` to establish a Direct Line conversation with Copilot Studio
7. Initialize Deepgram WebSocket for real-time STT

**On user speaking (mic active):**
1. Capture microphone audio using `navigator.mediaDevices.getUserMedia`
2. Stream audio chunks to Deepgram STT via WebSocket for real-time transcription
3. When Deepgram returns a final transcript (is_final === true), take the text

**On transcript received:**
1. Send the transcribed text to `/api/copilot/message`
2. Wait for the bot reply text
3. Send the bot reply text to `/api/tts/synthesize` to get audio
4. Send the audio to LiveAvatar via the websocket:
   ```ts
   ws.send(JSON.stringify({
     type: "agent.speak",
     audio: base64AudioData
   }));
   ```
5. The avatar will lip-sync and speak the audio in the LiveKit room

**On "Stop Session":**
1. Close the LiveAvatar websocket
2. Disconnect from the LiveKit room
3. Stop the Deepgram STT connection
4. Stop microphone capture

### 4. LiveAvatar LITE Mode Websocket Events

**Command events you send (JSON strings via websocket):**
- `{ "type": "agent.speak", "audio": "<base64_audio>" }` — make the avatar speak with this audio
- `{ "type": "agent.interrupt" }` — interrupt the avatar if it's currently speaking  
- `{ "type": "agent.listen" }` — transition avatar to listening state (idle animation)

**Server events you receive:**
- `{ "type": "session.state_updated", ... }` — session is ready, safe to send commands
- `{ "type": "agent.speech_started" }` — avatar started speaking
- `{ "type": "agent.speech_ended" }` — avatar finished speaking

Use `agent.speech_ended` to know when to transition the avatar back to listening state and re-enable the microphone.

### 5. Important Implementation Notes

- **LITE mode means LiveAvatar ONLY handles video generation from audio.** You must handle STT, LLM (Copilot Studio), and TTS yourself. LiveAvatar does NOT process conversational logic in LITE mode.
- **Audio format for agent.speak**: Check LiveAvatar docs for accepted audio formats. ElevenLabs can output mp3 or PCM. You may need to convert to the format LiveAvatar expects (likely PCM 16-bit 16kHz or mp3). The audio must be sent as a base64-encoded string.
- **Idle timeout**: LiveAvatar will disconnect after prolonged inactivity. Send periodic keepalive events or `agent.listen` to keep the session alive.
- **Direct Line watermark**: Track the watermark value from each poll response and include it in subsequent requests to avoid receiving duplicate messages from Copilot Studio.
- **Direct Line token refresh**: Direct Line tokens expire. Implement token refresh logic if sessions are long-lived.
- **Error handling**: Wrap all API calls in try/catch. Handle LiveKit disconnections, websocket drops, and Copilot Studio timeouts gracefully.
- **CORS**: LiveAvatar and Direct Line API calls should go through your Next.js API routes to avoid CORS issues in the browser.

### 6. File Structure

```
src/
├── app/
│   ├── page.tsx                          # Main UI with avatar video + mic controls
│   ├── layout.tsx                        # Root layout
│   ├── api/
│   │   ├── liveavatar/
│   │   │   ├── token/route.ts            # POST — get LITE session token
│   │   │   └── start/route.ts            # POST — start session, get ws_url + livekit config
│   │   ├── copilot/
│   │   │   ├── token/route.ts            # POST — get Direct Line token
│   │   │   ├── conversation/route.ts     # POST — start Direct Line conversation
│   │   │   └── message/route.ts          # POST — send message + poll for bot reply
│   │   ├── tts/
│   │   │   └── synthesize/route.ts       # POST — ElevenLabs text-to-speech
│   │   └── deepgram/
│   │       └── token/route.ts            # POST — get Deepgram auth for client STT
├── components/
│   ├── AvatarVideo.tsx                   # LiveKit video track renderer
│   ├── MicButton.tsx                     # Microphone toggle with visual feedback
│   ├── TranscriptPanel.tsx               # Conversation history display
│   └── StatusIndicator.tsx               # Connection/state indicator
├── hooks/
│   ├── useLiveAvatar.ts                  # LiveAvatar session + websocket management
│   ├── useCopilotStudio.ts              # Direct Line conversation management
│   ├── useDeepgramSTT.ts               # Real-time speech-to-text
│   └── useElevenLabsTTS.ts             # Text-to-speech synthesis
└── lib/
    ├── liveavatar.ts                     # LiveAvatar API helper functions
    ├── directline.ts                     # Direct Line API helper functions
    ├── elevenlabs.ts                     # ElevenLabs API helper functions
    └── types.ts                          # Shared TypeScript types
```

### 7. Key API Reference

**LiveAvatar LITE mode session token:**
```
POST https://api.liveavatar.com/v1/sessions/token
Header: X-API-KEY: <api_key>
Body: { "mode": "LITE", "avatar_id": "<avatar_id>" }
Response: { "session_id": "...", "session_token": "..." }
```

**LiveAvatar start session:**
```
POST https://api.liveavatar.com/v1/sessions/start
Header: Authorization: Bearer <session_token>
Response: { "livekit_url": "...", "livekit_client_token": "...", "ws_url": "..." }
```

**Direct Line start conversation:**
```
POST https://directline.botframework.com/v3/directline/conversations
Header: Authorization: Bearer <directline_token>
Response: { "conversationId": "...", "token": "...", "streamUrl": "..." }
```

**Direct Line send message:**
```
POST https://directline.botframework.com/v3/directline/conversations/{id}/activities
Header: Authorization: Bearer <token>
Body: { "type": "message", "from": { "id": "user" }, "text": "..." }
```

**Direct Line get bot reply:**
```
GET https://directline.botframework.com/v3/directline/conversations/{id}/activities?watermark={wm}
Header: Authorization: Bearer <token>
Response: { "activities": [...], "watermark": "..." }
Filter for activities where from.role === "bot" and type === "message"
```

**ElevenLabs TTS:**
```
POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
Header: xi-api-key: <api_key>
Body: { "text": "...", "model_id": "eleven_flash_v2_5" }
Response: audio/mpeg binary stream
```

## What to Build First

1. Start with just the LiveAvatar LITE session — get the avatar video rendering in the browser via LiveKit
2. Add the websocket connection and test sending a hardcoded `agent.speak` with a test audio file
3. Add the Copilot Studio Direct Line integration — test sending/receiving text messages
4. Add ElevenLabs TTS — convert bot replies to audio
5. Add Deepgram STT — transcribe user speech in real-time
6. Wire everything together into the full conversational loop
7. Polish the UI with status indicators, error handling, and conversation history

## References

- LiveAvatar docs: https://docs.liveavatar.com
- LiveAvatar Web SDK: https://github.com/heygen-com/liveavatar-web-sdk
- LiveAvatar API reference: https://docs.liveavatar.com/reference
- LiveAvatar LITE mode config: https://docs.liveavatar.com/docs/configuring-custom-mode
- LiveAvatar LITE mode lifecycle: https://docs.liveavatar.com/docs/custom-mode-life-cycle
- Copilot Studio Direct Line: https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-connect-bot-to-custom-application
- Direct Line API 3.0: https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-direct-line-3-0-concepts
- ElevenLabs API: https://elevenlabs.io/docs/api-reference/text-to-speech
- Deepgram STT: https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio
- LiveKit client SDK: https://docs.livekit.io/client-sdk-js/
