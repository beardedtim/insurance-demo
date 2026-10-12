import { beforeEach, describe, expect, it } from "vitest";

import {
	applyPatch,
	confirmField,
	deepMerge,
	intakeStore,
	selectEdits,
	selectMessages,
	selectTouched,
	setField,
} from "./store";
import { handleEvent } from "./stream-chat";

beforeEach(() => {
	intakeStore.setState(() => ({
		values: {},
		errors: {},
		provenance: {},
		rejected: {},
		edits: {},
		strikes: 0,
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

describe("provenance", () => {
	it("marks agent writes as proposals and user writes as edits", () => {
		applyPatch({ vehicle: { make: "Toyota" } });
		setField("vehicle", "model", "Corolla");

		expect(intakeStore.state.provenance).toEqual({
			"vehicle.make": "agent",
			"vehicle.model": "user",
		});
	});

	it("lets the user confirm a proposal, and only proposals", () => {
		applyPatch({ vehicle: { make: "Toyota" } });
		setField("vehicle", "model", "Corolla");
		confirmField("vehicle.make");
		confirmField("vehicle.model");

		expect(intakeStore.state.provenance).toEqual({
			"vehicle.make": "confirmed",
			"vehicle.model": "user",
		});
	});

	it("turns a proposal into a user edit when the user changes it", () => {
		applyPatch({ vehicle: { make: "Toyota" } });
		setField("vehicle", "make", "Honda");

		expect(intakeStore.state.provenance["vehicle.make"]).toBe("user");
	});

	it("reports typed and confirmed fields as touched, not proposals", () => {
		applyPatch({ vehicle: { make: "Toyota", year: 2020 } });
		setField("vehicle", "model", "Corolla");
		confirmField("vehicle.year");

		expect(selectTouched(intakeStore.state.provenance).sort()).toEqual([
			"vehicle.model",
			"vehicle.year",
		]);
	});

	it("clears provenance when a field is emptied", () => {
		setField("vehicle", "make", "Honda");
		setField("vehicle", "make", undefined);

		expect(intakeStore.state.provenance).toEqual({});
	});

	it("keeps the first value as `from` across repeated edits, and drops reverted ones", () => {
		applyPatch({ applicant: { garagingState: "CA" } });
		setField("applicant", "garagingState", "NY");
		setField("applicant", "garagingState", "TX");

		expect(selectEdits(intakeStore.state.edits)).toEqual([
			{ path: "applicant.garagingState", from: "CA", to: "TX" },
		]);

		setField("applicant", "garagingState", "CA");

		expect(intakeStore.state.edits).toEqual({});
	});
});

describe("rejected proposals and strikes", () => {
	it("shows a rejection until the field changes", () => {
		handleEvent({
			type: "form.rejected",
			fields: { "vehicle.year": "too old" },
		});

		expect(intakeStore.state.rejected["vehicle.year"]).toBe("too old");

		setField("vehicle", "year", 2020);

		expect(intakeStore.state.rejected).toEqual({});
	});

	it("resets the strike count when the user edits a field", () => {
		intakeStore.setState((state) => ({ ...state, strikes: 2 }));
		setField("vehicle", "make", "Honda");

		expect(intakeStore.state.strikes).toBe(0);
	});
});
