import { createFileRoute } from "@tanstack/react-router";

import { chatRequestSchema } from "#/features/intake/events";
import { encodeSse } from "#/features/intake/sse";
import { runChat } from "#/server/chat.server";

const sseHeaders = {
	"Content-Type": "text/event-stream",
	"Cache-Control": "no-cache, no-transform",
	Connection: "keep-alive",
};

export const Route = createFileRoute("/api/chat")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const parsed = chatRequestSchema.safeParse(
					await request.json().catch(() => undefined),
				);

				if (!parsed.success) {
					return Response.json(
						{ error: "Invalid request", issues: parsed.error.issues },
						{ status: 400 },
					);
				}

				const encoder = new TextEncoder();
				const events = runChat(parsed.data);

				const stream = new ReadableStream<Uint8Array>({
					async pull(controller) {
						if (request.signal.aborted) {
							controller.close();

							return;
						}

						try {
							const { done, value } = await events.next();

							if (done) {
								controller.close();

								return;
							}

							controller.enqueue(encoder.encode(encodeSse(value)));
						} catch (error) {
							const message =
								error instanceof Error ? error.message : "Stream failed";

							controller.enqueue(
								encoder.encode(encodeSse({ type: "error", message })),
							);
							controller.close();
						}
					},
					cancel() {
						return events.return(undefined).then(() => undefined);
					},
				});

				return new Response(stream, { headers: sseHeaders });
			},
		},
	},
});
