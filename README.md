# Car Insurance Intake

A car-insurance intake app. The user fills out a form by hand, by chatting with an LLM agent, or both. The agent proposes values as field-level patches, the server validates them, and the agent can hand the conversation to a human through Slack.

Stack: TanStack Start (React) on a Cloudflare Worker, Chakra UI v3, zod, Together.AI for the model, a Slack incoming webhook for handoff.

See [`ARCH.md`](./ARCH.md) for how the pieces fit together and [`NEXT_STEPS.md`](./NEXT_STEPS.md) for what is still open.

## How it works

- **Split UI.** Chat on the left, live form on the right, both reading and writing one shared store.
- **Field-level patches.** The agent writes through an `update_form` tool. Patches stream to the client as SSE events (`src/features/intake/events.ts`).
- **The form is the source of truth.** The full form, the fields the user touched, and their recent hand edits are sent on every turn; the server keeps nothing between requests.
- **The server is the last line of defence.** `src/features/intake/guard.ts` validates each proposed field, applies the cross-field rules, and refuses to overwrite fields the user set by hand unless their latest message asks for the change. Rejections are fed back to the model and shown on the field.
- **Field states.** Each value is visibly an agent suggestion, a user entry, or confirmed. The user can confirm a suggestion.
- **Rules.** Minimum liability per garaging state (CA, NY, FL, plus a default), and a claim date that is required if and only if the claim count is above zero, within five years (`rules.ts`, `schema.ts`).
- **Human handoff.** When the user asks for a person, or the agent keeps getting rejected, it posts the reason, open issues, transcript and partial form to Slack and shows the reference in the chat. It only sends once.

## Local setup

Requires Node and [pnpm](https://pnpm.io/).

```bash
pnpm install
cp .dev.vars.example .dev.vars   # then fill in the keys
pnpm dev                         # http://localhost:3000
```

### Environment

Set in `.dev.vars` locally and with `wrangler secret put` in production.

| Variable            | Required    | Purpose                                                                                                              |
| ------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `TOGETHER_API_KEY`  | yes         | Together.AI key. Chat fails without it.                                                                              |
| `SLACK_WEBHOOK_URL` | for handoff | Slack incoming webhook. Unset in dev, the handoff is logged to the console; unset in production, it reports failure. |
| `TOGETHER_BASE_URL` | no          | Any OpenAI-compatible endpoint. Default `https://api.together.xyz/v1`.                                               |
| `TOGETHER_MODEL`    | no          | Default `meta-llama/Llama-3.3-70B-Instruct-Turbo`.                                                                   |
| `CHAT_MAX_ROUNDS`   | no          | Cap on tool-call rounds per turn. Default 3.                                                                         |

## Scripts

| Command                                    | What it does                                                                                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                 | Dev server on port 3000.                                                                                                                                                           |
| `pnpm build` / `pnpm preview`              | Production build, and a local preview of it.                                                                                                                                       |
| `pnpm test`                                | Unit tests (Vitest).                                                                                                                                                               |
| `pnpm test:e2e`                            | Playwright against a scripted model and a fake Slack. Deterministic, no keys needed.                                                                                               |
| `pnpm test:e2e:live`                       | Playwright against the real model and a real Slack webhook. Needs `.dev.vars.live` (copy `.dev.vars.live.example`); uses tokens and posts to Slack, so point it at a test channel. |
| `pnpm check` / `pnpm lint` / `pnpm format` | [Biome](https://biomejs.dev/).                                                                                                                                                     |
| `pnpm deploy`                              | Build and `wrangler deploy`.                                                                                                                                                       |

## Demo scenarios

1. **Conversation fills the form.** Describe yourself and your car in one message ("I'm Sam Lee, I live in California and drive a 2020 Honda Civic"). The matching fields appear on the right as agent suggestions; confirm or edit them.
2. **Edit a field and the agent respects it.** Change a field by hand, then keep chatting. The agent sees the edit and cannot overwrite it unless you ask for the change.
3. **Ask for a human.** Say you want to talk to a person. Slack receives the transcript and the partial form, and the chat shows the reference.

<!-- TODO: add screenshots or a GIF for each scenario. -->

## Project layout

```
src/
  routes/            page and the /api/chat route
  components/        ChatPane, IntakeForm, field inputs
  features/intake/   schema, rules, store, SSE protocol, patch guard
  server/            chat loop (chat.server.ts) and Slack handoff (slack.server.ts)
  theme/system.ts    Chakra tokens
e2e/                 Playwright specs (mock and live)
```

## Deploying

Cloudflare Workers via the Vite plugin and `wrangler.jsonc`:

```bash
wrangler login
wrangler secret put TOGETHER_API_KEY
wrangler secret put SLACK_WEBHOOK_URL
pnpm deploy
```

Non-secret config goes under `vars` in `wrangler.jsonc`.

## Conventions

Styling is Chakra UI v3 with theme tokens only, and code style is enforced by Biome. See [`AGENTS.md`](./AGENTS.md).

## Left out, and next

- No rate limiting on `/api/chat`, so anyone who can reach it can spend the Together key.
- No request size caps, no CSP or security headers, and the dev fallback logs the full form and transcript.
- No persistence: state lives in the browser and is lost on refresh.
- No submit step or premium estimate, no CI, and no infrastructure as code.
- Slack is outbound only; there are no replies back into the chat.

The full list, in priority order, is in [`NEXT_STEPS.md`](./NEXT_STEPS.md).

## Trade-Offs

1. Custom SSE vs OpenAI Compat

- This was chosen so that I could drive the UI separate from an actual LLM. This allows us to be completely decoupled from the API itself
  that is called under the hood while still allowing the UI to react to the _state_ the server is going through

2. TanStack vs CSR React App

- This is just habit for me via `pnpm create cloudflare@latest`. Most of my personal projects are on Cloudflare due to their generous free
  tier and the ease at which you can use `node_compat` to self-host a Docker image

3. Together + Model

- I had ~a few credits on Together, so I chose the _cheapest_ model that could do
  1. Tool calling
  2. Serverless
  3. JSON Output
