import { z } from "zod";

import { type IntakeDraft, intakeDraftSchema } from "./schema";

export const chatMessageSchema = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.string(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatRequestSchema = z.object({
	messages: z.array(chatMessageSchema),
	form: intakeDraftSchema.partial(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** The SSE contract between the BFF and the client. */
export type IntakeEvent =
	| { type: "message.delta"; text: string }
	| { type: "message.done" }
	| { type: "form.patch"; patch: IntakeDraft }
	| { type: "error"; message: string }
	| { type: "done" };
