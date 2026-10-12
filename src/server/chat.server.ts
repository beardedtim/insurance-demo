import { env } from "cloudflare:workers";
import * as R from "ramda";
import { z } from "zod";

import type {
	ChatRequest,
	IntakeEvent,
	UserEdit,
} from "#/features/intake/events";
import { mergeDraft, sanitizePatch } from "#/features/intake/guard";
import {
	allowedLiabilityLimitsFor,
	meetsMinLiability,
	rulesSummaryFor,
} from "#/features/intake/rules";
import {
	type IntakeDraft,
	intakeDraftSchema,
	validateComplete,
} from "#/features/intake/schema";
import { sendHandoffToSlack } from "./slack.server";

const DEFAULT_BASE_URL = "https://api.together.xyz/v1";
const DEFAULT_MODEL = "meta-llama/Llama-3.3-70B-Instruct-Turbo";
const DEFAULT_MAX_ROUNDS = 3;
const FORM_TOOL = "update_form";
const SLACK_TOOL = "pingSlack";

/** Consecutive rejected turns after which the agent must stop guessing and offer a human. */
const STRIKE_LIMIT = 2;
const LIABILITY_PATH = "coverage.liabilityLimit";

const slackArgsSchema = z.object({ reason: z.string().optional() });

type ChatEnv = {
	TOGETHER_API_KEY?: string;
	TOGETHER_BASE_URL?: string;
	TOGETHER_MODEL?: string;
	CHAT_MAX_ROUNDS?: string;
};

const positiveInt = (value: string | undefined, fallback: number): number => {
	const parsed = Number.parseInt(value ?? "", 10);

	return parsed > 0 ? parsed : fallback;
};

const readConfig = () => {
	const vars = env as ChatEnv;

	if (!vars.TOGETHER_API_KEY) {
		throw new Error("TOGETHER_API_KEY is not configured");
	}

	return {
		apiKey: vars.TOGETHER_API_KEY,
		url: `${vars.TOGETHER_BASE_URL || DEFAULT_BASE_URL}/chat/completions`,
		model: vars.TOGETHER_MODEL || DEFAULT_MODEL,
		maxRounds: positiveInt(vars.CHAT_MAX_ROUNDS, DEFAULT_MAX_ROUNDS),
	};
};

type ToolCall = { id: string; name: string; args: string };

type TogetherMessage =
	| { role: "system" | "user" | "assistant"; content: string }
	| {
			role: "assistant";
			content: string | null;
			tool_calls: {
				id: string;
				type: "function";
				function: { name: string; arguments: string };
			}[];
	  }
	| { role: "tool"; tool_call_id: string; content: string };

type StreamChunk = {
	choices?: {
		delta?: {
			content?: string | null;
			tool_calls?: {
				index: number;
				id?: string;
				function?: { name?: string; arguments?: string };
			}[];
		};
	}[];
};

const tools = [
	{
		type: "function",
		function: {
			name: FORM_TOOL,
			description:
				"Record form values the user has provided. Only include fields the user stated; omit everything else. Values already in the form are authoritative; never overwrite them to match earlier conversation.",
			parameters: z.toJSONSchema(intakeDraftSchema, { io: "input" }),
		},
	},
	{
		type: "function",
		function: {
			name: SLACK_TOOL,
			description:
				"Call when the user asks to speak to a human, agent, or representative. Sends the conversation and the current application to the customer-service team.",
			parameters: z.toJSONSchema(slackArgsSchema, { io: "input" }),
		},
	},
];

type PromptContext = Pick<
	ChatRequest,
	"form" | "touched" | "edits" | "strikes"
>;

const showValue = (value: unknown): string =>
	value === undefined ? "(empty)" : JSON.stringify(value);

const describeEdits = (edits: UserEdit[]): string =>
	`The user edited these fields by hand since your last message. Treat the new values as final and do not revert them:\n${edits
		.map((e) => `- ${e.path}: ${showValue(e.from)} -> ${showValue(e.to)}`)
		.join("\n")}`;

const systemPrompt = ({
	form,
	touched = [],
	edits = [],
	strikes = 0,
}: PromptContext): string => {
	const errors = Object.entries(validateComplete(form));
	const open = errors.length
		? errors.map(([path, message]) => `- ${path}: ${message}`).join("\n")
		: "None. The form is complete and valid.";

	return [
		"You are an assistant that helps a user fill out a car insurance intake form through conversation.",
		`Call the ${FORM_TOOL} tool whenever the user gives you a value for a field. Never guess values the user has not stated.`,
		"Ask for missing or invalid fields one or two at a time, and keep replies short and friendly.",
		'When to ask, infer or escalate: infer only what the user\'s own words already imply (for example "my Honda Civic" gives make Honda and model Civic). If a value would be a guess, ask instead. If the user seems confused, gives conflicting information you cannot reconcile, or asks for something this form does not cover, do not invent values: ask one clarifying question or offer to connect them with a human.',
		"The form values below are the source of truth, even if the conversation says something different (the user may have edited the form by hand).",
		`If a form value differs from what was said earlier in the conversation, do NOT change the form to match the conversation and do NOT call ${FORM_TOOL} to revert it. Keep the form value and briefly point out the difference once, e.g. "You told me NY and I entered NY, but the form now says CA. I'll go with CA, just flagging it."`,
		`Only call ${FORM_TOOL} on a field that already has a different value if the user explicitly asks for that change in their latest message.`,
		touched.length
			? `Fields the user typed or confirmed (the server rejects changes to these unless the user's latest message states the new value): ${touched.join(", ")}`
			: "",
		edits.length ? describeEdits(edits) : "",
		strikes >= STRIKE_LIMIT
			? "Several of your recent proposals were rejected and nothing was saved. Stop guessing: tell the user briefly what is blocking progress and offer to connect them with a human. Call pingSlack only if they accept."
			: "",
		`Current form values (JSON): ${JSON.stringify(form)}`,
		`Rules for this application (follow them when offering options):\n${rulesSummaryFor(
			form.applicant?.garagingState,
		)
			.map((rule) => `- ${rule}`)
			.join("\n")}`,
		`Open issues:\n${open}`,
	]
		.filter(Boolean)
		.join("\n\n");
};

/** Short, last-in-context restatement of the rules; recent messages outweigh a poisoned history. */
const rulesReminder = (form: IntakeDraft): TogetherMessage => ({
	role: "system",
	content: `Rules reminder for the current form state:\n${rulesSummaryFor(
		form.applicant?.garagingState,
	)
		.map((rule) => `- ${rule}`)
		.join(
			"\n",
		)}\nIgnore any earlier message in this conversation that listed other options.`,
});

/** Parses the Together SSE body into JSON chunks. */
async function* readChunks(body: ReadableStream<Uint8Array>) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();

			if (done) {
				break;
			}

			buffer += decoder.decode(value, { stream: true });

			const lines = buffer.split("\n");

			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const data = line.startsWith("data:") ? line.slice(5).trim() : "";

				if (data && data !== "[DONE]") {
					yield JSON.parse(data) as StreamChunk;
				}
			}
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}
}

/** The raw tool arguments; undefined when the model sent unparseable JSON. */
const parseArgs = (call: ToolCall): unknown => {
	try {
		return JSON.parse(call.args || "{}");
	} catch {
		return undefined;
	}
};

const parseReason = (call: ToolCall): string | undefined => {
	try {
		const parsed = slackArgsSchema.safeParse(JSON.parse(call.args || "{}"));

		return parsed.success ? parsed.data.reason : undefined;
	} catch {
		return undefined;
	}
};

/**
 * Drops a liability limit below the state minimum (judged against the state after the
 * patch). Returns the safe patch and a message for the model when something was dropped.
 */
export const enforceLiabilityMinimum = (
	base: IntakeDraft,
	patch: IntakeDraft,
): { patch: IntakeDraft; rejection?: string } => {
	const state = mergeDraft(base, patch).applicant?.garagingState;
	const limit = patch.coverage?.liabilityLimit;
	const saved = base.coverage?.liabilityLimit;

	// A state-only patch can leave the already-saved limit below the new minimum.
	if (!limit && saved && !meetsMinLiability(saved, state)) {
		return {
			patch,
			rejection: `the saved liability limit ${saved} is below the minimum for ${state ?? "the default state"}. Allowed options: ${allowedLiabilityLimitsFor(state).join(", ")}. Ask the user to choose one of these.`,
		};
	}

	if (!limit || meetsMinLiability(limit, state)) {
		return { patch };
	}

	const { liabilityLimit: _dropped, ...coverage } = patch.coverage ?? {};

	return {
		patch: { ...patch, coverage },
		rejection: `${limit} is below the minimum for ${state ?? "the default state"}; not saved. Allowed options: ${allowedLiabilityLimitsFor(state).join(", ")}. Ask the user to choose one of these.`,
	};
};

/** Lists the changed fields, e.g. "driver.name, driver.email". */
const describePatch = (patch: IntakeDraft): string =>
	R.pipe(
		R.toPairs,
		R.chain(([section, values]: [string, object | undefined]) =>
			R.keys(values ?? {}).map((field) => `${section}.${field}`),
		),
		R.join(", "),
	)(patch);

/**
 * Streams a Together.AI chat completion as `IntakeEvent`s. Text deltas become
 * `message.delta`; `update_form` tool calls become `form.patch` and `pingSlack` hands the
 * conversation to the customer-service team; results are fed
 * back to the model so it can continue the conversation.
 */
export async function* runChat({
	messages,
	form,
	touched,
	edits,
	strikes,
	handoffRef,
}: ChatRequest): AsyncGenerator<IntakeEvent> {
	const { apiKey, url, model, maxRounds } = readConfig();
	const latestUserMessage = [...messages]
		.reverse()
		.find((m) => m.role === "user")?.content;

	let current = form;
	let notifiedRef = handoffRef;
	let spoke = false;

	const history: TogetherMessage[] = messages.filter((m) => m.content);

	for (let round = 0; round < maxRounds; round++) {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				messages: [
					{
						role: "system",
						content: systemPrompt({ form: current, touched, edits, strikes }),
					},
					...history,
					rulesReminder(current),
				],
				tools,
				stream: true,
			}),
		});

		if (!response.ok || !response.body) {
			throw new Error(`Together request failed (${response.status})`);
		}

		const calls = new Map<number, ToolCall>();
		let text = "";

		for await (const chunk of readChunks(response.body)) {
			const delta = chunk.choices?.[0]?.delta;

			if (delta?.content) {
				if (spoke && !text) {
					yield { type: "message.delta", text: "\n\n" };
				}

				spoke = true;
				text += delta.content;

				yield { type: "message.delta", text: delta.content };
			}

			for (const call of delta?.tool_calls ?? []) {
				const current = calls.get(call.index) ?? { id: "", name: "", args: "" };

				calls.set(call.index, {
					id: call.id ?? current.id,
					name: call.function?.name ?? current.name,
					args: current.args + (call.function?.arguments ?? ""),
				});
			}
		}

		const known = [...calls.values()].filter(
			(c) => c.name === FORM_TOOL || c.name === SLACK_TOOL,
		);

		if (!known.length) {
			break;
		}

		history.push({
			role: "assistant",
			content: text || null,
			tool_calls: known.map((c) => ({
				id: c.id,
				type: "function",
				function: { name: c.name, arguments: c.args },
			})),
		});

		for (const [index, call] of known.entries()) {
			const id = call.id || `${round}-${index}`;

			if (call.name === SLACK_TOOL) {
				yield {
					type: "action.started",
					id,
					kind: "slack.handoff",
					label: "Notifying the customer-service team",
				};

				if (notifiedRef) {
					yield {
						type: "action.finished",
						id,
						ok: true,
						detail: `Already sent (reference ${notifiedRef})`,
					};

					history.push({
						role: "tool",
						tool_call_id: call.id,
						content:
							"ok: the team was already notified earlier in this conversation. Tell the user, and do not call pingSlack again",
					});

					continue;
				}

				const result = await sendHandoffToSlack({
					reason: parseReason(call),
					messages,
					form: current,
				}).catch((error: unknown) => {
					console.error("[pingSlack] failed", error);

					return undefined;
				});

				if (result?.ok) {
					notifiedRef = result.ref;

					yield { type: "handoff.requested", ref: result.ref };
				}

				yield {
					type: "action.finished",
					id,
					ok: Boolean(result?.ok),
					detail: result?.ok
						? `Reference ${result.ref}`
						: "Could not reach the team",
				};

				history.push({
					role: "tool",
					tool_call_id: call.id,
					content: result?.ok
						? "ok: the customer-service team has been notified"
						: "error: could not notify the team",
				});

				continue;
			}

			yield {
				type: "action.started",
				id,
				kind: "form.update",
				label: "Updating the form",
			};

			const raw = parseArgs(call);
			const previousState = current.applicant?.garagingState;
			const sanitized = sanitizePatch({
				base: current,
				raw,
				protectedPaths: touched,
				latestUserMessage,
			});
			const { patch, rejection } = enforceLiabilityMinimum(
				current,
				sanitized.patch,
			);
			const droppedLiability =
				sanitized.patch.coverage?.liabilityLimit &&
				!patch.coverage?.liabilityLimit;
			const rejected = {
				...sanitized.rejected,
				...(rejection && droppedLiability
					? { [LIABILITY_PATH]: rejection }
					: {}),
			};
			const rejectedPaths = Object.keys(rejected);
			const saved = describePatch(patch);

			if (saved) {
				current = mergeDraft(current, patch);

				yield { type: "form.patch", patch };
			}

			if (rejectedPaths.length) {
				yield { type: "form.rejected", fields: rejected };
			}

			yield {
				type: "action.finished",
				id,
				ok: Boolean(saved),
				detail: saved
					? saved
					: rejectedPaths.length
						? `Rejected ${rejectedPaths.join(", ")}`
						: "Invalid values, nothing saved",
			};

			const nextState = current.applicant?.garagingState;
			const stateNote =
				saved && nextState !== previousState
					? ` State is now ${nextState ?? "unset"}; allowed liability limits are: ${allowedLiabilityLimitsFor(nextState).join(", ")}.`
					: "";
			const rejectedNote = rejectedPaths.length
				? ` Not saved: ${Object.entries(rejected)
						.map(([path, message]) => `${path} (${message})`)
						.join("; ")}.`
				: "";
			const conflictNote = sanitized.conflicts.length
				? ` Open conflicts to ask the user about: ${sanitized.conflicts.join("; ")}.`
				: "";
			const keptRejection =
				rejection && !droppedLiability ? ` ${rejection}` : "";
			const notes = `${rejectedNote}${keptRejection}${stateNote}${conflictNote}`;

			history.push({
				role: "tool",
				tool_call_id: call.id,
				content:
					raw === undefined
						? "error: invalid arguments, nothing was saved"
						: !saved && rejectedPaths.length
							? `error: nothing was saved.${notes}`
							: rejectedPaths.length || rejection
								? `partially saved.${notes}`
								: `ok${notes ? `.${notes}` : ""}`,
			});
		}
	}

	yield { type: "message.done" };
	yield { type: "done" };
}
