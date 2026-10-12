import { Store } from "@tanstack/store";

import type { ChatMessage } from "./events";
import { type FieldErrors, type IntakeDraft, validateDraft } from "./schema";

export type IntakeState = {
	values: IntakeDraft;
	errors: FieldErrors;
	messages: ChatMessage[];
	streaming: boolean;
};

export const intakeStore = new Store<IntakeState>({
	values: {},
	errors: {},
	messages: [],
	streaming: false,
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
		messages: [...state.messages, message],
	}));
};

export const appendToLastMessage = (text: string): void => {
	intakeStore.setState((state) => {
		const last = state.messages.at(-1);

		if (!last) {
			return state;
		}

		return {
			...state,
			messages: [
				...state.messages.slice(0, -1),
				{ ...last, content: last.content + text },
			],
		};
	});
};

export const setStreaming = (streaming: boolean): void => {
	intakeStore.setState((state) => ({ ...state, streaming }));
};
