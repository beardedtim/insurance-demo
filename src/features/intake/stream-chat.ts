import type { ChatRequest, IntakeEvent } from "./events";
import { parseSseStream } from "./sse";
import {
	addMessage,
	appendToLastMessage,
	applyPatch,
	intakeStore,
	setHandoff,
	setStreaming,
} from "./store";

export const handleEvent = (event: IntakeEvent): void => {
	switch (event.type) {
		case "message.delta":
			appendToLastMessage(event.text);

			return;
		case "form.patch":
			applyPatch(event.patch);

			return;
		case "handoff.requested":
			setHandoff(event.ref);

			return;
		case "error":
			appendToLastMessage(`\n[error] ${event.message}`);

			return;
		default:
			return;
	}
};

/** Sends a user message plus the current form to the BFF and applies the SSE stream. */
export const sendChat = async (content: string): Promise<void> => {
	if (intakeStore.state.streaming) {
		return;
	}

	addMessage({ role: "user", content });

	const request: ChatRequest = {
		messages: intakeStore.state.messages,
		form: intakeStore.state.values,
	};

	addMessage({ role: "assistant", content: "" });
	setStreaming(true);

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
			handleEvent(event);
		}
	} catch (error) {
		handleEvent({
			type: "error",
			message: error instanceof Error ? error.message : "Unknown error",
		});
	} finally {
		setStreaming(false);
	}
};
