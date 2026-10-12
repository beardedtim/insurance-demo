import { describe, expect, it } from "vitest";

import type { IntakeEvent } from "./events";
import { minLiabilityFor } from "./rules";
import { crossFieldErrors } from "./schema";
import { encodeSse, parseSseStream } from "./sse";
import { applyPatch, deepMerge, intakeStore, setField } from "./store";

const today = "2026-10-12";

describe("minLiabilityFor", () => {
	it("uses per-state minimums with a shared default", () => {
		expect(minLiabilityFor("CA")).toBe("30/60");
		expect(minLiabilityFor("NY")).toBe("50/100");
		expect(minLiabilityFor("FL")).toBe("10/20");
		expect(minLiabilityFor("TX")).toBe("25/50");
		expect(minLiabilityFor(undefined)).toBe("25/50");
	});
});

describe("crossFieldErrors", () => {
	it("flags liability below the state minimum", () => {
		const errors = crossFieldErrors(
			{
				applicant: { garagingState: "NY" },
				coverage: { liabilityLimit: "30/60" },
			},
			today,
		);

		expect(errors["coverage.liabilityLimit"]).toBeDefined();
	});

	it("requires a claim date iff claims > 0", () => {
		expect(
			crossFieldErrors({ claims: { atFaultClaims: 1 } }, today)[
				"claims.mostRecentClaimDate"
			],
		).toBeDefined();
		expect(
			crossFieldErrors(
				{ claims: { atFaultClaims: 0, mostRecentClaimDate: "2025-01-01" } },
				today,
			)["claims.mostRecentClaimDate"],
		).toBeDefined();
		expect(crossFieldErrors({ claims: { atFaultClaims: 0 } }, today)).toEqual(
			{},
		);
	});

	it("limits the claim date to the last 5 years", () => {
		const check = (mostRecentClaimDate: string) =>
			crossFieldErrors(
				{ claims: { atFaultClaims: 1, mostRecentClaimDate } },
				today,
			)["claims.mostRecentClaimDate"];

		expect(check("2021-10-12")).toBeUndefined();
		expect(check("2021-10-11")).toBeDefined();
		expect(check("2026-10-13")).toBeDefined();
	});
});

describe("sse", () => {
	it("round-trips events split across chunk boundaries", async () => {
		const events: IntakeEvent[] = [
			{ type: "message.delta", text: "hi" },
			{ type: "form.patch", patch: { vehicle: { make: "Toyota" } } },
			{ type: "done" },
		];
		const bytes = new TextEncoder().encode(events.map(encodeSse).join(""));
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				for (let i = 0; i < bytes.length; i += 7) {
					controller.enqueue(bytes.slice(i, i + 7));
				}

				controller.close();
			},
		});
		const received: IntakeEvent[] = [];

		for await (const event of parseSseStream(body)) {
			received.push(event);
		}

		expect(received).toEqual(events);
	});
});

describe("store", () => {
	it("deep merges agent patches without clobbering user edits", () => {
		expect(deepMerge({ a: { b: 1, c: 2 } }, { a: { c: 3 } })).toEqual({
			a: { b: 1, c: 3 },
		});

		setField("applicant", "fullName", "Ada");
		applyPatch({ applicant: { garagingState: "CA" } });

		expect(intakeStore.state.values.applicant).toEqual({
			fullName: "Ada",
			garagingState: "CA",
		});
	});
});
