import { env } from "cloudflare:workers";
import { z } from "zod";

import type { ChatRequest, IntakeEvent } from "#/features/intake/events";
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

const systemPrompt = ({ form }: Pick<ChatRequest, "form">): string => {
	const errors = Object.entries(validateComplete(form));
	const open = errors.length
		? errors.map(([path, message]) => `- ${path}: ${message}`).join("\n")
		: "None. The form is complete and valid.";

	return [
		"You are an assistant that helps a user fill out a car insurance intake form through conversation.",
		`Call the ${FORM_TOOL} tool whenever the user gives you a value for a field. Never guess values the user has not stated.`,
		"Ask for missing or invalid fields one or two at a time, and keep replies short and friendly.",
		"The form values below are the source of truth, even if the conversation says something different (the user may have edited the form by hand).",
		`If a form value differs from what was said earlier in the conversation, do NOT change the form to match the conversation and do NOT call ${FORM_TOOL} to revert it. Keep the form value and briefly point out the difference once, e.g. "You told me NY and I entered NY, but the form now says CA. I'll go with CA, just flagging it."`,
		`Only call ${FORM_TOOL} on a field that already has a different value if the user explicitly asks for that change in their latest message.`,
		`Current form values (JSON): ${JSON.stringify(form)}`,
		`Open issues:\n${open}`,
	].join("\n\n");
};

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

const parsePatch = (call: ToolCall): IntakeDraft | undefined => {
	try {
		const parsed = intakeDraftSchema.partial().safeParse(JSON.parse(call.args));

		return parsed.success ? parsed.data : undefined;
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

const mergeDraft = (base: IntakeDraft, patch: IntakeDraft): IntakeDraft => {
	const merged: Record<string, unknown> = { ...base };

	for (const [section, values] of Object.entries(patch)) {
		merged[section] = {
			...(base as Record<string, object>)[section],
			...values,
		};
	}

	return merged as IntakeDraft;
};

/** Lists the changed fields, e.g. "driver.name, driver.email". */
const describePatch = (patch: IntakeDraft): string =>
	Object.entries(patch)
		.flatMap(([section, values]) =>
			Object.keys(values ?? {}).map((field) => `${section}.${field}`),
		)
		.join(", ");

/**
 * Streams a Together.AI chat completion as `IntakeEvent`s. Text deltas become
 * `message.delta`; `update_form` tool calls become `form.patch` and `pingSlack` hands the
 * conversation to the customer-service team; results are fed
 * back to the model so it can continue the conversation.
 */
export async function* runChat({
	messages,
	form,
}: ChatRequest): AsyncGenerator<IntakeEvent> {
	const { apiKey, url, model, maxRounds } = readConfig();

	let current = form;
	let spoke = false;

	const history: TogetherMessage[] = [
		{ role: "system", content: systemPrompt({ form }) },
		...messages.filter((m) => m.content),
	];

	for (let round = 0; round < maxRounds; round++) {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				messages: history,
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

				const result = await sendHandoffToSlack({
					reason: parseReason(call),
					messages,
					form: current,
				}).catch((error: unknown) => {
					console.error("[pingSlack] failed", error);

					return undefined;
				});

				if (result?.ok) {
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

			const patch = parsePatch(call);

			if (patch) {
				current = mergeDraft(current, patch);

				yield { type: "form.patch", patch };
			}

			yield {
				type: "action.finished",
				id,
				ok: Boolean(patch),
				detail: patch ? describePatch(patch) : "Invalid values, nothing saved",
			};

			history.push({
				role: "tool",
				tool_call_id: call.id,
				content: patch ? "ok" : "error: invalid arguments, nothing was saved",
			});
		}
	}

	yield { type: "message.done" };
	yield { type: "done" };
}
