import * as R from "ramda";

import type { ChatRequest, IntakeEvent } from "./events";
import { parseSseStream } from "./sse";
import {
	addMessage,
	appendToLastMessage,
	applyPatch,
	clearEdits,
	finishAction,
	intakeStore,
	selectEdits,
	selectMessages,
	selectTouched,
	setHandoff,
	setRejected,
	setStreaming,
	setStrikes,
	startAction,
} from "./store";

type EventOf<T extends IntakeEvent["type"]> = Extract<IntakeEvent, { type: T }>;

/** A `R.cond` branch: runs `handler` for events of one type. */
const on = <T extends IntakeEvent["type"]>(
	type: T,
	handler: (event: EventOf<T>) => void,
): [(event: IntakeEvent) => boolean, (event: IntakeEvent) => void] => [
	(event) => event.type === type,
	(event) => handler(event as EventOf<T>),
];

/** Maps each server event to a store action. Events with no branch are ignored. */
export const handleEvent: (event: IntakeEvent) => void = R.cond([
	on("message.delta", (e) => appendToLastMessage(e.text)),
	on("action.started", (e) =>
		startAction({ id: e.id, kind: e.kind, label: e.label }),
	),
	on("action.finished", (e) => finishAction(e.id, e.ok, e.detail)),
	on("form.patch", (e) => applyPatch(e.patch)),
	on("form.rejected", (e) => setRejected(e.fields)),
	on("handoff.requested", (e) => setHandoff(e.ref)),
	on("error", (e) => appendToLastMessage(`\n[error] ${e.message}`)),
]);

/** Sends a user message plus the current form to the BFF and applies the SSE stream. */
export const sendChat = async (content: string): Promise<void> => {
	if (intakeStore.state.streaming) {
		return;
	}

	addMessage({ role: "user", content });

	const { entries, values, provenance, edits, strikes, handoff } =
		intakeStore.state;
	const request: ChatRequest = {
		messages: selectMessages(entries),
		form: values,
		touched: selectTouched(provenance),
		edits: selectEdits(edits),
		strikes,
		handoffRef: handoff.ref,
	};

	clearEdits();

	addMessage({ role: "assistant", content: "" });
	setStreaming(true);

	let rejected = false;
	let saved = false;

	try {
		const response = await fetch("/api/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(request),
		});

		if (!response.ok || !response.body) {
			throw new Error(`Request failed (${response.status})`);
		}

		for await (const event of parseSseStream(response.body)) {
			rejected ||= event.type === "form.rejected";
			saved ||= event.type === "form.patch";
			handleEvent(event);
		}

		// A turn that only produced rejections counts toward offering a human.
		setStrikes(saved ? 0 : rejected ? strikes + 1 : strikes);
	} catch (error) {
		handleEvent({
			type: "error",
			message: error instanceof Error ? error.message : "Unknown error",
		});
	} finally {
		setStreaming(false);
	}
};
