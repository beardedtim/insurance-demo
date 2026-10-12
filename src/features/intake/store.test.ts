import { beforeEach, describe, expect, it } from "vitest";

import { applyPatch, deepMerge, intakeStore } from "./store";
import { handleEvent } from "./stream-chat";

beforeEach(() => {
	intakeStore.setState(() => ({
		values: {},
		errors: {},
		messages: [{ role: "assistant", content: "" }],
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

		expect(intakeStore.state.messages.at(-1)?.content).toBe("Hello");
	});

	it("applies form patches and revalidates", () => {
		handleEvent({ type: "form.patch", patch: { vehicle: { make: "Toyota" } } });

		expect(intakeStore.state.values.vehicle?.make).toBe("Toyota");
	});

	it("records the handoff ref", () => {
		handleEvent({ type: "handoff.requested", ref: "ref-1" });

		expect(intakeStore.state.handoff).toEqual({ status: "sent", ref: "ref-1" });
	});

	it("surfaces errors in the last message", () => {
		handleEvent({ type: "error", message: "bad" });

		expect(intakeStore.state.messages.at(-1)?.content).toContain("bad");
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
