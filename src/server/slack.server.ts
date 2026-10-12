import { env } from "cloudflare:workers";

import type { ChatMessage } from "#/features/intake/events";
import { type IntakeDraft, validateComplete } from "#/features/intake/schema";

const TRANSCRIPT_LIMIT = 20;
const MESSAGE_LIMIT = 500;

export type HandoffPayload = {
	reason?: string;
	messages: ChatMessage[];
	form: IntakeDraft;
};

/** Slack mrkdwn only needs these three escaped. */
const escapeSlack = (text: string): string =>
	text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const FENCE = "```";

/** A stray fence inside the body would end the code block early. */
const codeBlock = (body: string, language = ""): string =>
	`${FENCE}${language}\n${escapeSlack(body).replaceAll(FENCE, "'''")}\n${FENCE}`;

const truncate = (text: string): string =>
	text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT)}…` : text;

export const formatHandoffMessage = ({
	reason,
	messages,
	form,
}: HandoffPayload): string => {
	const open = Object.entries(validateComplete(form)).map(
		([path, message]) => `• \`${path}\`: ${escapeSlack(message)}`,
	);

	const transcript = messages
		.filter((m) => m.content)
		.slice(-TRANSCRIPT_LIMIT)
		.map((m) => `${m.role}: ${truncate(m.content.replaceAll(/\s+/g, " "))}`);

	return [
		":raising_hand: *Customer requested a human agent*",
		`*Reason*\n${escapeSlack(reason || "Not provided")}`,
		`*Open issues*\n${open.length ? open.join("\n") : "None"}`,
		`*Transcript* (last ${TRANSCRIPT_LIMIT})\n${transcript.length ? codeBlock(transcript.join("\n")) : "None"}`,
		`*Application*\n${codeBlock(JSON.stringify(form, null, 2), "json")}`,
	].join("\n\n");
};

/**
 * Posts the handoff to the Slack incoming webhook. Unconfigured, dev logs the message and
 * reports ok; production reports failure rather than pretend someone was notified.
 */
export const sendHandoffToSlack = async (
	payload: HandoffPayload,
): Promise<{ ok: boolean; ref: string }> => {
	const ref = crypto.randomUUID();
	const text = formatHandoffMessage(payload);
	const url = (env as { SLACK_WEBHOOK_URL?: string }).SLACK_WEBHOOK_URL;

	if (!url && import.meta.env.PROD) {
		console.error(`[pingSlack:${ref}] SLACK_WEBHOOK_URL is not configured`);

		return { ok: false, ref };
	}

	if (!url) {
		console.warn("[pingSlack] SLACK_WEBHOOK_URL not set; logging instead");
		console.log(`[pingSlack:${ref}]\n${text}`);

		return { ok: true, ref };
	}

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text }),
	});

	if (!response.ok) {
		console.error(`[pingSlack:${ref}] Slack responded ${response.status}`);
	}

	return { ok: response.ok, ref };
};
