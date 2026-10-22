# Parlayy

**Rehearse the conversation before it happens.**

Parlayy is a voice-first practice room for high-stakes conversations. Describe a situation — a discount demand, an investor grilling, a final-round interview, an escalated customer — and Parlayy generates a believable counterpart who pushes back in real time. You speak out loud, the counterpart answers out loud, and when you end the session you get a coaching debrief grounded in what you actually said.

It is not a chatbot with a microphone bolted on. The counterpart has a private goal, a set of objections, boundaries it will not cross, and facts it is forbidden to invent. Difficulty controls how hard it pushes. Every report quote is tied to a real line from your transcript.

---

## Table of contents

- [What we built](#what-we-built)
- [Feature tour](#feature-tour)
- [How it works](#how-it-works)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Install dependencies](#1-install-dependencies)
  - [2. Get a Gradium API key](#2-get-a-gradium-api-key)
  - [3. Get an LLM API key](#3-get-an-llm-api-key)
  - [4. Configure environment variables](#4-configure-environment-variables)
  - [5. Run the development server](#5-run-the-development-server)
- [Environment variables reference](#environment-variables-reference)
- [Using Parlayy](#using-parlayy)
- [API reference](#api-reference)
- [Data storage and privacy](#data-storage-and-privacy)
- [Scripts](#scripts)
- [Troubleshooting](#troubleshooting)
- [Deployment](#deployment)
- [Known limitations and ideas](#known-limitations-and-ideas)

---

## What we built

Parlayy turns a written brief into a live, spoken rehearsal:

1. **You describe the conversation** in natural language. Optionally pick a counterpart posture (rational skeptic, impatient executive, warm collaborator, hard negotiator) and a rigor level (1–3).
2. **An LLM designs the scenario** — a named counterpart, their role and company, a briefing (situation, your goal, stakes), and a private "engine" containing the persona, hidden goal, objections, boundaries, knowledge limits, and stopping conditions.
3. **You speak with the counterpart** over a full-duplex voice loop. Gradium handles speech-to-text and text-to-speech; the LLM handles the in-character replies.
4. **Live coaching telemetry** estimates leverage, talk-to-listen ratio, assertiveness, objections solved, and gives you a concrete next line while the conversation is still running.
5. **A debrief report** evaluates your performance with exact quotes, missed opportunities, better alternatives, pushback breakdowns, and concrete next steps.

There are also four pre-calibrated scenarios so you can start without writing a brief.

---

## Feature tour

### Scenario generation
- Free-text brief (10–2000 characters).
- Four one-click presets: negotiate a fee, pitch an institutional investor, executive interview, difficult board confrontation.
- Four counterpart postures: **Rational Skeptic**, **Impatient Executive**, **Warm Collaborator**, **Hard Negotiator**.
- Three rigor levels that map to difficulty tiers:
  - **1 — Exploratory tone** → `easy` ("Warm")
  - **2 — Balanced rigor** → `medium` ("Realistic")
  - **3 — High pushback** → `hard` ("Adversarial")
- The generated scenario is schema-validated with Zod before it is accepted. Malformed LLM output returns a friendly error instead of crashing.

### Pre-calibrated scenarios
| ID | Title | Category | Counterpart | Voice |
| --- | --- | --- | --- | --- |
| `client-price` | The Discount Demand | Freelance / Sales | Dana Whitfield, Head of Marketing | Harper |
| `investor-grilling` | The Investor Grilling | Fundraising | Marcus Reed, Partner | Marcus |
| `hiring-interview` | The Experience Interrogation | Job search | Priya Nair, Engineering Manager | Lauren |
| `customer-escalation` | The Difficult Customer | Customer success | Tom Bradley, Operations Director | Garrett |

Each preset has a public briefing (what you see) and a private engine (what drives the counterpart). The private engine is only used server-side to build prompts.

### Live voice loop
- Microphone capture at 24 kHz mono with echo cancellation, noise suppression, and auto gain.
- `AudioWorklet` capture with a `ScriptProcessorNode` fallback.
- Streaming STT over a Gradium WebSocket, including voice activity detection and flush semantics.
- Streaming TTS with a prebuffer to absorb network jitter and sample-boundary carry so PCM chunks stay aligned.
- **Hold to Intercept** lets you talk over the counterpart mid-sentence.
- **Mute mic** without ending the session.
- **Text mode** ("Type instead") for environments without a microphone. The counterpart still speaks back.
- Automatic reconnect if the STT socket drops mid-session.
- If a scenario's voice fails, Parlayy automatically retries with a backup voice (Emma) and tells you.

### Live coaching panel
After each of your turns, a separate, low-temperature LLM call returns:
- **Suggested counter-pivot** — one concrete line you could say next.
- **Leverage balance** — 0–100 estimate of who holds the advantage.
- **Talk-to-listen ratio** — your share vs. the counterpart's.
- **Assertiveness** — 0–100.
- **Objections solved** — how many of the counterpart's objections you have credibly addressed, out of the total.

These are explicitly labeled estimates, not audited metrics.

### Debrief report
- Verdict: **Strong**, **Solid**, or **Developing**.
- Headline and overall read.
- Strengths, each with a supporting quote.
- Missed opportunities, with evidence and a better approach.
- Weak answers: the exact quote, why it fell short, and an alternative.
- Pushback breakdown: what the counterpart said, what you said, and an assessment.
- 2–4 concrete next steps.
- Full transcript, expandable.
- "Run it again" replays the same scenario and difficulty.
- If the automatic report fails, the report page offers a **Generate report** retry using the transcript saved in your browser.

### Session flow details
- A live timer tracks elapsed time.
- You can flag a moment (bookmark the latest turn) during the session.
- Ending the session opens a confirmation modal showing elapsed time and the number of exchanges.
- Sessions and generated scenarios are persisted in `localStorage`, so no database is required.

---

## How it works

```text
┌──────────────────────────── Browser ────────────────────────────┐
│                                                                  │
│  ScenarioPicker ──POST /api/scenario──► LLM designs the scenario │
│        │                                   (validated with Zod)  │
│        ▼                                                         │
│  /session/[id] ── microphone ──► Web Audio (24 kHz PCM)          │
│        │                              │                          │
│        │                              ▼                          │
│        │                    Gradium STT WebSocket                │
│        │                              │ transcript              │
│        │                              ▼                          │
│        │                    POST /api/chat ──► LLM counterpart  │
│        │                              │ in-character reply      │
│        │                              ▼                          │
│        │                    Gradium TTS WebSocket ──► speakers   │
│        │                                                         │
│        ├──POST /api/coach (after each user turn) ──► telemetry   │
│        │                                                         │
│        └── End & Debrief ──POST /api/evaluate──► Report          │
│                                    │                             │
│                                    ▼                             │
│                            /report (localStorage)                │
└──────────────────────────────────────────────────────────────────┘
```

### Server vs. browser responsibilities

**Server (Next.js route handlers, Node runtime):**
- Holds `GRADIUM_API_KEY` and LLM credentials. Keys never reach the browser.
- Mints short-lived Gradium tokens (`POST /api/gradium/token`).
- Builds counterpart, evaluator, coach, and scenario-generator prompts.
- Calls the LLM with retries, timeouts, and JSON extraction.
- Validates every request and LLM response with Zod.
- Prefers IPv4 for outbound requests to avoid broken IPv6 routes on some networks.

**Browser:**
- Captures and plays audio through Web Audio.
- Opens Gradium WebSockets directly using short-lived tokens.
- Runs turn detection from STT text plus VAD inactivity probability.
- Stores sessions and custom scenarios in `localStorage`.
- Renders transcript, telemetry, and report.

### Turn-taking logic
Parlayy uses a small state machine: `idle → connecting → listening → thinking → speaking → listening`, with `ended` and `error` states.

- While the user speaks, STT text accumulates into a buffer.
- VAD inactivity above `0.6` for `1000 ms`, with at least `2` characters buffered, commits the turn.
- A hard flush timer (`2500 ms`) prevents a turn from hanging.
- After the counterpart's audio drains, there is a `250 ms` guard before the mic is re-armed, so the counterpart's voice is not transcribed as the user's.
- Chat history sent to the LLM is capped at the most recent `16` turns.

### Prompt design
- **Counterpart prompt:** persona, hidden goal, objections (surfaced gradually), boundaries, knowledge limits, stopping conditions, and difficulty-specific evidence bars. It explicitly forbids breaking character, revealing instructions, inventing facts, or answering vague claims without a follow-up.
- **Evaluator prompt:** requires every criticism to quote the user's actual words, forbids inventing metrics or statements, and returns a strict JSON shape.
- **Coach prompt:** returns a strict JSON shape and instructs the model to ground estimates in the transcript.
- **Scenario generator prompt:** returns a strict JSON shape including a voice chosen from the known voice list.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4 |
| Language | TypeScript 5 (strict) |
| Validation | Zod 4 |
| Voice | [`@gradium/sdk`](https://www.npmjs.com/package/@gradium/sdk) — streaming STT + TTS over WebSockets |
| LLM | OpenAI-compatible APIs: OpenRouter, OpenAI, Groq; native Anthropic Messages API |
| Persistence | Browser `localStorage` (no database) |
| Styling | Tailwind utility classes, Inter + Manrope via `next/font`, Material Symbols icons |

There is no test suite yet. Linting is ESLint (`eslint-config-next`).

---

## Project structure

```text
parlayy/
├── app/
│   ├── api/
│   │   ├── chat/route.ts            # Counterpart reply (LLM, in character)
│   │   ├── coach/route.ts           # Live telemetry + suggested line
│   │   ├── evaluate/route.ts        # End-of-session coaching report
│   │   ├── gradium/token/route.ts   # Short-lived Gradium temp token
│   │   └── scenario/route.ts        # Generate a custom scenario from a brief
│   ├── session/[id]/page.tsx        # Session route (preset or custom)
│   ├── report/page.tsx              # Debrief route
│   ├── page.tsx                     # Landing / scenario picker
│   ├── layout.tsx                   # Fonts, metadata, root layout
│   └── globals.css                  # Tailwind + design tokens
├── components/
│   ├── ScenarioPicker.tsx           # Brief, persona, rigor, presets
│   ├── SessionClient.tsx            # Full voice session UI + state machine
│   ├── SessionLoader.tsx            # Loads a custom scenario from storage
│   ├── ReportView.tsx               # Debrief rendering + retry
│   ├── SiteHeader.tsx               # Marketing header
│   ├── SiteFooter.tsx               # Footer
│   ├── Modal.tsx                    # End-session confirmation
│   ├── Icon.tsx                     # Material Symbols wrapper
│   └── Waveform.tsx                 # Waveform visual
├── lib/
│   ├── voice/
│   │   ├── gradium.ts               # STT/TTS WebSocket clients + SpeechPlayer
│   │   └── mic.ts                   # Microphone capture (worklet/script fallback)
│   ├── custom-scenario.ts           # localStorage helpers for custom scenarios
│   ├── llm.ts                       # Provider resolution, retries, JSON extraction
│   ├── net.ts                       # IPv4-first DNS/fetch behavior
│   ├── prompt.ts                    # System prompt builders
│   ├── scenarios.ts                 # Public preset scenarios
│   ├── scenarios.server.ts          # Private preset engines (server only)
│   ├── types.ts                     # Zod schemas and shared types
│   └── voices.ts                    # Known Gradium voice IDs
├── public/worklets/mic-processor.js # AudioWorklet microphone processor
├── html/                            # Static design prototypes (reference only)
├── .env.example
├── next.config.ts
├── package.json
└── tsconfig.json
```

---

## Getting started

### Prerequisites

- **Node.js 20.9 or newer** (Node 22+ recommended; developed on Node 24).
- **npm** (or pnpm/yarn/bun — commands below use npm).
- A modern browser with **Web Audio**, **AudioWorklet** (or ScriptProcessor), and `getUserMedia` support: current Chrome, Edge, Firefox, or Safari.
- A **microphone** for voice mode. Text mode works without one, but the counterpart still needs TTS.
- A **secure context** for microphone access. `http://localhost` counts as secure; any deployed origin must be **HTTPS**.

### 1. Install dependencies

```bash
git clone <your-repo-url> parlayy
cd parlayy
npm install
```

### 2. Get a Gradium API key

Parlayy uses Gradium for both speech-to-text and text-to-speech.

1. Create an account / sign in at [gradium.ai](https://gradium.ai).
2. Create an API key in the dashboard.
3. Put it in `.env.local` as `GRADIUM_API_KEY`.

The key is used **server-side only** to mint temporary tokens. It is never sent to the browser. The browser then connects to the Gradium WebSocket in the **same regional cluster** that minted the token (`us` or `eu`). Gradium tokens are cluster-bound, so mixing `api.gradium.ai` auto-routing with a direct WebSocket can produce `Invalid or expired token`. See [`GRADIUM_REGION`](#environment-variables-reference).

The voice IDs used by the presets live in [`lib/voices.ts`](lib/voices.ts) and in each preset's `voice` field. If your Gradium account does not have access to one of them, the session automatically falls back to voice "Emma" (`YTpq7expH9539ERJ`). You can replace the IDs with voices available in your dashboard.

### 3. Get an LLM API key

Parlayy supports four providers. Pick one:

| Provider | `LLM_PROVIDER` | Key variable(s) | Default model |
| --- | --- | --- | --- |
| OpenRouter | `openrouter` | `LLM_API_KEY` or `OPENROUTER_API_KEY` | `minimax/minimax-m3.1-flash` |
| OpenAI | `openai` | `LLM_API_KEY` or `OPENAI_API_KEY` | `gpt-4o-mini` |
| Groq | `groq` | `LLM_API_KEY` or `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| Anthropic | `anthropic` | `LLM_API_KEY` or `ANTHROPIC_API_KEY` | `claude-3-5-sonnet-latest` |

If `LLM_PROVIDER` is omitted, Parlayy infers it from whichever provider-specific key is present. If you use an OpenAI-compatible proxy or a custom endpoint, set `LLM_BASE_URL` and optionally `LLM_MODEL`.

On OpenRouter, scenario generation uses the free `nvidia/nemotron-3.5-lightning:free` model regardless of `LLM_MODEL`. The conversation, coaching, and report calls continue to use `LLM_MODEL`.

> The default OpenRouter model is a low-cost paid model. Free variants are rate-limited and can be retired; if you use one, expect slower scenario generation and occasional empty responses. Set a paid `LLM_MODEL` or use another provider for consistent latency.

### 4. Configure environment variables

Copy the example file:

```bash
cp .env.example .env.local
```

Then edit `.env.local`:

```dotenv
# Required — server-side only
GRADIUM_API_KEY=your_gradium_key

# Optional — eu or us. Leave blank to infer from VERCEL_REGION (us default).
GRADIUM_REGION=

# Pick a provider
LLM_PROVIDER=openrouter
LLM_API_KEY=your_llm_key

# Optional. Defaults to the provider's default model.
LLM_MODEL=minimax/minimax-m3.1-flash

# Optional. Only needed for OpenAI-compatible proxies/custom endpoints.
LLM_BASE_URL=
```

Notes:
- `.env*` is gitignored. Never commit real keys.
- Restart the dev server after changing environment variables.
- You can use provider-specific variables instead of `LLM_API_KEY`, e.g. `OPENROUTER_API_KEY=...`.
- `GRADIUM_API_KEY` is read only in route handlers (Node runtime).
- `GRADIUM_REGION` pins the Gradium cluster. If unset, the token route infers `eu`/`us` from `VERCEL_REGION` and defaults to `us` locally. The same region is used for both token minting and the browser WebSocket.

### 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On first voice start, the browser asks for microphone permission. Grant it, and ideally wear headphones — the app uses echo cancellation, but headphones give the cleanest turn-taking.

To verify a production build:

```bash
npm run build
npm start
```

---

## Environment variables reference

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `GRADIUM_API_KEY` | **Yes** | — | Server-side Gradium key used to mint temporary STT/TTS tokens. |
| `GRADIUM_REGION` | No | Inferred from `VERCEL_REGION`, else `us` | Gradium cluster, `eu` or `us`. Pins token minting and the browser WebSocket to the same region. |
| `LLM_PROVIDER` | No | Inferred from keys, else `openai` | One of `openrouter`, `openai`, `groq`, `anthropic`. |
| `LLM_API_KEY` | One LLM key required | — | Generic provider key; checked before provider-specific keys. |
| `OPENROUTER_API_KEY` | If provider is openrouter | — | Provider-specific fallback. |
| `OPENAI_API_KEY` | If provider is openai | — | Provider-specific fallback. |
| `GROQ_API_KEY` | If provider is groq | — | Provider-specific fallback. |
| `ANTHROPIC_API_KEY` | If provider is anthropic | — | Provider-specific fallback. |
| `LLM_MODEL` | No | Provider default | Model ID sent to the provider. |
| `LLM_BASE_URL` | No | Provider default | Override the API base URL (OpenAI-compatible proxies, self-hosted gateways). |

Key resolution order for the selected provider is `LLM_API_KEY` first, then the provider-specific variable.

---

## Using Parlayy

### Start from a custom brief

1. Open the home page.
2. Describe the conversation in the textarea. Example:
   > I have a meeting with a client tomorrow. They think my price is too high, and I need to defend my value without losing the deal.
3. Optionally choose a **Persona** and **Rigor** level.
4. Click **Begin Rehearsal**. The scenario is generated (a spinner shows "Calibrating…") and you are routed to `/session/<id>?difficulty=<tier>`.
5. On the scenario intro screen, review the situation and your goal.
6. Click **Start rehearsal** for voice mode, or **Type instead** for text mode.
7. Speak naturally. The counterpart opens the conversation. When you pause, your turn is committed and the counterpart replies.
8. Use **Hold to Intercept** to cut in while the counterpart is speaking.
9. Use **Flag Moment** to bookmark the latest turn.
10. Click **End & Debrief**, confirm, and wait for the report.

### Start from a preset

The presets are **not** listed on the home page; the home page always generates from a brief. To use a preset directly, navigate to:

```text
http://localhost:3000/session/client-price?difficulty=medium
http://localhost:3000/session/investor-grilling?difficulty=hard
http://localhost:3000/session/hiring-interview?difficulty=easy
http://localhost:3000/session/customer-escalation?difficulty=medium
```

Valid `difficulty` values are `easy`, `medium`, and `hard`. Anything else falls back to `medium`.

### During a session

| Control | Behavior |
| --- | --- |
| Status pill | Shows Listening / Speaking / Thinking / Connecting / Standby. |
| Timer | Elapsed session time. |
| Mute Mic | Stops sending audio; the counterpart can still speak. |
| Intercept | Hold to stop the counterpart's playback and take the turn. |
| Flag Moment | Toggles a bookmark on the latest transcript turn. |
| Text input | Appears in text mode; Enter sends. Disabled unless it is your turn. |
| Waveform | Shows the active audio level and counterpart modulation. |
| Live telemetry | Updates after each of your turns. |

Turn-taking tips:
- Wait for the **Listening** state before speaking.
- Pause for about a second at the end of your point so the turn commits.
- Headphones reduce the chance of the counterpart's audio leaking into your mic.

### Read the debrief

After ending, you land on `/report`. The report is generated server-side and stored with the session. If generation failed, use **Generate report** to retry.

The report includes:
- Verdict and headline.
- Overall read.
- What worked (with quotes).
- Missed opportunities (with quotes and a better approach).
- Answers that needed more (quote, why, alternative).
- Where they pushed back (counterpart line, your response, assessment).
- Next attempt (numbered actions).
- Full transcript.
- **Run it again** and **Another scenario**.

### Persistence behavior

- The **current/last session** is stored under `parlay.session`.
- Up to **20 sessions** are stored under `parlay.history` (no history UI yet).
- Each generated custom scenario is stored under `parlay.custom.<id>`.
- Custom scenario IDs start with `custom-`, which is how `/session/[id]` knows to load them from browser storage.
- Clearing site data deletes all sessions, custom scenarios, and reports.
- Opening a custom session link on a different browser/device will show "This scenario isn't stored on this device."

---

## API reference

All routes use the Node.js runtime and return JSON. Invalid input returns `400`; unknown scenarios return `404`; upstream failures return `502` (or `504` for LLM timeouts). LLM credentials and Gradium keys stay server-side.

### `POST /api/scenario`

Generates a custom scenario from a brief.

Request:
```json
{
  "brief": "I am negotiating a renewal with a client asking for 25% off.",
  "rigor": 2
}
```
- `brief`: string, 10–2000 characters.
- `rigor`: integer 1–3 (coerced). Controls counterpart posture in the prompt.

Response `200`:
```json
{
  "customScenario": {
    "scenario": {
      "id": "custom-1a2b3c4d",
      "title": "The Renewal Squeeze",
      "category": "Enterprise sales",
      "tagline": "A long-term client wants a discount to stay.",
      "counterpart": {
        "name": "Alex Morgan",
        "role": "Procurement Lead",
        "org": "Northwind",
        "initials": "AM",
        "accentLabel": "Direct · Cost-driven",
        "visibleProfile": ["..."]
      },
      "voice": { "id": "4SZHfMpw-p46Ywgs", "name": "Harper" },
      "briefing": {
        "situation": "...",
        "yourGoal": "...",
        "stakes": "..."
      }
    },
    "engine": {
      "persona": "...",
      "hiddenGoal": "...",
      "objections": ["..."],
      "boundaries": "...",
      "knowledge": "...",
      "stopping": "..."
    }
  }
}
```

The voice is chosen from `lib/voices.ts`; if the model picks an unknown ID, the first voice is used.

### `POST /api/chat`

Produces the counterpart's next spoken reply.

Request:
```json
{
  "scenarioId": "client-price",
  "difficulty": "medium",
  "transcript": [
    { "role": "user", "text": "Thanks for making the time." }
  ],
  "customScenario": null
}
```
- `transcript`: up to 60 turns; each turn is `{ role: "user" | "counterpart", text: string }`.
- `customScenario`: optional, required when `scenarioId` starts with `custom-`.

Response `200`:
```json
{ "reply": "Thanks for coming back to me. I'll be direct — the number is the problem." }
```

The reply is sanitized for speech: code fences and markdown are stripped, whitespace is collapsed, and it is capped at 700 characters. If the transcript is empty, the model is prompted to open the conversation in character.

### `POST /api/coach`

Returns live telemetry for the session so far.

Request:
```json
{
  "scenarioId": "client-price",
  "difficulty": "medium",
  "transcript": [
    { "role": "user", "text": "The price reflects six weeks of work." },
    { "role": "counterpart", "text": "Comparable work was cheaper." }
  ]
}
```
- `transcript`: 1–80 turns.

Response `200`:
```json
{
  "coach": {
    "hint": "Anchor on the cost of a delayed launch, not the day rate.",
    "leverage": 42,
    "talkListenYou": 55,
    "talkListenThem": 45,
    "assertiveness": 63,
    "objectionsSolved": 1,
    "objectionsTotal": 4
  }
}
```

### `POST /api/evaluate`

Generates the final coaching report from the full transcript.

Request:
```json
{
  "scenarioId": "client-price",
  "difficulty": "medium",
  "transcript": [
    { "role": "user", "text": "..." },
    { "role": "counterpart", "text": "..." }
  ]
}
```
- `transcript`: 1–80 turns.

Response `200`:
```json
{
  "report": {
    "verdict": "solid",
    "headline": "You held the price but never quantified the cost of delay.",
    "overall": "...",
    "strengths": [{ "point": "...", "evidence": "..." }],
    "missedOpportunities": [{ "point": "...", "evidence": "...", "better": "..." }],
    "weakAnswers": [{ "quote": "...", "why": "...", "alternative": "..." }],
    "pushback": [{ "counterpart": "...", "yourResponse": "...", "assessment": "..." }],
    "nextSteps": ["...", "..."]
  }
}
```
`verdict` is one of `strong`, `solid`, `developing`. All arrays may be empty, except `nextSteps`, which must contain 1–6 items.

### `POST /api/gradium/token`

Mints a short-lived Gradium token for the browser.

Response `200`:
```json
{
  "token": "...",
  "region": "us",
  "expires_at": "2026-10-20T15:32:11.123456Z",
  "expires_in_ms": 3760
}
```
Response headers include `cache-control: no-store`. The route mints through `https://<region>.api.gradium.ai/api/`, retries up to three times with backoff when a token is too close to expiry, and returns `502` with a descriptive error if the token cannot be created. Missing `GRADIUM_API_KEY` returns `500`. Clients must use the returned `region` for their WebSocket host; a token minted in one Gradium cluster is rejected by the other.

---

## Data storage and privacy

- **Secrets:** only read server-side from environment variables. No key is exposed to the browser.
- **Voice audio:** streamed directly between the browser and Gradium using short-lived tokens. Parlayy does not record or store audio.
- **Transcripts and reports:** stored only in your browser's `localStorage`. There is no database and no account system.
- **LLM requests:** transcript turns needed to answer or evaluate are sent to your configured LLM provider.
- **No analytics or tracking** are included.
- The home page displays a "Zero-retention protocol" label; treat it as product copy and verify your own Gradium and LLM provider data policies before using sensitive content.

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js dev server (Turbopack). |
| `npm run build` | Create a production build. |
| `npm start` | Serve the production build. |
| `npm run lint` | Run ESLint. |

---

## Troubleshooting

### "Microphone unavailable" / text mode starts automatically
- The browser blocked mic access, no device was found, or the page is not in a secure context.
- Use `http://localhost` or HTTPS.
- Check OS/browser microphone permissions for the site.
- Text mode still works; the counterpart still speaks.

### "Invalid or expired token"
Gradium temporary tokens are valid for only a few seconds and are bound to the cluster that minted them.

- Pin `GRADIUM_REGION` to `eu` or `us`, and make sure the token route and the browser use the same region. The app does this automatically from the token response; do not mix `api.gradium.ai` with a regional WebSocket.
- If you are on Vercel, the route infers the region from `VERCEL_REGION` when `GRADIUM_REGION` is unset. To keep minting and browser latency consistent, set `GRADIUM_REGION` explicitly.
- Do not prefetch tokens before a slow LLM call. The app mints immediately before opening each STT/TTS WebSocket and retries once with a fresh token.
- Check the token response for `expires_in_ms`; values below ~1500ms are retried server-side.

### The counterpart's voice never starts
- Verify `GRADIUM_API_KEY` is set and valid.
- Check the terminal for `[gradium] tempToken failed: ...`.
- Verify your Gradium account has access to the configured voice IDs. The app falls back to Emma automatically and shows a notice.
- Corporate networks may block `wss://us.api.gradium.ai` or `wss://eu.api.gradium.ai`.

### "Could not reach the voice service"
- The browser could not open the Gradium WebSocket. Check network/firewall/proxy settings.
- Reload the page and try again; tokens are short-lived.

### "Calibrating…" takes too long
- On OpenRouter, scenario generation uses the free `nvidia/nemotron-3.5-lightning:free` model. Free models are slower and more variable than paid ones.
- The scenario prompt is capped to a small output budget and reasoning is disabled for this call.
- If you need faster calibration, use a paid `LLM_MODEL` or a fast provider such as Groq's free tier.

### LLM errors
- **No LLM credentials configured** — set `LLM_PROVIDER` and the matching key in `.env.local`, then restart the server.
- **LLM returned an empty response** — often caused by a free model spending its whole output budget on reasoning, or by rate limits. Increase the model's output budget, lower reasoning effort, or switch models/providers.
- **LLM request failed (401/403)** — bad or expired key.
- **LLM request failed (429)** — rate limit; wait or use a paid model.
- **LLM request timed out** — upstream is slow or unreachable; the route aborts at 45 seconds.
- **Malformed report/telemetry** — the model returned JSON that failed validation. Try again, or switch to a model that follows JSON instructions more reliably.

### Outbound calls hang on some networks
`lib/net.ts` forces `ipv4first` and disables auto family selection to avoid broken IPv6 routes. If you still see hangs, check your network's IPv6/DNS behavior.

### Port already in use
```bash
npm run dev -- --port 3001
```

### Environment changes not taking effect
Restart `npm run dev`. Next.js does not hot-reload `.env.local` changes for every case.

### Custom scenario link says "This scenario isn't stored on this device"
Custom scenarios live in `localStorage` on the device that generated them. Regenerate the scenario, or open the link in the same browser/profile.

### Build or type errors
```bash
npm install
npm run build
```
Ensure Node is 20.9+ and dependencies are installed from the lockfile.

---

## Deployment

Parlayy is a standard Next.js app and deploys cleanly to Vercel or any Node host.

1. Push the repository to your Git provider.
2. Import the project into Vercel (or your host).
3. Add environment variables for the production environment:
   - `GRADIUM_API_KEY`
   - `GRADIUM_REGION` (`eu` or `us`) — leave blank to infer from the Vercel function region
   - `LLM_PROVIDER`
   - the matching LLM key (`LLM_API_KEY` or provider-specific)
   - optional `LLM_MODEL`, `LLM_BASE_URL`
4. Deploy.
5. Serve over **HTTPS** — microphone access requires a secure context outside localhost.
6. Confirm outbound WebSocket access to `wss://us.api.gradium.ai` or `wss://eu.api.gradium.ai` from end users' networks.
7. For the lowest latency, keep the Vercel function region and `GRADIUM_REGION` aligned (for example, `lhr1` + `eu` or `iad1` + `us`).

Because sessions are stored in `localStorage`, there is no database to provision. Users' sessions stay on their own devices.

---

## Known limitations and ideas

- No user accounts, cloud sync, or server-side session history. Everything is local to the browser.
- `parlay.history` stores up to 20 sessions but there is no history browser UI yet.
- Session state is client-owned; refreshing mid-session loses the active transcript.
- Live telemetry metrics are LLM estimates, not measured speech analytics.
- No automated tests yet.
- The `html/` directory contains static design prototypes and is not part of the running app.
- Report quality depends heavily on the chosen model; small free models are more likely to return malformed JSON or empty completions.
- Ideas: scenario library browsing, saved progress across devices, audio recording/playback, per-objection scoring, team/coach accounts, and a transcript export.

---

Built with Next.js, React, Tailwind CSS, Gradium voice, and your choice of LLM provider.
