import type { IntakeEvent } from "./events";

export const encodeSse = (event: IntakeEvent): string =>
	`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

const parseFrame = (frame: string): IntakeEvent | undefined => {
	const data = frame
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice("data:".length).trimStart())
		.join("\n");

	return data ? (JSON.parse(data) as IntakeEvent) : undefined;
};

/** Parses an SSE byte stream into events, tolerating frames split across chunks. */
export async function* parseSseStream(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<IntakeEvent> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();

		if (done) {
			break;
		}

		buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");

		const frames = buffer.split("\n\n");

		buffer = frames.pop() ?? "";

		for (const frame of frames) {
			const event = parseFrame(frame);

			if (event) {
				yield event;
			}
		}
	}

	const last = parseFrame(buffer);

	if (last) {
		yield last;
	}
}
