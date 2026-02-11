# ElevenLabs Voice IDs (Free-tier API compatible)

This project uses ElevenLabs for TTS. Configure the voice via:

- `ELEVENLABS_VOICE_ID` in `.env.local`

This list is intentionally limited to **voices that successfully synthesize via the API with a free-tier key** (tested against this repo’s ElevenLabs endpoint).

> Note: Some voices (often **professional/library** voices) will return `payment_required` on free tier.

---

## Voices that work via API on free tier (your account)

Validated using the same endpoint this repo uses: `POST /v1/text-to-speech/{voiceId}/with-timestamps?output_format=pcm_24000`.

| Name | Voice ID | Category |
|---|---|---|
| Bella - Professional, Bright | `hpp4J3VqNfWAUOO0d1Us` | `premade` |
| Roger - Laid-Back, Casual | `CwhRBWXzGAHq8TQ4Fs17` | `premade` |
| Sarah - Mature, Reassuring | `EXAVITQu4vr4xnSDxMaL` | `premade` |
| Laura - Enthusiast, Quirky | `FGY2WhTYpPnrIDTdsKH5` | `premade` |
| Charlie - Deep, Confident | `IKne3meq5aSn9XLyUdCD` | `premade` |
| George - Warm, Captivating | `JBFqnCBsd6RMkjVDRZzb` | `premade` |
| Callum - Husky Trickster | `N2lVS1w4EtoT3dr4eOWO` | `premade` |
| River - Relaxed, Neutral | `SAz9YHcvj6GT2YYXdXww` | `premade` |

## Voices that do NOT work via API on free tier (your account)

These returned `402 payment_required` with the message “Free users cannot use library voices via the API”:

| Name | Voice ID | Category |
|---|---|---|
| Jerry B. - Hyper-Real Conversational | `1t1EeRixsJrKbiF1zwM6` | `professional` |
| Josh - Teacher for Kids | `nzFihrBIvB34imQBuxub` | `professional` |

---

## Current configuration

Your `.env.local` currently uses:

- `ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb` (George - Warm, Captivating)

