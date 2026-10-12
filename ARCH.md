# Architecture

A car-insurance intake app. The user fills out a form by hand, by chatting with an LLM agent, or both. The agent can also hand the conversation off to a human via Slack.

## Overview

TanStack Start app running on a **Cloudflare Worker** (`wrangler.jsonc`: `main: @tanstack/react-start/server-entry`, `nodejs_compat`). One page, two panes (`src/routes/index.tsx`): chat on the left, intake form on the right, both reading and writing one shared store.

```
 Browser                                   Cloudflare Worker                 External
 ┌───────────────────────────┐            ┌────────────────────────┐
 │ ChatPane   IntakeForm     │            │ POST /api/chat         │
 │      \       /            │  JSON      │  routes/api/chat.ts    │
 │      intakeStore          │ ─────────► │   └ runChat()          │  stream   ┌─────────────┐
 │  (values, entries, ...)   │ {messages, │     server/chat.server │ ────────► │ Together.AI │
 │                           │  form}     │                        │ ◄──────── │ /chat/compl.│
 │  handleEvent(IntakeEvent) │ ◄───────── │   SSE of IntakeEvent   │ deltas +  └─────────────┘
 │                           │   SSE      │                        │ tool calls
 └───────────────────────────┘            │   └ sendHandoffToSlack │ ────────► ┌─────────────┐
                                          │     server/slack.server│  POST     │ Slack       │
                                          └────────────────────────┘           │ Incoming WH │
                                                                               └─────────────┘
```

## Client <-> LLM flow

1. **State.** `intakeStore` (`src/features/intake/store.ts`) holds `values` (the form draft), `errors`, `entries` (chat messages + agent actions), `streaming`, `handoff`. The user (`setField`) and the agent (`applyPatch`) share one write path, and both re-run `validateDraft`.
2. **Send.** `sendChat` (`stream-chat.ts`) is a no-op while already streaming. It appends the user message and an empty assistant bubble, then POSTs `{ messages, form }` (`ChatRequest`) to `/api/chat`. `selectMessages` strips agent-action entries, so only user/assistant text goes up. The **entire current form is sent on every turn**; the server keeps nothing between requests.
3. **Route.** `src/routes/api/chat.ts` validates the body with `chatRequestSchema` (400 on failure), then wraps the `runChat` async generator in a pull-based `ReadableStream`. Each yielded event goes through `encodeSse`. It honours `request.signal` aborts and `cancel`, and turns thrown errors into an `error` event.
4. **Agent loop.** `runChat` (`src/server/chat.server.ts`) runs up to `CHAT_MAX_ROUNDS` rounds (default 3). Each round:
   - builds the system prompt (current form JSON as source of truth, state-specific rules, open validation issues), then the history, then a trailing `rulesReminder`;
   - streams Together's response, forwarding text as `message.delta` and accumulating `tool_calls` by index;
   - executes known tools (`update_form`, `pingSlack`), appends the assistant tool calls and `tool` results to history, and loops;
   - stops when a round produces no tool calls, then emits `message.done` and `done`.
5. **`update_form`.** `parsePatch` (zod partial) -> `enforceLiabilityMinimum` (drops a liability limit below the state minimum and tells the model why) -> `mergeDraft` -> emits `form.patch`. The tool result fed back to the model says what was saved or rejected, and what the allowed options are after a state change. The client applies the same patch with `deepMerge`.
6. **SSE contract.** The `IntakeEvent` union in `src/features/intake/events.ts` is the whole wire protocol: `message.delta`, `message.done`, `action.started`, `action.finished`, `form.patch`, `handoff.requested`, `error`, `done`. The client's `parseSseStream` (`sse.ts`) tolerates frames split across chunks; `handleEvent` maps each event to a store action; `ActionTimeline` renders actions inline in the chat.
7. **Rules have one source.** `src/features/intake/rules.ts` feeds the form UI (allowed options), zod cross-field validation (`schema.ts`), the LLM prompt (`rulesSummaryFor`), and the server guard (`enforceLiabilityMinimum`).

## Slack flow

This is an **outbound Slack Incoming Webhook only**. We POST to it; there is no inbound Slack endpoint, no signature verification, and nothing comes back from Slack into the app.

1. The model calls `pingSlack({ reason? })` when the user asks for a human.
2. `runChat` emits `action.started` (`kind: "slack.handoff"`) and calls `sendHandoffToSlack` (`src/server/slack.server.ts`).
3. `sendHandoffToSlack` generates `ref = crypto.randomUUID()` and builds the message with `formatHandoffMessage`: reason, open issues (`validateComplete`), the last 20 messages (each truncated to 500 chars, in a code block), and the full form JSON. It escapes `& < >` and stray code fences, then POSTs `{ text }` to `SLACK_WEBHOOK_URL`.
4. On success `runChat` emits `handoff.requested { ref }`, then `action.finished`. The client calls `setHandoff(ref)`, storing `{ status: "sent", ref }`. Nothing reads it yet beyond the store.
5. The tool result goes back to the model so it can tell the user. A failure is caught and logged, shown as a failed action, and the chat carries on.
6. If `SLACK_WEBHOOK_URL` is unset, the message is logged to the console and reported as ok. This is a dev convenience; in production it would silently "succeed" without notifying anyone.

## Extending

| To add... | Touch |
| --- | --- |
| A new agent tool | In `chat.server.ts`: add the definition to `tools`, a name const, include it in the `known` filter, and add a branch in the tool loop that emits `action.started`/`action.finished` and pushes a `tool` message. If it needs a new `ActionKind`, extend it in `events.ts`. |
| A new SSE event | Add it to `IntakeEvent` and handle it in `handleEvent` (`stream-chat.ts`). `encodeSse` and `parseSseStream` need no change. |
| A form field or rule | Edit `schema.ts` (and `rules.ts` for rules). The tool's JSON schema (`z.toJSONSchema(intakeDraftSchema)`), validation, and prompt follow automatically; add the input in `IntakeForm.tsx`/`fields.tsx`. If the rule must not be trusted to the model, add a server guard like `enforceLiabilityMinimum`. |
| A different model | Set `TOGETHER_MODEL` / `TOGETHER_BASE_URL`; any OpenAI-compatible streaming endpoint works. A different wire format only changes `runChat` and `readChunks`. |
| Slack replies / two-way handoff | Needs a real Slack app (not a webhook), a new route under `src/routes/api/`, request-signature verification, and durable storage mapping `ref` to a session. `sendHandoffToSlack` already returns `ref` as the seam. |
| Persistence / memory across reloads | Add a binding (KV, D1, or a Durable Object) in `wrangler.jsonc`. Today everything is client-side and lost on refresh. |

## Rules

**Enforced by code or config**

- **Cloudflare Workers only.** Server code reads config via `import { env } from "cloudflare:workers"`. Deploy is `vite build && wrangler deploy`.
- **Stateless server.** No bindings are configured. The client owns the conversation and the form and sends both every request. Adding persistence is an infra decision, not a refactor.
- **Secrets vs. vars.** `TOGETHER_API_KEY` and `SLACK_WEBHOOK_URL` are secrets (`.dev.vars` locally, `wrangler secret put` in prod); never put them in `wrangler.jsonc` `vars`. Non-secret config (`TOGETHER_MODEL`, `CHAT_MAX_ROUNDS`) lives in `vars`. A missing `TOGETHER_API_KEY` throws.
- **The browser never calls Together or Slack.** Only the `/api/chat` route does. `*.server.ts` files stay server-only.
- **`IntakeEvent` is the only server -> client contract**, and `chatRequestSchema` is the only client -> server one.
- **The form is the source of truth**, not the LLM and not the chat history. Business rules are enforced in code, not only in prompts.
- **The tool loop is bounded** by `CHAT_MAX_ROUNDS`.

**Repo conventions** (from `AGENTS.md`)

- Style only with Chakra UI v3 and its tokens; no Tailwind, CSS files, inline `style`, or hardcoded values. Missing tokens go in `src/theme/system.ts`.
- Blank line above and below any multi-line statement; braces and a new line for `if`/`else`.
- Prefer functional code, and code that is easy to replace or remove over "complete" code.
- Before substantial work, run `pnpm exec intent list` and load any matching skill.

**Known gaps** (not rules, just not built)

- No auth or rate limiting on `/api/chat`; anyone who can reach it spends the Together key.
- No infra-as-code beyond `wrangler.jsonc`, and no CI.
- No inbound Slack, and no submit step: `validateComplete` is used for prompts and the handoff, but nothing finalises an application.
