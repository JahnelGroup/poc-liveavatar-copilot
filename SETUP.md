# LiveAvatar + Copilot Studio — Setup Guide

This document is the **end-to-end setup checklist** for running this repo locally (and later in production). It covers:

- Vendor accounts + API keys (HeyGen LiveAvatar, Deepgram, ElevenLabs)
- Copilot Studio agent requirements (including SharePoint knowledge sources)
- Azure Entra ID app registration, permissions, and admin consent
- Environment variables and how the app chooses an auth mode
- First-run validation + common troubleshooting errors we hit during development

> **Security**: never commit real secrets. Use `.env.local` (gitignored) for real keys. `.env.example` is the safe template.

---

## 1) Overview (what this app does)

High level:

- Browser renders a **HeyGen LiveAvatar** video session
- Browser records mic audio and streams to **Deepgram** (STT)
- Transcript is sent to **Copilot Studio** (via Next.js API routes + official Copilot SDK)
- Bot reply is sent to **ElevenLabs** (TTS) to produce PCM audio
- Browser plays PCM audio through the avatar for lip-sync/speech

For the live call flow, see the architecture diagram in `README.md`.

---

## 2) Local prerequisites

- **Node.js 18+** and **npm**
- A modern browser (Chrome/Edge recommended)
- Mic permissions enabled
- If not using `localhost`, you typically need **HTTPS** for mic capture

---

## 3) HeyGen / LiveAvatar setup

### Accounts / billing

- You need a HeyGen account with LiveAvatar access.
- If you see errors like **“No credits available for start session”**, your account needs credits / an eligible plan.

### What to collect

- **LiveAvatar API Key**
  - HeyGen dashboard → API Keys
- **Avatar ID**
  - HeyGen dashboard → Avatars → select avatar → copy ID

### Environment variables

Required:

- `LIVEAVATAR_API_KEY`
- `LIVEAVATAR_AVATAR_ID`

Common:

- `LIVEAVATAR_IS_SANDBOX` (`true` or `false`)
- `LIVEAVATAR_API_URL` (defaults to `https://api.liveavatar.com`)
- `NEXT_PUBLIC_LIVEAVATAR_API_URL` (browser-side SDK API base)

---

## 4) Deepgram (Speech-to-Text) setup

### What to collect

- **Deepgram API key**
  - Deepgram console → API Keys → Create key

### Environment variables

Required:

- `DEEPGRAM_API_KEY`

---

## 5) ElevenLabs (Text-to-Speech) setup

### What to collect

- **ElevenLabs API key**
  - ElevenLabs → Profile → API Keys
- **Voice ID**
  - ElevenLabs → Voices → pick voice → copy **Voice ID**

### Important constraints (we hit these)

- Some voices (notably **library voices**) may require a paid plan for API usage.
- You can also hit **quota/credit** limits (e.g. `quota_exceeded`, `payment_required`) depending on plan and request size.

### Environment variables

Required:

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`

Optional:

- `ELEVENLABS_MODEL_ID` (defaults to `eleven_flash_v2_5`)

---

## 6) Copilot Studio agent setup (including SharePoint)

### Agent requirements

- You need a Copilot Studio agent deployed/available in your tenant.
- Agent auth must be **“Authenticate with Microsoft”** (this repo is built around that model).

### What to collect (required for the official SDK)

- **Power Platform Environment ID**
  - Power Platform Admin Center → Environments → your environment → Details
  - Often looks like `Default-<tenant-guid>`
- **Agent schema name**
  - Copilot Studio → your agent → Settings → Agent details → Schema name

### SharePoint knowledge source requirements

If your agent uses SharePoint knowledge:

- The SharePoint site/library URL must be configured in the agent knowledge source.
- The signed-in user must have **permission to read** that SharePoint content.
- When Copilot needs access, it may return a consent card that the app must complete:
  - This repo supports the current SharePoint consent card by sending the Adaptive Card **Action.Submit** payload back to Copilot when the user clicks **Allow**.

### Environment variables

Required for SDK-based Copilot:

- `COPILOT_ENVIRONMENT_ID`
- `COPILOT_AGENT_SCHEMA_NAME`

---

## 7) Azure Entra ID setup (app registration + permissions)

This repo supports multiple Copilot auth modes. The recommended one is **delegated sign-in** (user logs in via MSAL in the browser).

### 7.1 Create an app registration

Azure Portal → Entra ID → App registrations → New registration:

- Name: e.g. `LiveAvatar Copilot`
- Supported account types: typically “Single tenant”

Record:

- **Directory (tenant) ID**
- **Application (client) ID**

### 7.2 Configure SPA platform + redirect URIs (required)

Azure Portal → App registrations → your app → Authentication:

- Add a platform → **Single-page application (SPA)**
- Add redirect URIs:
  - `http://localhost:3000` (dev)
  - `https://<your-prod-domain>` (prod, when ready)

This avoids `AADSTS9002326` (“Cross-origin token redemption… only for SPA”).

### 7.3 API permissions (Power Platform)

Azure Portal → App registrations → your app → API permissions:

- Add permission → **Power Platform API** (`https://api.powerplatform.com`)
  - Add delegated permission(s) required to invoke authenticated copilots (commonly includes `CopilotStudio.Copilots.Invoke`)
- Add permission → **Microsoft Graph**
  - Delegated: `User.Read` (basic profile)

### 7.4 Admin consent

Depending on your tenant policy, you may need an admin to grant consent:

- Azure Portal → Enterprise applications → your app → Permissions → **Grant admin consent**
  - or the “Grant admin consent” button on the app registration’s API permissions page

If not granted, users will see “Approval required”.

### 7.5 (Optional) Client secret for server-side app-only fallback

This is only needed if you want the server to authenticate without a user being signed in.

Azure Portal → App registrations → your app → Certificates & secrets:

- New client secret → copy the **Value** (shown once)

---

## 8) Environment variables (what to set)

Use `.env.example` as the canonical template:

- Copy: `cp .env.example .env.local`
- Fill in values

### Minimum required set (recommended path: delegated sign-in)

Vendors:

- `LIVEAVATAR_API_KEY`
- `LIVEAVATAR_AVATAR_ID`
- `DEEPGRAM_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`

Copilot SDK identity:

- `COPILOT_ENVIRONMENT_ID`
- `COPILOT_AGENT_SCHEMA_NAME`

Browser sign-in (MSAL):

- `NEXT_PUBLIC_ENTRA_TENANT_ID`
- `NEXT_PUBLIC_ENTRA_CLIENT_ID`

### Optional / diagnostics

- `COPILOT_DEBUG=true` enables additional server logs and safe diagnostics in some error responses.
- `NEXT_PUBLIC_APP_TITLE` sets the UI title.

### Optional fallback (server-side app-only)

- `ENTRA_TENANT_ID`
- `ENTRA_CLIENT_ID`
- `ENTRA_CLIENT_SECRET`

> Note: the browser sign-in uses **MSAL redirect** flow and requests `https://api.powerplatform.com/.default` (see `src/hooks/useMsalAuth.ts`).

---

## 9) Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

---

## 10) First-run validation checklist

- Open the app
- Sign in with Microsoft
- Click **Start Session**
  - Avatar stream appears
- Use **Manual text test**
  - Bot reply appears in transcript
  - Avatar speaks (TTS + audio)
- If SharePoint knowledge is configured:
  - Ask a SharePoint-backed question
  - Consent card appears
  - Click **Allow**
  - Bot continues and returns real SharePoint-backed answer

---

## 11) Troubleshooting (common issues)

### MSAL / Entra

- **`AADSTS9002326`**: app is configured as “Web” instead of “SPA”
  - Fix: add SPA platform + redirect URI for your origin
- **`AADSTS650057 Invalid resource`**: Power Platform API permission missing
  - Fix: add Power Platform API permissions and grant consent
- **`AADSTS650053 Invalid scope`**: wrong scope string
  - Fix: use `https://api.powerplatform.com/.default` (this repo’s default)
- **“Approval required”**: tenant requires admin consent
  - Fix: admin grants consent in Enterprise Applications / API permissions

### Copilot

- **HTTP 403**: typically consent/permission not granted (or blocked by policy)
- **HTTP 401 / InvalidAudience**: token audience doesn’t match Power Platform
  - Fix: ensure the MSAL token is issued for Power Platform (`https://api.powerplatform.com/.default`)

### HeyGen / LiveAvatar

- **No credits available**: account needs credits / plan
- **Avatar not found**: wrong avatar ID for the account/sandbox setting

### ElevenLabs

- **`payment_required`**: plan/voice restrictions (often library voice restrictions)
- **`quota_exceeded`**: not enough remaining credits for the request size

---

## 12) Optional configuration

- Set `COPILOT_DEBUG=true` to enable verbose Copilot diagnostics for development.
- Customize title with `NEXT_PUBLIC_APP_TITLE`.
- Token endpoint / Direct Line secret options exist in `.env.example`, but the recommended path for authenticated copilots is the **official SDK + Entra**.

