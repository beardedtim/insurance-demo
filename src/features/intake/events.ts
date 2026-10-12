import { z } from "zod";

import { type IntakeDraft, intakeDraftSchema } from "./schema";

export const chatMessageSchema = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.string(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** A field the user changed by hand since the previous turn. */
export const userEditSchema = z.object({
	path: z.string(),
	from: z.unknown().optional(),
	to: z.unknown().optional(),
});

export type UserEdit = z.infer<typeof userEditSchema>;

export const chatRequestSchema = z.object({
	messages: z.array(chatMessageSchema),
	form: intakeDraftSchema.partial(),
	/** `section.field` paths the user typed or confirmed; the agent may not overwrite them. */
	touched: z.array(z.string()).optional(),
	/** Hand edits made since the previous turn, so the agent sees them explicitly. */
	edits: z.array(userEditSchema).optional(),
	/** Consecutive turns where the agent's proposals were rejected and nothing was saved. */
	strikes: z.number().int().min(0).optional(),
	/** Set once a human handoff has been sent, so it is not sent twice. */
	handoffRef: z.string().optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export type ActionKind = "form.update" | "slack.handoff";

export type ActionStatus = "running" | "done" | "failed";

/** The SSE contract between the BFF and the client. */
export type IntakeEvent =
	| { type: "message.delta"; text: string }
	| { type: "message.done" }
	| { type: "action.started"; id: string; kind: ActionKind; label: string }
	| { type: "action.finished"; id: string; ok: boolean; detail?: string }
	| { type: "form.patch"; patch: IntakeDraft }
	| { type: "form.rejected"; fields: Record<string, string> }
	| { type: "handoff.requested"; ref: string }
	| { type: "error"; message: string }
	| { type: "done" };
