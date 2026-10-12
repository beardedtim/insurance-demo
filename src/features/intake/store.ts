import { Store } from "@tanstack/store";

import type { ActionKind, ActionStatus, ChatMessage } from "./events";
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

export type IntakeState = {
	values: IntakeDraft;
	errors: FieldErrors;
	entries: ChatEntry[];
	streaming: boolean;
	handoff: { status: "idle" | "sent"; ref?: string };
};

export const intakeStore = new Store<IntakeState>({
	values: {},
	errors: {},
	entries: [],
	streaming: false,
	handoff: { status: "idle" },
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const deepMerge = <T>(base: T, patch: unknown): T => {
	if (!isPlainObject(base) || !isPlainObject(patch)) {
		return patch === undefined ? base : (patch as T);
	}

	const entries = Object.entries(patch).map(([key, value]) => [
		key,
		deepMerge(base[key], value),
	]);

	return { ...base, ...Object.fromEntries(entries) } as T;
};

const withValues = (state: IntakeState, values: IntakeDraft): IntakeState => ({
	...state,
	values,
	errors: validateDraft(values),
});

/** Shared write path: the user and the agent both go through here. */
export const applyPatch = (patch: IntakeDraft): void => {
	intakeStore.setState((state) =>
		withValues(state, deepMerge(state.values, patch)),
	);
};

/** Sets (or clears, with undefined) a single field. */
export const setField = <S extends keyof IntakeDraft>(
	section: S,
	field: keyof NonNullable<IntakeDraft[S]>,
	value: unknown,
): void => {
	intakeStore.setState((state) =>
		withValues(state, {
			...state.values,
			[section]: { ...state.values[section], [field]: value },
		}),
	);
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
