import type { ChatMessage } from "#/features/intake/events";
import { type IntakeDraft, validateComplete } from "#/features/intake/schema";

const TRANSCRIPT_LIMIT = 20;

export type HandoffPayload = {
	reason?: string;
	messages: ChatMessage[];
	form: IntakeDraft;
};

export const formatHandoffMessage = ({
	reason,
	messages,
	form,
}: HandoffPayload): string => {
	const open = Object.entries(validateComplete(form)).map(
		([path, message]) => `- ${path}: ${message}`,
	);

	const transcript = messages
		.filter((m) => m.content)
		.slice(-TRANSCRIPT_LIMIT)
		.map((m) => `${m.role}: ${m.content}`);

	return [
		"Customer requested a human agent.",
		`Reason: ${reason || "Not provided"}`,
		`Open issues:\n${open.length ? open.join("\n") : "None"}`,
		`Transcript:\n${transcript.join("\n")}`,
		`Application (JSON):\n${JSON.stringify(form, null, 2)}`,
	].join("\n\n");
};

/** Mock Slack delivery. Replace the body with a `fetch` to the Slack webhook. */
export const sendHandoffToSlack = async (
	payload: HandoffPayload,
): Promise<{ ok: boolean; ref: string }> => {
	const ref = crypto.randomUUID();

	console.log(`[pingSlack:${ref}]\n${formatHandoffMessage(payload)}`);

	return { ok: true, ref };
};
