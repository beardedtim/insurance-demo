import { Store } from "@tanstack/store";
import * as R from "ramda";

import type { ActionKind, ActionStatus, ChatMessage, UserEdit } from "./events";
import { type FieldErrors, type IntakeDraft, validateDraft } from "./schema";

/** Something the agent did, shown inline in the chat. Never sent to the server. */
export type ActionEntry = {
	role: "action";
	id: string;
	kind: ActionKind;
	label: string;
	status: ActionStatus;
	detail?: string;
};

export type ChatEntry = ChatMessage | ActionEntry;

/** Who last wrote a field. "agent" values are proposals until the user confirms or edits. */
export type Provenance = "agent" | "user" | "confirmed";

export type IntakeState = {
	values: IntakeDraft;
	errors: FieldErrors;
	/** `section.field` -> who last wrote it. Absent means empty. */
	provenance: Record<string, Provenance>;
	/** `section.field` -> why the agent's proposal for it was not saved. */
	rejected: Record<string, string>;
	/** Hand edits since the last chat turn, as `section.field` -> first and latest value. */
	edits: Record<string, { from: unknown; to: unknown }>;
	/** Consecutive turns where proposals were rejected and nothing was saved. */
	strikes: number;
	entries: ChatEntry[];
	streaming: boolean;
	handoff: { status: "idle" | "sent"; ref?: string };
};

export const intakeStore = new Store<IntakeState>({
	values: {},
	errors: {},
	provenance: {},
	rejected: {},
	edits: {},
	strikes: 0,
	entries: [],
	streaming: false,
	handoff: { status: "idle" },
});

/** Patch values win; nested objects merge. */
export const deepMerge = R.mergeDeepRight;

const withValues = (state: IntakeState, values: IntakeDraft): IntakeState => ({
	...state,
	values,
	errors: validateDraft(values),
});

const pathsOf = (patch: IntakeDraft): string[] =>
	R.chain(
		([section, values]) =>
			Object.keys(values ?? {}).map((field) => `${section}.${field}`),
		Object.entries(patch),
	);

/** Shared write path for the agent: every field it writes becomes a proposal. */
export const applyPatch = (patch: IntakeDraft): void => {
	const paths = pathsOf(patch);

	intakeStore.setState((state) => ({
		...withValues(state, deepMerge(state.values, patch)),
		provenance: {
			...state.provenance,
			...R.fromPairs(paths.map((path) => [path, "agent" as const])),
		},
		rejected: R.omit(paths, state.rejected),
	}));
};

/** Sets (or clears, with undefined) a single field as a user edit. */
export const setField = <S extends keyof IntakeDraft>(
	section: S,
	field: keyof NonNullable<IntakeDraft[S]>,
	value: unknown,
): void => {
	const path = `${section}.${String(field)}`;

	intakeStore.setState((state) => {
		const previous = (
			state.values[section] as Record<string, unknown> | undefined
		)?.[String(field)];
		const from = path in state.edits ? state.edits[path]?.from : previous;
		const cleared = value === undefined;

		return {
			...withValues(state, {
				...state.values,
				[section]: { ...state.values[section], [field]: value },
			}),
			provenance: cleared
				? R.omit([path], state.provenance)
				: { ...state.provenance, [path]: "user" },
			rejected: R.omit([path], state.rejected),
			edits:
				from === value
					? R.omit([path], state.edits)
					: { ...state.edits, [path]: { from, to: value } },
			strikes: 0,
		};
	});
};

/** The user accepts a proposed value as correct. */
export const confirmField = (path: string): void => {
	intakeStore.setState((state) =>
		state.provenance[path] === "agent"
			? { ...state, provenance: { ...state.provenance, [path]: "confirmed" } }
			: state,
	);
};

/** Fields the agent must not overwrite unless the user asks: typed or confirmed ones. */
export const selectTouched = (
	provenance: IntakeState["provenance"],
): string[] => R.keys(R.reject(R.equals("agent"), provenance));

export const selectEdits = (edits: IntakeState["edits"]): UserEdit[] =>
	R.toPairs(edits).map(([path, { from, to }]) => ({ path, from, to }));

/** The agent's proposals that failed validation; shown on the field until it changes. */
export const setRejected = (fields: Record<string, string>): void => {
	intakeStore.setState((state) => ({
		...state,
		rejected: { ...state.rejected, ...fields },
	}));
};

/** A turn failed before the agent saw these edits; keep them for the next one. */
export const restoreEdits = (previous: IntakeState["edits"]): void => {
	intakeStore.setState((state) => ({
		...state,
		edits: { ...previous, ...state.edits },
	}));
};

/** Hand edits have been delivered to the agent. */
export const clearEdits = (): void => {
	intakeStore.setState((state) => ({ ...state, edits: {} }));
};

export const setStrikes = (strikes: number): void => {
	intakeStore.setState((state) => ({ ...state, strikes }));
};

export const addMessage = (message: ChatMessage): void => {
	intakeStore.setState((state) => ({
		...state,
		entries: [...state.entries, message],
	}));
};

/** Appends to the last assistant bubble, opening a new one after an action. */
export const appendToLastMessage = (text: string): void => {
	intakeStore.setState((state) => {
		const last = state.entries.at(-1);

		if (!last || last.role === "action") {
			return {
				...state,
				entries: [...state.entries, { role: "assistant", content: text }],
			};
		}

		return {
			...state,
			entries: [
				...state.entries.slice(0, -1),
				{ ...last, content: last.content + text },
			],
		};
	});
};

export const startAction = (
	action: Pick<ActionEntry, "id" | "kind" | "label">,
): void => {
	intakeStore.setState((state) => {
		const last = state.entries.at(-1);
		const isEmptyBubble = last?.role === "assistant" && last.content === "";
		const kept = isEmptyBubble ? state.entries.slice(0, -1) : state.entries;

		return {
			...state,
			entries: [...kept, { ...action, role: "action", status: "running" }],
		};
	});
};

export const finishAction = (
	id: string,
	ok: boolean,
	detail?: string,
): void => {
	intakeStore.setState((state) => ({
		...state,
		entries: state.entries.map((entry) =>
			entry.role === "action" && entry.id === id
				? { ...entry, status: ok ? "done" : "failed", detail }
				: entry,
		),
	}));
};

/** The conversation as the server sees it: no agent actions. */
export const selectMessages = (entries: ChatEntry[]): ChatMessage[] =>
	entries.filter((entry): entry is ChatMessage => entry.role !== "action");

export const setStreaming = (streaming: boolean): void => {
	intakeStore.setState((state) => ({ ...state, streaming }));
};

export const setHandoff = (ref: string): void => {
	intakeStore.setState((state) => ({
		...state,
		handoff: { status: "sent", ref },
	}));
};
