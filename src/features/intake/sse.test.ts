import { describe, expect, it } from "vitest";

import type { IntakeEvent } from "./events";
import { encodeSse, parseSseStream } from "./sse";

const streamOf = (...parts: string[]): ReadableStream<Uint8Array> => {
	const encoder = new TextEncoder();

	return new ReadableStream({
		start(controller) {
			for (const part of parts) {
				controller.enqueue(encoder.encode(part));
			}

			controller.close();
		},
	});
};

const collect = async (body: ReadableStream<Uint8Array>) => {
	const events: IntakeEvent[] = [];

	for await (const event of parseSseStream(body)) {
		events.push(event);
	}

	return events;
};

const events: IntakeEvent[] = [
	{ type: "message.delta", text: "hi" },
	{ type: "handoff.requested", ref: "abc" },
	{ type: "done" },
];

describe("sse", () => {
	it("round-trips encoded events", async () => {
		expect(await collect(streamOf(...events.map(encodeSse)))).toEqual(events);
	});

	it("tolerates frames split across chunks", async () => {
		const whole = events.map(encodeSse).join("");

		expect(await collect(streamOf(whole.slice(0, 7), whole.slice(7)))).toEqual(
			events,
		);
	});

	it("tolerates CRLF line endings", async () => {
		const whole = events.map(encodeSse).join("").replaceAll("\n", "\r\n");

		expect(await collect(streamOf(whole))).toEqual(events);
	});
});
