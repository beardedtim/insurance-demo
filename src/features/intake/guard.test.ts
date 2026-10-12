import { describe, expect, it } from "vitest";

import { sanitizePatch, userStatedValue } from "./guard";

const today = "2026-06-01";

describe("sanitizePatch", () => {
	it("keeps valid fields and rejects invalid ones individually", () => {
		const result = sanitizePatch({
			base: {},
			raw: { vehicle: { make: "Toyota", year: "nope" } },
			today,
		});

		expect(result.patch).toEqual({ vehicle: { make: "Toyota" } });
		expect(Object.keys(result.rejected)).toEqual(["vehicle.year"]);
	});

	it("ignores blank values and unknown sections", () => {
		const result = sanitizePatch({
			base: {},
			raw: { vehicle: { make: null, model: "" }, secrets: { a: 1 } },
			today,
		});

		expect(result).toEqual({ patch: {}, rejected: {}, conflicts: [] });
	});

	it("rejects a malformed email", () => {
		const result = sanitizePatch({
			base: {},
			raw: { applicant: { email: "not-an-email" } },
			today,
		});

		expect(result.patch).toEqual({});
		expect(result.rejected["applicant.email"]).toBeDefined();
	});

	it("does not overwrite a user-owned field unless the user stated the new value", () => {
		const base = { applicant: { garagingState: "CA" as const } };
		const raw = { applicant: { garagingState: "NY" } };
		const owned = ["applicant.garagingState"];

		const blocked = sanitizePatch({
			base,
			raw,
			protectedPaths: owned,
			latestUserMessage: "what else do you need?",
			today,
		});

		expect(blocked.patch).toEqual({});
		expect(blocked.rejected["applicant.garagingState"]).toContain("by hand");

		const allowed = sanitizePatch({
			base,
			raw,
			protectedPaths: owned,
			latestUserMessage: "actually please change my state to NY",
			today,
		});

		expect(allowed.patch).toEqual({ applicant: { garagingState: "NY" } });
	});

	it("lets the agent fill a user-owned field that the user cleared", () => {
		const result = sanitizePatch({
			base: {},
			raw: { vehicle: { make: "Honda" } },
			protectedPaths: ["vehicle.make"],
			latestUserMessage: "hi",
			today,
		});

		expect(result.patch).toEqual({ vehicle: { make: "Honda" } });
	});

	it("drops a claim date outside the five-year window", () => {
		const result = sanitizePatch({
			base: { claims: { atFaultClaims: 1 } },
			raw: { claims: { mostRecentClaimDate: "2010-01-01" } },
			today,
		});

		expect(result.patch).toEqual({});
		expect(result.rejected["claims.mostRecentClaimDate"]).toContain(
			"Must be between",
		);
	});

	it("drops a claim date when there are no claims", () => {
		const result = sanitizePatch({
			base: {},
			raw: { claims: { atFaultClaims: 0, mostRecentClaimDate: "2025-01-01" } },
			today,
		});

		expect(result.patch).toEqual({ claims: { atFaultClaims: 0 } });
		expect(result.rejected["claims.mostRecentClaimDate"]).toBeDefined();
	});

	it("saves a claim count but reports the missing date as a conflict to ask about", () => {
		const result = sanitizePatch({
			base: {},
			raw: { claims: { atFaultClaims: 2 } },
			today,
		});

		expect(result.patch).toEqual({ claims: { atFaultClaims: 2 } });
		expect(result.conflicts).toEqual([
			"claims.mostRecentClaimDate: Required when there are at-fault claims",
		]);
	});
});

describe("userStatedValue", () => {
	it("matches strings and numbers case-insensitively, ignoring thousands commas", () => {
		expect(
			userStatedValue("Move me to ny", "applicant.garagingState", "NY"),
		).toBe(true);
		expect(
			userStatedValue("about 12,000 miles", "vehicle.annualMileage", 12000),
		).toBe(true);
		expect(userStatedValue("hello", "vehicle.make", "Honda")).toBe(false);
	});

	it("matches a boolean field by its name", () => {
		expect(
			userStatedValue(
				"add roadside please",
				"coverage.roadsideAssistance",
				true,
			),
		).toBe(true);
		expect(
			userStatedValue("sounds good", "coverage.roadsideAssistance", true),
		).toBe(false);
	});
});
