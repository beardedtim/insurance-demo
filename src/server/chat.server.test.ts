import { afterEach, describe, expect, it, vi } from "vitest";

import type { IntakeEvent } from "#/features/intake/events";

vi.mock("cloudflare:workers", () => ({
	env: { TOGETHER_API_KEY: "test-key", CHAT_MAX_ROUNDS: "2" },
}));

vi.mock("./slack.server", () => ({ sendHandoffToSlack: vi.fn() }));

import { runChat } from "./chat.server";
import { sendHandoffToSlack } from "./slack.server";

const send = vi.mocked(sendHandoffToSlack);

const sse = (chunks: object[]): Response => {
	const body = `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;

	return new Response(body);
};

const text = (content: string) => ({ choices: [{ delta: { content } }] });

const toolCall = (name: string, args: object, id = "call_1") => ({
	choices: [
		{
			delta: {
				tool_calls: [
					{
						index: 0,
						id,
						function: { name, arguments: JSON.stringify(args) },
					},
				],
			},
		},
	],
});

const collect = async (
	gen: AsyncGenerator<IntakeEvent>,
): Promise<IntakeEvent[]> => {
	const events: IntakeEvent[] = [];

	for await (const event of gen) {
		events.push(event);
	}

	return events;
};

const request = {
	messages: [{ role: "user" as const, content: "hi" }],
	form: {},
};

const stubFetch = (...responses: Response[]) => {
	const fetchMock = vi.fn();

	for (const response of responses) {
		fetchMock.mockResolvedValueOnce(response);
	}

	vi.stubGlobal("fetch", fetchMock);

	return fetchMock;
};

const lastToolMessage = (fetchMock: ReturnType<typeof vi.fn>) => {
	const body = JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body as string);

	return body.messages.at(-1);
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("runChat", () => {
	it("streams text deltas then message.done and done", async () => {
		stubFetch(sse([text("Hello "), text("there")]));

		expect(await collect(runChat(request))).toEqual([
			{ type: "message.delta", text: "Hello " },
			{ type: "message.delta", text: "there" },
			{ type: "message.done" },
			{ type: "done" },
		]);
	});

	it("separates text from successive rounds with a paragraph break", async () => {
		stubFetch(
			sse([
				text("Saving that."),
				toolCall("update_form", { vehicle: { make: "Toyota" } }),
			]),
			sse([text("Anything else?")]),
		);

		const deltas = (await collect(runChat(request))).filter(
			(e) => e.type === "message.delta",
		);

		expect(deltas.map((e) => e.text).join("")).toBe(
			"Saving that.\n\nAnything else?",
		);
	});

	it("turns update_form into form.patch and continues the conversation", async () => {
		const fetchMock = stubFetch(
			sse([toolCall("update_form", { vehicle: { make: "Toyota" } })]),
			sse([text("Got it")]),
		);
		const events = await collect(runChat(request));

		expect(events).toContainEqual({
			type: "form.patch",
			patch: { vehicle: { make: "Toyota" } },
		});
		expect(events).toContainEqual({ type: "message.delta", text: "Got it" });
		expect(lastToolMessage(fetchMock)).toMatchObject({
			role: "tool",
			content: "ok",
		});
	});

	it("reports invalid update_form args back to the model", async () => {
		const fetchMock = stubFetch(
			sse([toolCall("update_form", { vehicle: { year: "nope" } })]),
			sse([text("Sorry")]),
		);
		const events = await collect(runChat(request));

		expect(events.some((e) => e.type === "form.patch")).toBe(false);
		expect(lastToolMessage(fetchMock).content).toContain("error");
	});

	it("emits handoff.requested with the merged form when pingSlack succeeds", async () => {
		send.mockResolvedValue({ ok: true, ref: "ref-1" });
		stubFetch(
			sse([toolCall("update_form", { vehicle: { make: "Toyota" } })]),
			sse([toolCall("pingSlack", { reason: "wants a person" }, "call_2")]),
		);

		const events = await collect(runChat(request));

		expect(events).toContainEqual({ type: "handoff.requested", ref: "ref-1" });
		expect(send).toHaveBeenCalledWith({
			reason: "wants a person",
			messages: request.messages,
			form: { vehicle: { make: "Toyota" } },
		});
	});

	it("does not emit handoff.requested when Slack fails, and tells the model", async () => {
		send.mockResolvedValue({ ok: false, ref: "ref-2" });

		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const fetchMock = stubFetch(
			sse([toolCall("pingSlack", {})]),
			sse([text("Sorry")]),
		);
		const events = await collect(runChat(request));

		expect(events.some((e) => e.type === "handoff.requested")).toBe(false);
		expect(lastToolMessage(fetchMock).content).toContain("error");

		error.mockRestore();
	});

	it("treats a throwing Slack send as a failure", async () => {
		send.mockRejectedValue(new Error("boom"));

		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const fetchMock = stubFetch(
			sse([toolCall("pingSlack", {})]),
			sse([text("Sorry")]),
		);
		const events = await collect(runChat(request));

		expect(events.some((e) => e.type === "handoff.requested")).toBe(false);
		expect(lastToolMessage(fetchMock).content).toContain("error");
		expect(error).toHaveBeenCalled();

		error.mockRestore();
	});

	it("brackets update_form with action events listing the changed fields", async () => {
		stubFetch(
			sse([toolCall("update_form", { vehicle: { make: "Toyota" } })]),
			sse([text("Got it")]),
		);

		const types = (await collect(runChat(request)))
			.filter((e) => e.type.startsWith("action.") || e.type === "form.patch")
			.map((e) => e.type);

		expect(types).toEqual(["action.started", "form.patch", "action.finished"]);
	});

	it("reports invalid update_form args as a failed action", async () => {
		stubFetch(
			sse([toolCall("update_form", { vehicle: { year: "nope" } })]),
			sse([text("Sorry")]),
		);

		const events = await collect(runChat(request));

		expect(events).toContainEqual(
			expect.objectContaining({ type: "action.finished", ok: false }),
		);
	});

	it("reports pingSlack success and failure as actions", async () => {
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		send.mockResolvedValueOnce({ ok: true, ref: "ref-1" });
		stubFetch(sse([toolCall("pingSlack", {})]), sse([text("Done")]));

		expect(await collect(runChat(request))).toContainEqual({
			type: "action.finished",
			id: "call_1",
			ok: true,
			detail: "Reference ref-1",
		});

		send.mockRejectedValueOnce(new Error("boom"));
		stubFetch(sse([toolCall("pingSlack", {})]), sse([text("Sorry")]));

		expect(await collect(runChat(request))).toContainEqual(
			expect.objectContaining({ type: "action.finished", ok: false }),
		);

		error.mockRestore();
	});

	it("emits no action events for unknown tools", async () => {
		stubFetch(sse([toolCall("rm_rf", {})]));

		const events = await collect(runChat(request));

		expect(events.some((e) => e.type.startsWith("action."))).toBe(false);
	});

	it("ignores unknown tools and stops", async () => {
		const fetchMock = stubFetch(sse([toolCall("rm_rf", {})]));

		await collect(runChat(request));

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("stops after CHAT_MAX_ROUNDS", async () => {
		const fetchMock = vi
			.fn()
			.mockImplementation(async () =>
				sse([toolCall("update_form", { vehicle: { make: "Toyota" } })]),
			);

		vi.stubGlobal("fetch", fetchMock);

		const events = await collect(runChat(request));

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(events.at(-1)).toEqual({ type: "done" });
	});

	it("throws when Together responds non-2xx", async () => {
		stubFetch(new Response("nope", { status: 500 }));

		await expect(collect(runChat(request))).rejects.toThrow("500");
	});
});
