import { beforeEach, describe, expect, it } from "vitest";

import { applyPatch, deepMerge, intakeStore, selectMessages } from "./store";
import { handleEvent } from "./stream-chat";

beforeEach(() => {
	intakeStore.setState(() => ({
		values: {},
		errors: {},
		entries: [{ role: "assistant", content: "" }],
		streaming: false,
		handoff: { status: "idle" },
	}));
});

describe("deepMerge", () => {
	it("merges nested objects without dropping siblings", () => {
		expect(
			deepMerge(
				{ vehicle: { make: "Honda", year: 2020 } },
				{ vehicle: { make: "Toyota" } },
			),
		).toEqual({ vehicle: { make: "Toyota", year: 2020 } });
	});
});

describe("handleEvent", () => {
	it("appends message deltas to the last message", () => {
		handleEvent({ type: "message.delta", text: "Hel" });
		handleEvent({ type: "message.delta", text: "lo" });

		expect(
			(intakeStore.state.entries.at(-1) as { content: string }).content,
		).toBe("Hello");
	});

	it("applies form patches and revalidates", () => {
		handleEvent({ type: "form.patch", patch: { vehicle: { make: "Toyota" } } });

		expect(intakeStore.state.values.vehicle?.make).toBe("Toyota");
	});

	it("records the handoff ref", () => {
		handleEvent({ type: "handoff.requested", ref: "ref-1" });

		expect(intakeStore.state.handoff).toEqual({ status: "sent", ref: "ref-1" });
	});

	it("replaces the empty placeholder bubble with a running action", () => {
		handleEvent({
			type: "action.started",
			id: "a1",
			kind: "form.update",
			label: "Updating the form",
		});

		expect(intakeStore.state.entries).toEqual([
			{
				role: "action",
				id: "a1",
				kind: "form.update",
				label: "Updating the form",
				status: "running",
			},
		]);
	});

	it("finishes an action and starts a new bubble for later text", () => {
		handleEvent({
			type: "action.started",
			id: "a1",
			kind: "form.update",
			label: "Updating the form",
		});
		handleEvent({
			type: "action.finished",
			id: "a1",
			ok: true,
			detail: "vehicle.make",
		});
		handleEvent({ type: "message.delta", text: "Got it" });

		expect(intakeStore.state.entries).toEqual([
			expect.objectContaining({
				id: "a1",
				status: "done",
				detail: "vehicle.make",
			}),
			{ role: "assistant", content: "Got it" },
		]);
	});

	it("excludes actions from the messages sent to the server", () => {
		handleEvent({
			type: "action.started",
			id: "a1",
			kind: "slack.handoff",
			label: "Notifying",
		});
		handleEvent({ type: "message.delta", text: "Hi" });

		expect(selectMessages(intakeStore.state.entries)).toEqual([
			{ role: "assistant", content: "Hi" },
		]);
	});

	it("surfaces errors in the last message", () => {
		handleEvent({ type: "error", message: "bad" });

		expect(
			(intakeStore.state.entries.at(-1) as { content: string }).content,
		).toContain("bad");
	});
});

describe("applyPatch", () => {
	it("keeps user-entered fields when the agent patches another", () => {
		applyPatch({ vehicle: { make: "Toyota" } });
		applyPatch({ vehicle: { model: "Corolla" } });

		expect(intakeStore.state.values.vehicle).toMatchObject({
			make: "Toyota",
			model: "Corolla",
		});
	});
});
