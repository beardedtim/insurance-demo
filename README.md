# Car Insurance Intake

A car-insurance intake app. The user fills out a form by hand, by chatting with an LLM agent, or both. The agent proposes values as field-level patches, the server validates them, and the agent can hand the conversation to a human through Slack.

Stack: TanStack Start (React) on a Cloudflare Worker, Chakra UI v3, zod, Together.AI for the model, a Slack incoming webhook for handoff.

See [`ARCH.md`](./ARCH.md) for how the pieces fit together and [`NEXT_STEPS.md`](./NEXT_STEPS.md) for what is still open.

## How it works

- **Split UI.** Chat on the left, live form on the right, both reading and writing one shared store.
- **Field-level patches.** The agent writes through an `update_form` tool. Patches stream to the client as SSE events (`src/features/intake/events.ts`).
- **The form is the source of truth.** The full form, the fields the user touched, and their recent hand edits are sent on every turn; the server keeps nothing between requests.
- **The server is the last line of defence.** `src/features/intake/guard.ts` validates each proposed field, applies the cross-field rules, and refuses to overwrite fields the user set by hand unless their latest message asks for the change. Rejections are fed back to the model and shown on the field.
- **Field states.** Each value is visibly an agent suggestion, a user entry, or confirmed. The user can confirm a suggestion. See [Field states](#field-states).
- **Rules.** Minimum liability per garaging state (CA, NY, FL, plus a default), and a claim date that is required if and only if the claim count is above zero, within five years (`rules.ts`, `schema.ts`).
- **Human handoff.** When the user asks for a person, or the agent keeps getting rejected, it posts the reason, open issues, transcript and partial form to Slack and shows the reference in the chat. It only sends once.

## Field states

A field is always in exactly one state. The store keeps who last wrote it (`provenance` in `store.ts`) and the UI reads that, so an inferred value and a typed one never look the same (`fields.tsx`).

| State     | How it is reached                                               | What the user sees                                                           |
| --------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Empty     | No value, no provenance.                                        | Plain input, no badge. Required fields carry the required marker.            |
| Proposed  | The agent wrote it (`applyPatch`).                              | Tinted input, purple **Suggested** badge and a **Confirm** button.           |
| Confirmed | The user pressed **Confirm** on a proposal.                     | Green **Confirmed** badge. The agent may not change it without being asked.  |
| Edited    | The user typed or selected it (`setField`), even over a proposal. | Blue **Edited by you** badge. Clearing the field returns it to empty.        |
| Invalid   | The value fails the schema or a cross-field rule, in any state. | Red error text under the field. The badge stays, so the source is still clear. |

Two more cases share the invalid styling. A proposal the server refused is never written, so the field keeps its previous value and shows `Suggestion not saved: <reason>` until it changes. A user edit that breaks a rule (for example a liability limit below the state minimum) is kept, because it is theirs, and flagged.

Edited and confirmed fields are "touched": they are sent to the server on every turn and the agent cannot overwrite them unless the user's latest message states the new value.

## Validation, and what happens to a bad proposal

The model is never the last line of defence. Validation runs in three places, and only the first two can stop a value.

1. **Server, before anything reaches the form** (`guard.ts` `sanitizePatch`, then `enforceLiabilityMinimum`). Each field the agent proposes is checked in order:
   - the section and field exist in the schema;
   - the value parses against that field's zod schema (type, format, enum);
   - the field is not touched by the user, unless their latest message states the new value (`userStatedValue`, a conservative text match: a miss makes the agent ask, which is the safe failure);
   - cross-field rules still hold with the value applied (claim date required iff the claim count is above zero, and inside the five-year window);
   - the liability limit meets the garaging state's minimum.

   Fields that pass are merged and streamed as `form.patch`. Fields that fail are dropped individually, so one bad field does not lose the others.
2. **Client, on every write** (`validateDraft` in `schema.ts`, run by both `setField` and `applyPatch`). It drives the error text under each field. It is for display, not trust: the server does not rely on it.
3. **Prompt.** `rulesSummaryFor` tells the model the same rules from the same data (`rules.ts`), so it usually proposes valid values. This only reduces how often the guard fires.

When a proposal is rejected:

- the invalid value is **not saved** and never appears in the form;
- the server emits `form.rejected` with a reason per field, and the field shows `Suggestion not saved: <reason>`;
- the same reasons go back to the model in the tool result ("Not saved: coverage.liabilityLimit (...)"), so it can correct itself or ask the user, along with any conflicts the saved values created elsewhere;
- the client counts a **strike** when a turn rejects proposals and saves nothing, and resets it on any save or hand edit.

## Ask, infer or escalate

The decision is made by the model, within limits the code sets and enforces. The prompt (`chat.server.ts`) states the policy; the guard and the strike counter make it hold even if the model ignores it.

- **Infer** only what the user's own words already imply. "My Honda Civic" gives make Honda and model Civic. Inferred values are written as proposals (Suggested), so the user can see and confirm them. The agent also infers nothing over a touched field.
- **Ask** whenever a value would be a guess: a missing required field, an invalid or conflicting one, or an option that depends on something not yet known (liability limits depend on the state, so the agent asks for the state first). It asks one or two things at a time. When the form and the conversation disagree, the form wins and the agent points out the difference once instead of reverting it.
- **Escalate** in three cases:
  1. the user asks for a person, so the agent calls `pingSlack`;
  2. the user is confused, gives conflicting information the agent cannot reconcile, or asks for something the form does not cover, so the agent offers a human rather than inventing values;
  3. the guard rejects proposals twice in a row with nothing saved (`STRIKE_LIMIT`). The server then tells the model to stop guessing, say what is blocking progress and offer a human. It calls `pingSlack` only if the user accepts.

  The handoff sends the reason, open issues, transcript and partial form to Slack, shows the reference in the chat, and fires only once.

Case 3 is the one that does not depend on the model's judgement: the counter lives in the client, travels with each request, and is driven by the guard's rejections.

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
